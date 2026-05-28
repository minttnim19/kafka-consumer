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

  constructor(private readonly error?: unknown) {}

  execute(input: ConsumedMessageInput): MessageProcessResult | Promise<MessageProcessResult> {
    this.inputs.push(input);

    if (this.error) {
      // Test fallback handling for non-Error failures from unknown dependencies.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(this.error);
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

const createPayload = (headers?: Record<string, Buffer | string | Array<Buffer | string>>) =>
  ({
    topic: 'example-topic',
    partition: 0,
    message: {
      offset: '12',
      key: Buffer.from('order-001'),
      value: Buffer.from('{"orderId":"order-001"}'),
      headers: headers ?? {
        'x-correlator-id': Buffer.from('corr-001'),
      },
    },
    heartbeat: vi.fn(),
    pause: vi.fn(() => () => undefined),
  }) as unknown as EachMessagePayload;

const createPayloadWithoutKey = (): EachMessagePayload =>
  ({
    topic: 'example-topic',
    partition: 0,
    message: {
      offset: '12',
      key: null,
      value: Buffer.from('plain message'),
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

    await consumer.stop();
    expect(kafka.consumer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('generates txid when x-correlator-id is missing', async () => {
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
    await kafka.handleMessage(createPayload({}));

    expect(processor.inputs[0]?.txid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('uses an empty string for null message keys', async () => {
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
    await kafka.handleMessage(createPayloadWithoutKey());

    expect(processor.inputs[0]?.key).toBe('');
  });

  it('logs and rethrows processing errors', async () => {
    const kafka = createKafka();
    const processor = new TestMessageProcessor(new Error('processing failed'));
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

  it('reads string and array header values', async () => {
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
    await kafka.handleMessage(
      createPayload({ 'x-correlator-id': ['corr-001', Buffer.from('corr-002')] }),
    );

    expect(processor.inputs[0]?.txid).toBe('corr-001');
  });

  it('logs unknown errors with fallback message', async () => {
    const kafka = createKafka();
    const processor = new TestMessageProcessor('unknown failure');
    const consumer = new KafkaConsumer({
      kafka: kafka.kafka,
      groupId: 'group-id',
      topic: 'example-topic',
      processor,
      logger: createLogger(),
    });

    await consumer.start();
    await expect(kafka.handleMessage(createPayload())).rejects.toBe('unknown failure');
    expect(logStep.mock.calls[0]?.[1].step_response).toMatchObject({
      message: 'Unknown error',
    });
  });
});
