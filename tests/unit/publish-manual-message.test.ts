import { describe, expect, it } from 'vitest';

import type {
  ManualKafkaMessage,
  ManualMessagePublisher,
} from '@/application/ports/manual-message-publisher';
import { PublishManualMessageUseCase } from '@/application/use-cases/publish-manual-message';

class InMemoryManualMessagePublisher implements ManualMessagePublisher {
  readonly messages: ManualKafkaMessage[] = [];

  publish(message: ManualKafkaMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}

describe('PublishManualMessageUseCase', () => {
  it('publishes JSON value to the requested topic', async () => {
    const publisher = new InMemoryManualMessagePublisher();
    const useCase = new PublishManualMessageUseCase(publisher);

    const result = await useCase.execute({
      topic: 'example-topic',
      key: 'order-001',
      value: { orderId: 'order-001', amount: 100 },
      headers: { source: 'manual-api' },
    });

    expect(result.topic).toBe('example-topic');
    expect(result.value).toBe('{"orderId":"order-001","amount":100}');
    expect(result.headers.source).toBe('manual-api');
    expect(result.headers['x-correlator-id']).toBe(result.txid);
    expect(publisher.messages).toHaveLength(1);
    expect(publisher.messages[0]).toMatchObject({
      topic: 'example-topic',
      key: 'order-001',
      value: '{"orderId":"order-001","amount":100}',
    });
  });
});
