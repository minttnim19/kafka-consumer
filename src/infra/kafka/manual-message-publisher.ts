import { Partitioners, type Kafka, type Producer } from 'kafkajs';

import type {
  ManualKafkaMessage,
  ManualMessagePublisher,
} from '@/application/ports/manual-message-publisher';

export class KafkaManualMessagePublisher implements ManualMessagePublisher {
  private readonly producer: Producer;

  constructor(kafka: Kafka) {
    this.producer = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
    });
  }

  async start(): Promise<void> {
    await this.producer.connect();
  }

  async stop(): Promise<void> {
    await this.producer.disconnect();
  }

  async publish(message: ManualKafkaMessage): Promise<void> {
    await this.producer.send({
      topic: message.topic,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: message.headers,
        },
      ],
    });
  }
}
