import { randomUUID } from 'node:crypto';

import type { Consumer, EachMessagePayload, Kafka } from 'kafkajs';

import type { ConsumedMessageInput, MessageProcessor } from '@/application/ports/message-processor';
import { createLogModel, type Logger } from '@/infra/logger/logger';
import { toRecord, type UnknownRecord } from '@/shared/object';

type KafkaConsumerParams = {
  kafka: Kafka;
  groupId: string;
  topic: string;
  processor: MessageProcessor;
  logger: Logger;
};

type ErrorResponse = {
  status: 'failed';
  topic: string;
  offset: string;
  key?: string;
  message: string;
  failedAt: string;
};

const bufferToString = (value: Buffer | null): string => value?.toString('utf8') ?? '';

const headerToString = (
  value: Buffer | string | Array<Buffer | string> | undefined,
): string | undefined => {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return headerToString(value[0]);
  return value;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const getStatusCode = (source: UnknownRecord | undefined): string | undefined => {
  const status = source?.status ?? source?.statusCode;
  if (typeof status === 'number') return status.toString();
  if (typeof status === 'string' && status.trim() !== '') return status.trim();
  return undefined;
};

const getErrorResultCode = (error: unknown): string => {
  const errorRecord = toRecord(error);
  const responseRecord = toRecord(errorRecord?.response);
  return getStatusCode(errorRecord) ?? getStatusCode(responseRecord) ?? '500';
};

export class KafkaConsumer {
  private readonly consumer: Consumer;

  constructor(private readonly params: KafkaConsumerParams) {
    this.consumer = params.kafka.consumer({
      groupId: params.groupId,
      sessionTimeout: 10_000,
      heartbeatInterval: 3_000,
    });
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.params.topic, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async (payload) => this.handleMessage(payload),
    });

    this.params.logger.info({ topic: this.params.topic }, 'Kafka consumer is ready');
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }

  private async handleMessage({ topic, partition, message }: EachMessagePayload): Promise<void> {
    const txid = headerToString(message.headers?.['x-correlator-id']) ?? randomUUID();
    const key = bufferToString(message.key);
    const value = bufferToString(message.value);
    const log = createLogModel({ txid });

    const input: ConsumedMessageInput = {
      txid,
      topic,
      partition,
      offset: message.offset,
      key,
      value,
      receivedAt: new Date().toISOString(),
    };

    try {
      const response = await this.params.processor.execute(input);

      log.logStep('consume-kafka-message', {
        activity_name: 'consume-kafka-message',
        endpoint: `kafka://${topic}`,
        step_request: input,
        step_response: response,
        search_key: key,
      });
    } catch (error) {
      const response: ErrorResponse = {
        status: 'failed',
        topic,
        offset: message.offset,
        key,
        message: getErrorMessage(error),
        failedAt: new Date().toISOString(),
      };

      log.logStep(
        'consume-kafka-message',
        {
          activity_name: 'consume-kafka-message',
          endpoint: `kafka://${topic}`,
          step_request: input,
          step_response: response,
          result_code: getErrorResultCode(error),
          result_desc: response.message,
          search_key: key,
        },
        'error',
      );

      throw error;
    }
  }
}
