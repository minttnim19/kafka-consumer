import type { Kafka } from 'kafkajs';

type TopicAdminLogger = {
  info: (payload: Record<string, unknown>, message: string) => void;
  warn: (payload: Record<string, unknown>, message: string) => void;
};

type EnsureKafkaTopicsParams = {
  kafka: Kafka;
  topics: string[];
  numPartitions?: number;
  replicationFactor?: number;
  retries?: number;
  retryDelayMs?: number;
  logger?: TopicAdminLogger;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const uniqueTopics = (topics: string[]): string[] =>
  Array.from(new Set(topics.map((topic) => topic.trim()).filter(Boolean)));

const createMissingTopics = async ({
  kafka,
  topicNames,
  numPartitions,
  replicationFactor,
  logger,
}: Required<Pick<EnsureKafkaTopicsParams, 'kafka' | 'numPartitions' | 'replicationFactor'>> &
  Pick<EnsureKafkaTopicsParams, 'logger'> & {
    topicNames: string[];
  }): Promise<void> => {
  const admin = kafka.admin();

  try {
    await admin.connect();
    const existingTopics = new Set(await admin.listTopics());
    const missingTopics = topicNames.filter((topic) => !existingTopics.has(topic));

    if (missingTopics.length === 0) {
      logger?.info({ topics: topicNames }, 'Kafka topics already exist');
      return;
    }

    await admin.createTopics({
      waitForLeaders: true,
      topics: missingTopics.map((topic) => ({
        topic,
        numPartitions,
        replicationFactor,
      })),
    });
    logger?.info({ topics: missingTopics }, 'Kafka topics created');
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
};

export async function ensureKafkaTopics({
  kafka,
  topics,
  numPartitions = 1,
  replicationFactor = 1,
  retries = 10,
  retryDelayMs = 3_000,
  logger,
}: EnsureKafkaTopicsParams): Promise<void> {
  const topicNames = uniqueTopics(topics);
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await createMissingTopics({ kafka, topicNames, numPartitions, replicationFactor, logger });
      return;
    } catch (error) {
      lastError = error;

      if (attempt === retries) break;
      logger?.warn({ attempt, retries, error }, 'Retrying Kafka topic ensure');
      await sleep(retryDelayMs);
    }
  }

  throw lastError;
}
