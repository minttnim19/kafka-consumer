import type { Kafka } from 'kafkajs';
import { describe, expect, it, vi } from 'vitest';

import { KafkaManualMessagePublisher } from '@/infra/kafka/manual-message-publisher';

const createKafka = () => {
  const producer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  };

  return {
    kafka: {
      producer: vi.fn(() => producer),
    } as unknown as Kafka,
    producer,
  };
};

describe('KafkaManualMessagePublisher', () => {
  it('connects, publishes, and disconnects producer messages', async () => {
    const { kafka, producer } = createKafka();
    const publisher = new KafkaManualMessagePublisher(kafka);

    await publisher.start();
    await publisher.publish({
      topic: 'example-topic',
      key: 'order-001',
      value: '{"orderId":"order-001"}',
      headers: { 'x-correlator-id': 'corr-001' },
    });
    await publisher.stop();

    expect(producer.connect).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'example-topic',
      messages: [
        {
          key: 'order-001',
          value: '{"orderId":"order-001"}',
          headers: { 'x-correlator-id': 'corr-001' },
        },
      ],
    });
    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });
});
