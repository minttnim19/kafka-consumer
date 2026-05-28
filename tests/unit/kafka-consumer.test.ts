import type { EachMessagePayload, Kafka } from 'kafkajs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConsumedMessageInput,
  MessageProcessResult,
  MessageProcessor,
} from '@/application/ports/message-processor';
import { KafkaConsumer } from '@/infra/kafka/consumer';
import type { Logger } from '@/infra/logger/logger';

type LogStepPayload = {
  step_response: {
    status: string;
  };
};

const logStep = vi.fn<(msg: string, payload: LogStepPayload, level?: string) => void>();

vi.mock('@/infra/logger/logger', () => ({
  createLogModel: () => ({
    logStep,
  }),
}));

class TestMessageProcessor implements MessageProcessor {
  readonly inputs: ConsumedMessageInput[] = [];

  constructor(private readonly shouldFail = false) {}

  execute(input: ConsumedMessageInput): MessageProcessResult {
    this.inputs.push(input);

    if (this.shouldFail) {
      throw new Error('processing failed');
    }

    return {
      txid: input.txid,
      status: 'processed',
      processedAt: '2026-05-28T00:00:00.000Z',
    };
  }
}

const createLogger = (): Logger =>
  ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }) as unknown as Logger;

const createKafka = () => {
  let eachMessage: ((payload: EachMessagePayload) => Promise<void>) | undefined;

  const consumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation((params: { eachMessage: typeof eachMessage }) => {
      eachMessage = params.eachMessage;
      return Promise.resolve();
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  return {
    kafka: {
      consumer: vi.fn(() => consumer),
    } as unknown as Kafka,
    consumer,
    handleMessage: (payload: EachMessagePayload) => {
      if (!eachMessage) throw new Error('Consumer has not started');
      return eachMessage(payload);
    },
  };
};

const createPayload = (): EachMessagePayload =>
  ({
    topic: 'example-topic',
    partition: 0,
    message: {
      offset: '12',
      key: Buffer.from('order-001'),
      value: Buffer.from('{"orderId":"order-001"}'),
      headers: {
        'x-correlator-id': Buffer.from('corr-001'),
      },
    },
    heartbeat: vi.fn(),
    pause: vi.fn(() => () => undefined),
  }) as unknown as EachMessagePayload;

describe('KafkaConsumer', () => {
  beforeEach(() => {
    logStep.mockClear();
  });

  it('passes x-correlator-id to the processor and logs the process result', async () => {
    const kafka = createKafka();
    const processor = new TestMessageProcessor();
    const consumer = new KafkaConsumer({
      kafka: kafka.kafka,
      groupId: 'group-id',
      topic: 'example-topic',
      processor,
      logger: createLogger(),
    });

    await consumer.start();
    await kafka.handleMessage(createPayload());

    expect(processor.inputs[0]?.txid).toBe('corr-001');
    expect(processor.inputs[0]?.key).toBe('order-001');
    expect(logStep.mock.calls[0]?.[0]).toBe('consume-kafka-message');
    expect(logStep.mock.calls[0]?.[1].step_response.status).toBe('processed');
  });

  it('logs and rethrows processing errors', async () => {
    const kafka = createKafka();
    const processor = new TestMessageProcessor(true);
    const consumer = new KafkaConsumer({
      kafka: kafka.kafka,
      groupId: 'group-id',
      topic: 'example-topic',
      processor,
      logger: createLogger(),
    });

    await consumer.start();
    await expect(kafka.handleMessage(createPayload())).rejects.toThrow('processing failed');
    expect(logStep.mock.calls[0]?.[2]).toBe('error');
  });
});
