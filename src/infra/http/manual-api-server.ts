import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { z } from 'zod';

import type {
  PublishManualMessageInput,
  PublishManualMessageUseCase,
} from '@/application/use-cases/publish-manual-message';
import type { Logger } from '@/infra/logger/logger';

type ManualApiServerParams = {
  port: number;
  publishManualMessage: PublishManualMessageUseCase;
  logger: Logger;
};

type ApiResponse =
  | { success: true; data: unknown }
  | {
      success: false;
      error: { code: string; message: string; timestamp: string; details?: unknown };
    };

const jsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown()),
]);

const publishMessageSchema = z.object({
  topic: z.string().min(1),
  key: z.string().min(1).optional(),
  value: jsonValueSchema,
  headers: z.record(z.string()).optional(),
});

const parsePublishMessageInput = (data: unknown): PublishManualMessageInput => {
  const parsed = publishMessageSchema.parse(data);

  return {
    topic: parsed.topic,
    key: parsed.key,
    value: parsed.value,
    headers: parsed.headers,
  };
};

const sendJson = (res: ServerResponse, statusCode: number, payload: ApiResponse): void => {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const sendText = (res: ServerResponse, statusCode: number, payload: string): void => {
  res.writeHead(statusCode, { 'content-type': 'text/plain' });
  res.end(payload);
};

const isHealthRoute = (req: IncomingMessage): boolean =>
  req.method === 'GET' && (req.url === '/health' || req.url === '/healthz');

const isManualPublishRoute = (req: IncomingMessage): boolean =>
  req.method === 'POST' && req.url === '/api/manual';

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    }
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (rawBody.trim().length === 0) return {};

  return JSON.parse(rawBody);
};

export class ManualApiServer {
  private readonly server: Server;

  constructor(private readonly params: ManualApiServerParams) {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(this.params.port, '0.0.0.0', resolve);
    });

    this.params.logger.info({ port: this.params.port }, 'Manual API server is ready');
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (isHealthRoute(req)) {
      sendText(res, 200, 'ok');
      return;
    }

    if (!isManualPublishRoute(req)) {
      sendJson(res, 404, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    try {
      const body = parsePublishMessageInput(await readJsonBody(req));
      const result = await this.params.publishManualMessage.execute(body);

      sendJson(res, 202, { success: true, data: result });
    } catch (error) {
      this.params.logger.error({ error }, 'Failed to publish manual Kafka message');
      sendJson(res, 400, {
        success: false,
        error: {
          code: 'PUBLISH_MANUAL_MESSAGE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to publish message',
          timestamp: new Date().toISOString(),
          details: error instanceof z.ZodError ? error.flatten() : undefined,
        },
      });
    }
  }
}
