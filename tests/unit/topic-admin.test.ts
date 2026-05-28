import type { ITopicConfig, Kafka } from 'kafkajs';
import { describe, expect, it, vi } from 'vitest';

import { ensureKafkaTopics } from '@/infra/kafka/topic-admin';

type CreatedTopicsParams = {
  waitForLeaders: boolean;
  topics: ITopicConfig[];
};

const createKafka = ({ existingTopics = [] }: { existingTopics?: string[] } = {}) => {
  const admin = {
    connect: vi.fn().mockResolvedValue(undefined),
    listTopics: vi.fn().mockResolvedValue(existingTopics),
    createTopics: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  return {
    kafka: {
      admin: vi.fn(() => admin),
    } as unknown as Kafka,
    admin,
  };
};

describe('ensureKafkaTopics', () => {
  it('creates only missing unique topics', async () => {
    const { kafka, admin } = createKafka({ existingTopics: ['existing-topic'] });

    await ensureKafkaTopics({
      kafka,
      topics: [' existing-topic ', 'new-topic', 'new-topic', ''],
      numPartitions: 3,
      replicationFactor: 2,
      retries: 1,
    });

    expect(admin.createTopics).toHaveBeenCalledTimes(1);
    expect(admin.createTopics.mock.calls[0]?.[0] as CreatedTopicsParams).toMatchObject({
      waitForLeaders: true,
      topics: [{ topic: 'new-topic', numPartitions: 3, replicationFactor: 2 }],
    });
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not call createTopics when all topics already exist', async () => {
    const { kafka, admin } = createKafka({ existingTopics: ['example-topic'] });

    await ensureKafkaTopics({
      kafka,
      topics: ['example-topic'],
      retries: 1,
    });

    expect(admin.createTopics).not.toHaveBeenCalled();
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('retries topic creation failures and logs retry attempts', async () => {
    const admin = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTopics: vi
        .fn()
        .mockRejectedValueOnce(new Error('broker not ready'))
        .mockResolvedValueOnce([]),
      createTopics: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const kafka = {
      admin: vi.fn(() => admin),
    } as unknown as Kafka;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    await ensureKafkaTopics({
      kafka,
      topics: ['example-topic'],
      retries: 2,
      retryDelayMs: 0,
      logger,
    });

    expect(admin.listTopics).toHaveBeenCalledTimes(2);
    expect(admin.disconnect).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, retries: 2 }),
      'Retrying Kafka topic ensure',
    );
  });

  it('throws the last error after retries are exhausted', async () => {
    const error = new Error('broker unavailable');
    const admin = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTopics: vi.fn().mockRejectedValue(error),
      createTopics: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const kafka = {
      admin: vi.fn(() => admin),
    } as unknown as Kafka;

    await expect(
      ensureKafkaTopics({
        kafka,
        topics: ['example-topic'],
        retries: 1,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow('broker unavailable');
  });

  it('ignores disconnect failures while preserving the original admin error', async () => {
    const error = new Error('list failed');
    const admin = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTopics: vi.fn().mockRejectedValue(error),
      createTopics: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed')),
    };
    const kafka = {
      admin: vi.fn(() => admin),
    } as unknown as Kafka;

    await expect(
      ensureKafkaTopics({
        kafka,
        topics: ['example-topic'],
        retries: 1,
      }),
    ).rejects.toThrow('list failed');
  });
});
