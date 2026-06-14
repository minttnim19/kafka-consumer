import type {
  ConsumedMessageInput,
  MessageProcessResult,
  MessageProcessor,
} from '@/application/ports/message-processor';
import { decodeJsonText } from '@/shared/json';

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
      data: decodeJsonText(input.value),
      processedAt: new Date().toISOString(),
    };
  }
}
