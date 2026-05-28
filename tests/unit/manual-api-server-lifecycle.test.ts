import type { IncomingMessage, ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublishManualMessageUseCase } from '@/application/use-cases/publish-manual-message';
import type { Logger } from '@/infra/logger/logger';

const listen = vi.fn((_port: number, _host: string, callback: () => void) => {
  callback();
});
const close = vi.fn((callback: (error?: Error) => void) => {
  callback();
});
let requestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
const createServer = vi.fn((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
  requestHandler = handler;
  return { listen, close };
});

vi.mock('node:http', () => ({
  createServer,
}));

const importManualApiServer = async () => {
  const module = await import('@/infra/http/manual-api-server');
  return module.ManualApiServer;
};

const createLogger = (): Logger =>
  ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }) as unknown as Logger;

const createPublishManualMessage = (): PublishManualMessageUseCase =>
  ({
    execute: vi.fn(),
  }) as unknown as PublishManualMessageUseCase;

describe('ManualApiServer lifecycle', () => {
  afterEach(() => {
    listen.mockClear();
    close.mockClear();
    createServer.mockClear();
    vi.resetModules();
  });

  it('starts and stops the underlying HTTP server', async () => {
    const ManualApiServer = await importManualApiServer();
    const logger = createLogger();
    const server = new ManualApiServer({
      port: 3000,
      publishManualMessage: createPublishManualMessage(),
      logger,
    });

    await server.start();
    requestHandler?.(
      { method: 'GET', url: '/healthz' } as IncomingMessage,
      {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as unknown as ServerResponse,
    );
    await server.stop();

    expect(listen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function));
    expect(logger.info).toHaveBeenCalledWith({ port: 3000 }, 'Manual API server is ready');
    expect(close).toHaveBeenCalledWith(expect.any(Function));
  });

  it('rejects when HTTP server close fails', async () => {
    close.mockImplementationOnce((callback: (error?: Error) => void) => {
      callback(new Error('close failed'));
    });
    const ManualApiServer = await importManualApiServer();
    const server = new ManualApiServer({
      port: 3000,
      publishManualMessage: createPublishManualMessage(),
      logger: createLogger(),
    });

    await expect(server.stop()).rejects.toThrow('close failed');
  });
});
