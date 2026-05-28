import type {
  ConsumedMessageInput,
  MessageProcessResult,
  MessageProcessor,
} from '@/application/ports/message-processor';

export type ProcessedMessageResult = MessageProcessResult & {
  status: 'processed';
  source: {
    topic: string;
    partition: number;
    offset: string;
    key?: string;
  };
  data: unknown;
  processedAt: string;
};

const parseMessageValue = (value: string): unknown => {
  if (value.trim().length === 0) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export class ProcessConsumedMessageUseCase implements MessageProcessor {
  execute(input: ConsumedMessageInput): ProcessedMessageResult {
    return {
      txid: input.txid,
      status: 'processed',
      source: {
        topic: input.topic,
        partition: input.partition,
        offset: input.offset,
        key: input.key,
      },
      data: parseMessageValue(input.value),
      processedAt: new Date().toISOString(),
    };
  }
}
