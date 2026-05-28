import { loadEnv } from '@/bootstrap/env';
import type { MessageProcessor } from '@/application/ports/message-processor';
import { PublishManualMessageUseCase } from '@/application/use-cases/publish-manual-message';
import { ProcessConsumedMessageUseCase } from '@/application/use-cases/process-consumed-message';
import type { Env } from '@/infra/config/env';
import { ManualApiServer } from '@/infra/http/manual-api-server';
import { KafkaConsumer } from '@/infra/kafka/consumer';
import { createKafkaClient } from '@/infra/kafka/kafka-client';
import { KafkaManualMessagePublisher } from '@/infra/kafka/manual-message-publisher';
import { ensureKafkaTopics } from '@/infra/kafka/topic-admin';
import { logger } from '@/infra/logger/logger';
import type { Kafka } from 'kafkajs';

type ConsumerConfig = {
  // Human-readable name used only for logs and operational visibility.
  name: string;
  // Kafka consumer group id for this topic subscription.
  groupId: string;
  // Kafka topic consumed by this consumer instance.
  topic: string;
  // Topic-specific application logic. Swap this per topic when behavior differs.
  processor: MessageProcessor;
};

type ManualApi = {
  // Small Node HTTP server that exposes /api/manual and health endpoints.
  server: ManualApiServer;
  // Kafka producer used only by the manual API to publish test/operational messages.
  publisher: KafkaManualMessagePublisher;
};

// Add one config per consumed topic. Each topic can own a different application processor.
const createConsumerConfigs = (env: Env): ConsumerConfig[] => [
  {
    name: 'primary-consumer',
    groupId: env.KAFKA_GROUP_ID,
    topic: env.KAFKA_TOPIC,
    processor: new ProcessConsumedMessageUseCase(),
  },
  // Consumer 2 example:
  // {
  //   name: 'secondary-consumer',
  //   groupId: env.KAFKA_SECONDARY_GROUP_ID,
  //   topic: env.KAFKA_SECONDARY_TOPIC,
  //   processor: new ProcessSecondaryConsumedMessageUseCase(),
  // },
];

// KafkaConsumer stays infrastructure-only; the topic-specific behavior comes from config.processor.
const createConsumers = ({
  kafka,
  configs,
}: {
  kafka: Kafka;
  configs: ConsumerConfig[];
}): KafkaConsumer[] =>
  configs.map(
    (config) =>
      new KafkaConsumer({
        kafka,
        groupId: config.groupId,
        topic: config.topic,
        processor: config.processor,
        logger,
      }),
  );

// The manual API is always available inside the container for operational publishing.
const createManualApi = (kafka: Kafka, port: number): ManualApi => {
  const publisher = new KafkaManualMessagePublisher(kafka);
  const publishManualMessage = new PublishManualMessageUseCase(publisher);
  const server = new ManualApiServer({
    port,
    publishManualMessage,
    logger,
  });

  return { server, publisher };
};

export function createApp() {
  // Runtime configuration is validated once at bootstrap.
  const env = loadEnv();

  // Shared Kafka client used to create consumers, producers, and admin operations.
  const kafka = createKafkaClient();

  // Consumer declarations are kept together so topic -> processor mapping is explicit.
  const consumerConfigs = createConsumerConfigs(env);

  // Builds one KafkaConsumer per consumer config.
  const consumers = createConsumers({
    kafka,
    configs: consumerConfigs,
  });

  // Manual API is started in every environment but only reachable where networking allows it.
  const manualApi = createManualApi(kafka, env.MANUAL_API_PORT);

  return {
    async start(): Promise<void> {
      logger.info(
        {
          consumers: consumerConfigs.map((config) => ({
            name: config.name,
            topic: config.topic,
            groupId: config.groupId,
          })),
          ensureTopicsEnabled: env.KAFKA_ENSURE_TOPICS_ENABLED,
        },
        'Starting Kafka consumers',
      );
      if (env.KAFKA_ENSURE_TOPICS_ENABLED) {
        await ensureKafkaTopics({
          kafka,
          topics: consumerConfigs.map((config) => config.topic),
          logger,
        });
      }
      // If processing must publish a Kafka response later, create a response producer here,
      // start it before consumers, inject it into KafkaConsumer, and stop it during shutdown.
      await manualApi.publisher.start();
      await manualApi.server.start();
      await Promise.all(consumers.map((consumer) => consumer.start()));
    },

    async stop(): Promise<void> {
      // Stop inbound consumers first, then close HTTP and producer connections.
      await Promise.all(consumers.map((consumer) => consumer.stop()));
      await manualApi.server.stop();
      await manualApi.publisher.stop();
    },
  };
}
