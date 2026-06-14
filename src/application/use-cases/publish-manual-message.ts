import { randomUUID } from 'node:crypto';

import type { ManualMessagePublisher } from '@/application/ports/manual-message-publisher';
import { encodeJsonText } from '@/shared/json';

export type PublishManualMessageInput = {
  topic: string;
  key?: string;
  value: unknown;
  headers?: Record<string, string>;
};

export type PublishManualMessageOutput = {
  txid: string;
  topic: string;
  key?: string;
  value: string;
  headers: Record<string, string>;
  publishedAt: string;
};

export class PublishManualMessageUseCase {
  constructor(private readonly publisher: ManualMessagePublisher) {}

  async execute(input: PublishManualMessageInput): Promise<PublishManualMessageOutput> {
    const txid = input.headers?.['x-correlator-id'] ?? randomUUID();
    const value = encodeJsonText(input.value);
    const headers = {
      ...input.headers,
      'x-correlator-id': txid,
    };

    await this.publisher.publish({
      topic: input.topic,
      key: input.key,
      value,
      headers,
    });

    return {
      txid,
      topic: input.topic,
      key: input.key,
      value,
      headers,
      publishedAt: new Date().toISOString(),
    };
  }
}
