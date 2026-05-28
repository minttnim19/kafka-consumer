import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import axios, { isAxiosError } from 'axios';

import { env } from '@/infra/config/env';
import { createLogModel, logger } from '@/infra/logger/logger';

const HTTP_CLIENT_ACTIVITY_NAME = 'http-client-request';
const ABSOLUTE_URL_PATTERN = /^(?:[a-z]+:)?\/\//i;
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

type LogModel = ReturnType<typeof createLogModel>;

type RequestMetadata = {
  txid?: string;
  logModel?: LogModel;
  method?: string;
  endpoint?: string;
  request?: unknown;
};

type InternalConfigWithMeta = InternalAxiosRequestConfig & { metadata?: RequestMetadata };
type ResponseConfigWithMeta = AxiosRequestConfig & { metadata?: RequestMetadata };

export type HttpClientOptions = {
  baseURL?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type HttpRequestConfig = AxiosRequestConfig & {
  metadata?: RequestMetadata;
};

function resolveEndpoint(baseURL?: string, url?: string): string {
  if (url && ABSOLUTE_URL_PATTERN.test(url)) return url;
  if (baseURL && url) return `${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  return url ?? baseURL ?? '';
}

function resolveLogModel(config: InternalConfigWithMeta): LogModel | undefined {
  if (!config.metadata?.txid) return undefined;
  return createLogModel({ txid: config.metadata.txid });
}

function toMetadata(config: InternalConfigWithMeta): RequestMetadata {
  const { url, baseURL } = config;

  return {
    logModel: resolveLogModel(config),
    method: config.method?.toUpperCase(),
    endpoint: resolveEndpoint(baseURL, typeof url === 'string' ? url : undefined),
    request: config.data,
  };
}

function stringifyPrimitive(
  value: string | number | boolean | bigint | symbol | undefined,
): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (value === undefined) return 'undefined';
  return value.description ?? 'symbol';
}

function stringifyObject(value: object | null): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[Unserializable object]';
  }
}

function stringifyFunction(value: (...args: unknown[]) => unknown): string {
  return value.name ? `[Function: ${value.name}]` : '[Function]';
}

function stringifyUnknown(value: unknown): string {
  switch (typeof value) {
    case 'function':
      return stringifyFunction(value as (...args: unknown[]) => unknown);
    case 'object':
      return stringifyObject(value);
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'symbol':
    case 'undefined':
      return stringifyPrimitive(value);
  }
}

function hasMessage(value: unknown): value is { message: unknown } {
  return typeof value === 'object' && value !== null && 'message' in value;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (hasMessage(error)) return new Error(stringifyUnknown(error.message));
  return new Error(stringifyUnknown(error));
}

function createAxios(options?: HttpClientOptions): AxiosInstance {
  const instance = axios.create({
    baseURL: options?.baseURL,
    timeout: options?.timeoutMs ?? env.HTTP_TIMEOUT_MS,
    httpAgent: new HttpAgent({ keepAlive: true }),
    httpsAgent: new HttpsAgent({ keepAlive: true }),
    headers: {
      ...DEFAULT_HEADERS,
      ...options?.headers,
    },
  });

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const { url, baseURL } = config;
    const cfg = config as InternalConfigWithMeta;
    cfg.metadata = toMetadata(cfg);

    const isAbsolute = typeof url === 'string' && ABSOLUTE_URL_PATTERN.test(url);
    if (!baseURL && url && !isAbsolute) {
      throw new Error(
        `HTTP client called with relative URL "${url}" but no baseURL is set. Pass an absolute URL or create a client with baseURL.`,
      );
    }

    return cfg;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const cfg = response.config as ResponseConfigWithMeta;
      const metadata = cfg.metadata;

      metadata?.logModel?.logStep('HTTP client request completed', {
        activity_name: HTTP_CLIENT_ACTIVITY_NAME,
        endpoint: metadata.endpoint,
        method: metadata.method,
        step_request: metadata.request,
        step_response: response.data,
        result_code: String(response.status),
      });

      return response;
    },
    (error: unknown) => {
      if (isAxiosError(error)) {
        const cfg = error.config as ResponseConfigWithMeta | undefined;
        cfg?.metadata?.logModel?.logStep('HTTP client request error', {
          activity_name: HTTP_CLIENT_ACTIVITY_NAME,
          error,
        });
      } else {
        logger.warn({ error }, 'Unknown HTTP error');
      }

      return Promise.reject(toError(error));
    },
  );

  return instance;
}

export const httpClient: AxiosInstance = createAxios();

export function createHttpClient(options?: HttpClientOptions): AxiosInstance {
  return createAxios(options);
}

export async function httpGet<T = unknown>(url: string, config?: HttpRequestConfig): Promise<T> {
  const res = await httpClient.get<T>(url, config);
  return res.data;
}

export async function httpPost<T = unknown, B = unknown>(
  url: string,
  body?: B,
  config?: HttpRequestConfig,
): Promise<T> {
  const res = await httpClient.post<T>(url, body, config);
  return res.data;
}

export async function httpPut<T = unknown, B = unknown>(
  url: string,
  body?: B,
  config?: HttpRequestConfig,
): Promise<T> {
  const res = await httpClient.put<T>(url, body, config);
  return res.data;
}

export async function httpDelete<T = unknown>(url: string, config?: HttpRequestConfig): Promise<T> {
  const res = await httpClient.delete<T>(url, config);
  return res.data;
}
