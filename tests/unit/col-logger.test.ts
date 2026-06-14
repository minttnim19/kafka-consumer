import { afterEach, describe, expect, it, vi } from 'vitest';

type LoggedPayload = {
  result_desc?: string;
  step_name?: string;
};

type PinoConfig = {
  timestamp: () => string;
};

const baseEnv = {
  LOG_LEVEL: 'info',
  LOG_PATH: './logs',
  LOG_TO_FILE: false,
  LOG_CHANNEL: 'kafka-consumer',
  LOG_PRODUCT: 'kafka-consumer',
  SERVICE_TYPE: 'consumer',
};

const importColLogger = async () => {
  const info = vi.fn();
  const error = vi.fn();
  const pinoConfigs: PinoConfig[] = [];
  const pino = Object.assign(
    vi.fn((config: PinoConfig) => {
      pinoConfigs.push(config);
      return { info, error };
    }),
    {
      transport: vi.fn(),
    },
  );

  vi.resetModules();
  vi.doMock('@/infra/config/env', () => ({ env: baseEnv }));
  vi.doMock('pino', () => ({ default: pino }));

  const module = await import('@/infra/logger/col-logger');
  return { createLogModel: module.createLogModel, info, error, pinoConfigs };
};

describe('col-logger', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('@/infra/config/env');
    vi.doUnmock('pino');
    vi.resetModules();
  });

  it('configures Splunk-compatible epoch seconds for the time field', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:20:30.456Z'));

    const { pinoConfigs } = await importColLogger();
    const config = pinoConfigs[0];
    if (!config) throw new Error('Expected pino config to be captured');
    const timestamp = JSON.parse(`{${config.timestamp().slice(1)}}`) as {
      time: number;
      '@timestamp': string;
      timestamp: string;
    };

    expect(timestamp).toEqual({
      time: 1_781_432_430.456,
      '@timestamp': '2026-06-14T10:20:30.456Z',
      timestamp: '2026-06-14T10:20:30.456Z',
    });
  });

  it('allows order logs to override result_desc', async () => {
    const { createLogModel, info, error } = await importColLogger();
    const logModel = createLogModel({ txid: 'tx-1', started_at: 1_735_689_600_000 });

    logModel.logIn('request started', {
      result_code: '200',
      result_desc: 'accepted by upstream',
    });
    logModel.logOut('request completed', {
      result_code: '200',
      result_desc: 'completed with partial data',
    });
    logModel.logError('request failed', {
      result_code: '500',
      result_desc: 'upstream timeout',
    });

    expect((info.mock.calls[0]?.[0] as LoggedPayload).result_desc).toBe('accepted by upstream');
    expect((info.mock.calls[3]?.[0] as LoggedPayload).result_desc).toBe(
      'completed with partial data',
    );
    expect((error.mock.calls[1]?.[0] as LoggedPayload).result_desc).toBe('upstream timeout');
  });

  it('allows step logs to override result_desc', async () => {
    const { createLogModel, info } = await importColLogger();
    const logModel = createLogModel({ txid: 'tx-1', started_at: 1_735_689_600_000 });

    logModel.logStep('call upstream', {
      activity_name: 'call-upstream',
      result_code: '500',
      result_desc: 'validation rejected',
    });

    expect((info.mock.calls[0]?.[0] as LoggedPayload).result_desc).toBe('validation rejected');
  });
});
