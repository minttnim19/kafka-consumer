import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

type TestAxiosInstance = Pick<AxiosInstance, 'get' | 'post' | 'put' | 'delete'> & {
  defaults?: AxiosRequestConfig;
  requestHandler?: (config: ConfigWithMetadata) => ConfigWithMetadata;
  responseHandler?: (response: AxiosResponse) => AxiosResponse;
  responseErrorHandler?: (error: unknown) => Promise<never>;
  interceptors: {
    request: {
      use: (handler: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig) => void;
    };
    response: {
      use: (
        successHandler: (response: AxiosResponse) => AxiosResponse,
        errorHandler: (error: unknown) => Promise<never>,
      ) => void;
    };
  };
};

type ConfigWithMetadata = InternalAxiosRequestConfig & {
  metadata?: {
    txid?: string;
    logModel?: unknown;
    method?: string;
    endpoint?: string;
    request?: unknown;
  };
};

const createLogStep = vi.fn();
const loggerWarn = vi.fn();
const axiosCreate = vi.fn();
const isAxiosError = vi.fn();
const instances: TestAxiosInstance[] = [];

const createAxiosInstance = (config: AxiosRequestConfig): TestAxiosInstance => {
  const instance: TestAxiosInstance = {
    defaults: config,
    get: vi.fn().mockResolvedValue({ data: 'get-result' }),
    post: vi.fn().mockResolvedValue({ data: 'post-result' }),
    put: vi.fn().mockResolvedValue({ data: 'put-result' }),
    delete: vi.fn().mockResolvedValue({ data: 'delete-result' }),
    interceptors: {
      request: {
        use: (handler) => {
          instance.requestHandler = handler;
        },
      },
      response: {
        use: (successHandler, errorHandler) => {
          instance.responseHandler = successHandler;
          instance.responseErrorHandler = errorHandler;
        },
      },
    },
  };

  instances.push(instance);
  return instance;
};

vi.mock('@/infra/config/env', () => ({
  env: {
    HTTP_TIMEOUT_MS: 10_000,
  },
}));

vi.mock('@/infra/logger/logger', () => ({
  createLogModel: vi.fn(() => ({
    logStep: createLogStep,
  })),
  logger: {
    warn: loggerWarn,
  },
}));

vi.mock('axios', () => ({
  default: {
    create: axiosCreate,
  },
  isAxiosError,
}));

const importHttpClient = async () => {
  const module = await import('@/infra/http/http-client');
  return module;
};

const createClientForUnknownErrors = async (): Promise<TestAxiosInstance | undefined> => {
  axiosCreate.mockImplementation(createAxiosInstance);
  isAxiosError.mockReturnValue(false);
  const { createHttpClient } = await importHttpClient();
  createHttpClient();
  return instances[1];
};

describe('http-client', () => {
  afterEach(() => {
    vi.resetModules();
    axiosCreate.mockReset();
    isAxiosError.mockReset();
    createLogStep.mockReset();
    loggerWarn.mockReset();
    instances.splice(0, instances.length);
  });

  it('creates axios clients with defaults and custom options', async () => {
    axiosCreate.mockImplementation(createAxiosInstance);
    const { createHttpClient } = await importHttpClient();

    createHttpClient({
      baseURL: 'https://api.test',
      timeoutMs: 500,
      headers: { Authorization: 'Bearer token' },
    });

    expect(instances[0]?.defaults).toMatchObject({
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    expect(instances[1]?.defaults).toMatchObject({
      baseURL: 'https://api.test',
      timeout: 500,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer token',
      },
    });
  });

  it('adds metadata and guards relative URLs without baseURL', async () => {
    axiosCreate.mockImplementation(createAxiosInstance);
    const { createHttpClient } = await importHttpClient();
    createHttpClient({ baseURL: 'https://api.test/' });
    const instance = instances[1];

    const config = instance?.requestHandler?.({
      baseURL: 'https://api.test/',
      url: '/orders',
      method: 'post',
      data: { orderId: 'order-001' },
      metadata: { txid: 'tx-001' },
      headers: {},
    } as ConfigWithMetadata);

    expect(config?.metadata).toMatchObject({
      endpoint: 'https://api.test/orders',
      method: 'POST',
      request: { orderId: 'order-001' },
    });
    expect(() =>
      instances[0]?.requestHandler?.({
        url: '/orders',
        method: 'get',
        headers: {},
      } as ConfigWithMetadata),
    ).toThrow('HTTP client called with relative URL');
  });

  it('keeps absolute endpoints and handles metadata without txid', async () => {
    axiosCreate.mockImplementation(createAxiosInstance);
    const { createHttpClient } = await importHttpClient();
    createHttpClient();

    const config = instances[1]?.requestHandler?.({
      url: 'https://external.test/orders',
      method: 'get',
      headers: {},
    } as ConfigWithMetadata);

    expect(config?.metadata).toMatchObject({
      endpoint: 'https://external.test/orders',
      method: 'GET',
    });
    expect(config?.metadata?.logModel).toBeUndefined();
  });

  it('resolves baseURL-only endpoints and missing methods', async () => {
    axiosCreate.mockImplementation(createAxiosInstance);
    const { createHttpClient } = await importHttpClient();
    createHttpClient({ baseURL: 'https://api.test' });

    const config = instances[1]?.requestHandler?.({
      baseURL: 'https://api.test',
      headers: {},
    } as ConfigWithMetadata);

    expect(config?.metadata).toMatchObject({
      endpoint: 'https://api.test',
    });
    expect(config?.metadata?.method).toBeUndefined();
  });

  it('uses an empty endpoint when baseURL and url are missing', async () => {
    axiosCreate.mockImplementation(createAxiosInstance);
    const { createHttpClient } = await importHttpClient();
    createHttpClient();

    const config = instances[1]?.requestHandler?.({
      headers: {},
    } as ConfigWithMetadata);

    expect(config?.metadata?.endpoint).toBe('');
  });

  it('logs successful and failed axios responses', async () => {
    axiosCreate.mockImplementation(createAxiosInstance);
    isAxiosError.mockReturnValue(true);
    const { createHttpClient } = await importHttpClient();
    createHttpClient();
    const instance = instances[1];
    const requestConfig = instance?.requestHandler?.({
      baseURL: 'https://api.test',
      url: '/orders',
      method: 'post',
      data: { orderId: 'order-001' },
      metadata: { txid: 'tx-001' },
      headers: {},
    } as ConfigWithMetadata);

    instance?.responseHandler?.({
      status: 201,
      data: { ok: true },
      config: requestConfig,
      statusText: 'Created',
      headers: {},
    } as AxiosResponse);

    expect(createLogStep).toHaveBeenCalledWith(
      'HTTP client request completed',
      expect.objectContaining({
        activity_name: 'http-client-request',
        endpoint: 'https://api.test/orders',
        result_code: '201',
      }),
    );

    const axiosError = {
      config: requestConfig,
      message: 'failed',
      isAxiosError: true,
    } as AxiosError;
    await expect(instance?.responseErrorHandler?.(axiosError)).rejects.toThrow('failed');
    expect(createLogStep).toHaveBeenCalledWith(
      'HTTP client request error',
      expect.objectContaining({
        activity_name: 'http-client-request',
        error: axiosError,
      }),
    );
  });

  it('warns unknown errors and normalizes rejection values', async () => {
    const instance = await createClientForUnknownErrors();

    await expect(instance?.responseErrorHandler?.({ message: 'object error' })).rejects.toThrow(
      'object error',
    );
    const error = new Error('native error');
    await expect(instance?.responseErrorHandler?.(error)).rejects.toBe(error);
    await expect(instance?.responseErrorHandler?.('string error')).rejects.toThrow('string error');
    await expect(instance?.responseErrorHandler?.(404)).rejects.toThrow('404');

    expect(loggerWarn).toHaveBeenCalledTimes(4);
  });

  it('normalizes symbol and undefined unknown errors', async () => {
    const instance = await createClientForUnknownErrors();

    await expect(instance?.responseErrorHandler?.(undefined)).rejects.toThrow('undefined');
    await expect(instance?.responseErrorHandler?.(Symbol())).rejects.toThrow('symbol');
    await expect(instance?.responseErrorHandler?.(Symbol('symbol error'))).rejects.toThrow(
      'symbol error',
    );

    expect(loggerWarn).toHaveBeenCalledTimes(3);
  });

  it('normalizes named function errors', async () => {
    const instance = await createClientForUnknownErrors();

    await expect(instance?.responseErrorHandler?.(function namedError() {})).rejects.toThrow(
      '[Function: namedError]',
    );

    expect(loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('normalizes anonymous function errors', async () => {
    const instance = await createClientForUnknownErrors();
    const anonymousFunction = Object.defineProperty(() => undefined, 'name', { value: '' });

    await expect(instance?.responseErrorHandler?.(anonymousFunction)).rejects.toThrow('[Function]');

    expect(loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('normalizes object-shaped unknown errors without default object stringification', async () => {
    const instance = await createClientForUnknownErrors();

    await expect(
      instance?.responseErrorHandler?.({ message: { code: 'OBJECT_ERROR' } }),
    ).rejects.toThrow('{"code":"OBJECT_ERROR"}');
    await expect(instance?.responseErrorHandler?.({ code: 'NO_MESSAGE' })).rejects.toThrow(
      '{"code":"NO_MESSAGE"}',
    );
    const circularError: Record<string, unknown> = {};
    circularError['self'] = circularError;
    await expect(instance?.responseErrorHandler?.(circularError)).rejects.toThrow(
      '[Unserializable object]',
    );

    expect(loggerWarn).toHaveBeenCalledTimes(3);
  });

  it('returns data from shared HTTP verb helpers', async () => {
    axiosCreate.mockImplementation(createAxiosInstance);
    const { httpDelete, httpGet, httpPost, httpPut } = await importHttpClient();

    await expect(httpGet('/orders')).resolves.toBe('get-result');
    await expect(httpPost('/orders', { orderId: 'order-001' })).resolves.toBe('post-result');
    await expect(httpPut('/orders/order-001', { status: 'done' })).resolves.toBe('put-result');
    await expect(httpDelete('/orders/order-001')).resolves.toBe('delete-result');
  });
});
