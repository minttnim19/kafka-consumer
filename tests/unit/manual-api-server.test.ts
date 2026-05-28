import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import type {
  ManualKafkaMessage,
  ManualMessagePublisher,
} from '@/application/ports/manual-message-publisher';
import {
  PublishManualMessageUseCase,
  type PublishManualMessageOutput,
} from '@/application/use-cases/publish-manual-message';
import { ManualApiServer } from '@/infra/http/manual-api-server';
import type { Logger } from '@/infra/logger/logger';

class InMemoryManualMessagePublisher implements ManualMessagePublisher {
  readonly messages: ManualKafkaMessage[] = [];

  publish(message: ManualKafkaMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}

type TestResponse = ServerResponse & {
  body?: string;
  statusCodeValue?: number;
  headersValue?: Record<string, string>;
};

type TestableManualApiServer = {
  handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

const createLogger = (): Logger =>
  ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }) as unknown as Logger;

const createRequest = ({
  method,
  url,
  body,
  bodyAsString = false,
  chunks,
}: {
  method: string;
  url: string;
  body?: unknown;
  bodyAsString?: boolean;
  chunks?: unknown[];
}): IncomingMessage =>
  ({
    method,
    url,
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      if (chunks) {
        yield* chunks;
        return;
      }

      if (body !== undefined) {
        const payload = JSON.stringify(body);
        yield bodyAsString ? payload : Buffer.from(payload);
      }
    },
  }) as unknown as IncomingMessage;

const createResponse = (): TestResponse =>
  ({
    writeHead(statusCode: number, headers: Record<string, string>) {
      this.statusCodeValue = statusCode;
      this.headersValue = headers;
      return this;
    },
    end(payload: string) {
      this.body = payload;
      return this;
    },
  }) as TestResponse;

const createServer = (publisher = new InMemoryManualMessagePublisher()) => ({
  publisher,
  server: new ManualApiServer({
    port: 3000,
    publishManualMessage: new PublishManualMessageUseCase(publisher),
    logger: createLogger(),
  }) as unknown as TestableManualApiServer,
});

describe('ManualApiServer', () => {
  it('returns plain text health response', async () => {
    const { server } = createServer();
    const req = createRequest({ method: 'GET', url: '/healthz' });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(200);
    expect(res.headersValue?.['content-type']).toBe('text/plain');
    expect(res.body).toBe('ok');
  });

  it('publishes manual messages through /api/manual', async () => {
    const { server, publisher } = createServer();
    const req = createRequest({
      method: 'POST',
      url: '/api/manual',
      body: {
        topic: 'example-topic',
        key: 'order-001',
        value: { orderId: 'order-001' },
        headers: { source: 'test' },
      },
    });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(202);
    expect(JSON.parse(res.body ?? '{}')).toMatchObject({
      success: true,
      data: {
        topic: 'example-topic',
        key: 'order-001',
        value: '{"orderId":"order-001"}',
      },
    });
    expect(publisher.messages).toHaveLength(1);
    expect(publisher.messages[0]?.headers.source).toBe('test');
  });

  it('reads request body chunks that arrive as strings', async () => {
    const { server, publisher } = createServer();
    const req = createRequest({
      method: 'POST',
      url: '/api/manual',
      bodyAsString: true,
      body: {
        topic: 'example-topic',
        value: 'plain message',
      },
    });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(202);
    expect(publisher.messages[0]?.value).toBe('plain message');
  });

  it('returns validation errors for invalid manual publish requests', async () => {
    const { server, publisher } = createServer();
    const req = createRequest({
      method: 'POST',
      url: '/api/manual',
      body: { value: { orderId: 'order-001' } },
    });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(400);
    expect(JSON.parse(res.body ?? '{}')).toMatchObject({
      success: false,
      error: {
        code: 'PUBLISH_MANUAL_MESSAGE_FAILED',
      },
    });
    expect(publisher.messages).toHaveLength(0);
  });

  it('returns not found for unknown routes', async () => {
    const { server } = createServer();
    const req = createRequest({ method: 'GET', url: '/missing' });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(404);
    expect(JSON.parse(res.body ?? '{}')).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
  });

  it('treats empty manual publish body as an invalid request', async () => {
    const { server, publisher } = createServer();
    const req = createRequest({ method: 'POST', url: '/api/manual' });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(400);
    expect(publisher.messages).toHaveLength(0);
  });

  it('ignores unsupported request body chunk types', async () => {
    const { server, publisher } = createServer();
    const req = createRequest({ method: 'POST', url: '/api/manual', chunks: [123] });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(400);
    expect(publisher.messages).toHaveLength(0);
  });

  it('uses fallback error response for non-error publish failures', async () => {
    const server = new ManualApiServer({
      port: 3000,
      publishManualMessage: {
        execute: vi
          .fn<() => Promise<PublishManualMessageOutput>>()
          .mockRejectedValue('publish failed'),
      } as unknown as PublishManualMessageUseCase,
      logger: createLogger(),
    }) as unknown as TestableManualApiServer;
    const req = createRequest({
      method: 'POST',
      url: '/api/manual',
      body: {
        topic: 'example-topic',
        value: 'plain message',
      },
    });
    const res = createResponse();

    await server.handleRequest(req, res);

    expect(res.statusCodeValue).toBe(400);
    expect(JSON.parse(res.body ?? '{}')).toMatchObject({
      success: false,
      error: {
        code: 'PUBLISH_MANUAL_MESSAGE_FAILED',
        message: 'Failed to publish message',
      },
    });
  });
});
