import { describe, expect, it } from 'vitest';

import { ProcessConsumedMessageUseCase } from '@/application/use-cases/process-consumed-message';

const createInput = (value: string) => ({
  txid: 'tx-001',
  topic: 'example-topic',
  partition: 0,
  offset: '12',
  key: 'message-key',
  value,
  receivedAt: '2026-05-26T00:00:00.000Z',
});

describe('ProcessConsumedMessageUseCase', () => {
  it('parses JSON payload and creates a response model', () => {
    const useCase = new ProcessConsumedMessageUseCase();

    const response = useCase.execute(createInput('{"orderId":"order-001","amount":100}'));

    expect(response.processedAt).toEqual(expect.any(String));
    expect(response).toMatchObject({
      txid: 'tx-001',
      status: 'processed',
      source: {
        topic: 'example-topic',
        partition: 0,
        offset: '12',
        key: 'message-key',
      },
      data: {
        orderId: 'order-001',
        amount: 100,
      },
    });
  });

  it('keeps non-JSON payload as plain text', () => {
    const useCase = new ProcessConsumedMessageUseCase();

    const response = useCase.execute(createInput('plain message'));

    expect(response.data).toBe('plain message');
  });

  it('converts blank payload to null', () => {
    const useCase = new ProcessConsumedMessageUseCase();

    const response = useCase.execute(createInput('   '));

    expect(response.data).toBeNull();
  });
});
