import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import pino from 'pino';

import { env } from '@/infra/config/env';
import { resolveStepName } from '@/infra/logger/step-name-map';

export enum LogCategory {
  ORDER = 'order',
  STEP = 'step',
}

type BaseLogFields = {
  txid: string;
  step_txid: string;
  log_cat?: string;
  service_type: string;
  start_date: string;
  end_date: string;
  result_indicator: string;
  result_code: string;
  result_desc: string;
  elapsed_time: number;
  step_name: string;
  search_key?: string;
  remark?: string;
};

type LogData = BaseLogFields & {
  endpoint?: string;
  request?: string;
  response?: string;
  ref_id?: string;
  msisdn?: string;
  employee_id?: string;
  dealer_code?: string;
  transaction_data?: string;
  sms_to_customer?: string;
  certificate_id?: string;
  certificate_type?: string;
  customer_name?: string;
  customer_type?: string;
  customer_subtype?: string;
  customer_priceplan?: string;
  project_name?: string;
  campaign_code?: string;
  campaign_name?: string;
};

type StepLogData = BaseLogFields & {
  endpoint: string;
  step_request: string;
  step_response: string;
  status?: string;
};

type BaseParams = {
  txid?: string;
  method?: string;
  endpoint?: string;
  request?: unknown;
  response?: unknown;
  elapsed_time?: number;
  result_code?: string;
  search_key?: string;
  remark?: string;
};

type CreateLogModelParams = {
  txid?: string;
  service_type?: string;
  product?: string;
  started_at?: number;
};

type LogInParams = BaseParams & {
  ref_id?: string;
};

type LogOutParams = BaseParams & {
  ref_id?: string;
  msisdn?: string;
  employee_id?: string;
  dealer_code?: string;
  transaction_data?: string;
  sms_to_customer?: string;
  certificate_id?: string;
  certificate_type?: string;
  customer_name?: string;
  customer_type?: string;
  customer_subtype?: string;
  customer_priceplan?: string;
  project_name?: string;
  campaign_code?: string;
  campaign_name?: string;
};

type LogStepParams = {
  txid?: string;
  method?: string;
  endpoint?: string;
  step_request?: unknown;
  step_response?: unknown;
  elapsed_time?: number;
  result_code?: string;
  activity_name: string;
  error?: unknown;
  search_key?: string;
  remark?: string;
};

type LogErrorParams = BaseParams & {
  error?: unknown;
  ref_id?: string;
};

type LogLevel = 'error' | 'info';

type ParsedError = {
  name?: string;
  message?: string;
  code?: string;
  stack?: string;
  cause?: unknown;
  isAxiosError?: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  method?: string;
  fullUrl?: string;
  request?: {
    headers?: unknown;
    params?: unknown;
    data?: unknown;
  };
  response?: {
    status?: number;
    statusText?: string;
    data?: unknown;
  };
};

type ResolvedStepData = {
  result_code: string;
  step_name: string;
  endpoint: string;
  message?: string;
  step_request: unknown;
  step_response: unknown;
  remark?: string;
};

type ErrorLogValues = {
  result_code: string;
  endpoint: string;
  request: string;
  response: string;
};

type LogPayloadBaseParams = {
  txid: string;
  log_cat: LogCategory;
  service_type: string;
  start_date: string;
  elapsed_time: number;
  result_indicator: string;
  result_code: string;
  source: BaseParams;
};

type UnknownRecord = Record<string, unknown>;

const setupLogger = (): pino.Logger => {
  const logDir = path.resolve(env.LOG_PATH);
  let fileTransportEnabled = env.LOG_TO_FILE;

  if (fileTransportEnabled) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.accessSync(logDir, fs.constants.W_OK);
    } catch {
      fileTransportEnabled = false;
    }
  }

  const targets: pino.TransportTargetOptions[] = [];
  const hostname = String(process.env.HOSTNAME ?? '').trim();
  const timestamp = (): string => {
    const now = new Date().toISOString();
    return `,"time":"${now}","@timestamp":"${now}","timestamp":"${now}"`;
  };

  if (fileTransportEnabled) {
    targets.push({
      level: env.LOG_LEVEL,
      target: 'pino-roll',
      options: {
        file: path.join(logDir, `app.${hostname}.log`),
        frequency: 'hourly',
        dateFormat: 'yyyy-MM-dd-HH',
        mkdir: true,
      },
    });
  }

  const baseConfig = {
    level: env.LOG_LEVEL,
    timestamp,
    formatters: { level: (label: string) => ({ level: label.toUpperCase() }) },
    base: {
      channel: env.LOG_CHANNEL,
      product: env.LOG_PRODUCT,
    },
  };

  if (targets.length === 0) return pino(baseConfig);

  const transport = pino.transport({ targets }) as pino.DestinationStream;
  return pino(baseConfig, transport);
};

export const logger = setupLogger();
export type Logger = pino.Logger;

const stringifyData = (data: unknown): string => {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return '';
  try {
    return JSON.stringify(data);
  } catch {
    return '[Circular or Non-serializable]';
  }
};

const toRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;

const getString = (source: UnknownRecord | undefined, field: string): string | undefined =>
  typeof source?.[field] === 'string' ? source[field] : undefined;

const getNumber = (source: UnknownRecord | undefined, field: string): number | undefined =>
  typeof source?.[field] === 'number' ? source[field] : undefined;

const coalesceNonEmptyString = (value: string | undefined | null, fallback: string): string =>
  value === undefined || value === null || value === '' ? fallback : value;

const resultDesc = (result_code: string): string => {
  const successCodes = ['0', '200', '201', '202', '204'];
  return successCodes.includes(result_code) ? 'success' : 'failed';
};

const toKebabCase = (str: string): string =>
  str
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replaceAll(/[-_.\s]+/g, '-')
    .replaceAll(/[^\w-]/g, '')
    .replaceAll(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

const getBaseError = (error: UnknownRecord): ParsedError => ({
  name: getString(error, 'name'),
  message: getString(error, 'message'),
  stack: getString(error, 'stack'),
  cause: error.cause,
});

const getErrorStatus = (error: UnknownRecord): number | undefined =>
  getNumber(error, 'status') ?? getNumber(error, 'statusCode');

const getFullUrl = (configUrl?: string, baseURL?: string): string | undefined => {
  if (!configUrl) return undefined;
  if (baseURL) return baseURL + configUrl;
  if (configUrl.startsWith('http')) return configUrl;
  return undefined;
};

const getRequestInfo = (config: UnknownRecord | undefined): ParsedError['request'] =>
  config ? { headers: config.headers, params: config.params, data: config.data } : undefined;

const getResponseInfo = (response: UnknownRecord | undefined): ParsedError['response'] =>
  response
    ? {
        status: getNumber(response, 'status'),
        statusText: getString(response, 'statusText'),
        data: response.data,
      }
    : undefined;

const getAxiosError = (error: UnknownRecord): ParsedError => {
  const config = toRecord(error.config);
  const response = toRecord(error.response);
  const configUrl = getString(config, 'url');
  const baseURL = getString(config, 'baseURL');

  return {
    isAxiosError: true,
    code: getString(error, 'code'),
    status: getNumber(response, 'status'),
    statusText: getString(response, 'statusText'),
    url: configUrl,
    method: getString(config, 'method')?.toUpperCase(),
    fullUrl: getFullUrl(configUrl, baseURL),
    request: getRequestInfo(config),
    response: getResponseInfo(response),
  };
};

const getErrorInfo = (err: unknown): ParsedError => {
  const error = toRecord(err);
  if (!error) return {};
  const baseError = getBaseError(error);
  if (error.isAxiosError === true) return { ...baseError, ...getAxiosError(error) };
  return { ...baseError, code: getString(error, 'code'), status: getErrorStatus(error) };
};

const getStepParams = (msg: string, txid: string, params: BaseParams): LogStepParams => ({
  txid,
  endpoint: params.endpoint,
  method: params.method,
  step_request: params.request,
  step_response: params.response,
  result_code: params.result_code,
  activity_name: toKebabCase(msg),
  search_key: params.search_key,
  remark: params.remark,
});

const getErrorStepParams = (msg: string, txid: string, params: LogErrorParams): LogStepParams => ({
  txid,
  error: params.error,
  activity_name: toKebabCase(msg),
  search_key: params.search_key,
  remark: params.remark,
});

const getErrorStepData = (params: LogStepParams, errorInfo: ParsedError): ResolvedStepData => ({
  result_code: coalesceNonEmptyString(errorInfo.status?.toString(), '500'),
  step_name: resolveStepName(params.activity_name, errorInfo.url, errorInfo.method),
  endpoint: coalesceNonEmptyString(errorInfo.url, ''),
  message: coalesceNonEmptyString(errorInfo.message, ''),
  step_request: errorInfo.request ?? params.step_request,
  step_response: errorInfo.response,
  remark: errorInfo.stack,
});

const getStepData = (params: LogStepParams): ResolvedStepData => ({
  result_code: coalesceNonEmptyString(params.result_code, '0'),
  step_name: resolveStepName(params.activity_name, params.endpoint, params.method),
  endpoint: coalesceNonEmptyString(params.endpoint, ''),
  step_request: params.step_request,
  step_response: params.step_response,
  remark: params.remark,
});

const getErrorLogValues = (params: LogErrorParams): ErrorLogValues => ({
  result_code: coalesceNonEmptyString(params.result_code, '500'),
  endpoint: coalesceNonEmptyString(params.endpoint, ''),
  request: stringifyData(params.request),
  response: stringifyData(params.response),
});

const getErrorLogValuesFromError = (
  params: LogErrorParams,
  fallback: ErrorLogValues,
): ErrorLogValues => {
  const errorInfo = getErrorInfo(params.error);
  return {
    result_code: coalesceNonEmptyString(errorInfo.status?.toString(), '500'),
    endpoint: coalesceNonEmptyString(errorInfo.url, fallback.endpoint),
    request: stringifyData(errorInfo.request),
    response: stringifyData(errorInfo.response),
  };
};

const getServiceType = (service_type: string, product: string): string =>
  service_type ? `${product}_${service_type.trim()}` : product;

const getElapsedTime = (started_at: number, override?: number): number =>
  started_at ? Date.now() - started_at : (override ?? 0);

const getTxid = (paramTxid?: string, defaultTxid?: string): string =>
  paramTxid ?? defaultTxid ?? randomUUID();

const getLogLevel = (error: unknown, override?: LogLevel): LogLevel =>
  override ?? (error ? 'error' : 'info');

const getResultDescText = (message: string | undefined, fallback: string): string =>
  coalesceNonEmptyString(message, fallback);

const buildLogPayloadBase = ({
  txid,
  log_cat,
  service_type,
  start_date,
  elapsed_time,
  result_indicator,
  result_code,
  source,
}: LogPayloadBaseParams): Omit<LogData, 'step_name'> => ({
  txid,
  step_txid: txid,
  log_cat,
  service_type,
  start_date,
  end_date: new Date().toISOString(),
  result_indicator,
  result_code,
  result_desc: resultDesc(result_code),
  elapsed_time,
  endpoint: source.endpoint,
  request: stringifyData(source.request),
  response: stringifyData(source.response),
  search_key: source.search_key,
  remark: source.remark,
});

export type LogModel = {
  logIn: (msg: string, params: LogInParams, log_cat?: LogCategory) => void;
  logStep: (msg: string, params: LogStepParams, logLevel?: LogLevel) => void;
  logOut: (msg: string, params: LogOutParams, log_cat?: LogCategory) => void;
  logError: (msg: string, params: LogErrorParams, log_cat?: LogCategory) => void;
  clone: () => LogModel;
};

export const createLogModel = ({
  txid: defaultTxid,
  service_type = env.SERVICE_TYPE,
  product = env.LOG_PRODUCT,
  started_at = Date.now(),
}: CreateLogModelParams = {}): LogModel => {
  const start_date = new Date(started_at).toISOString();
  const serviceType = getServiceType(service_type, product);

  const elapsedTime = (override?: number): number => getElapsedTime(started_at, override);

  const logStep = (msg: string, params: LogStepParams, logLevel?: LogLevel): void => {
    const txid = getTxid(params.txid, defaultTxid);
    const stepData = params.error
      ? getErrorStepData(params, getErrorInfo(params.error))
      : getStepData(params);
    const result_desc = resultDesc(stepData.result_code);

    const payload: StepLogData = {
      txid,
      step_txid: `${txid}_${Date.now()}`,
      log_cat: LogCategory.STEP,
      service_type: serviceType,
      start_date,
      end_date: new Date().toISOString(),
      result_indicator: result_desc.toUpperCase(),
      result_code: stepData.result_code,
      result_desc: getResultDescText(stepData.message, result_desc),
      elapsed_time: elapsedTime(params.elapsed_time),
      step_name: stepData.step_name,
      endpoint: stepData.endpoint,
      step_request: stringifyData(stepData.step_request),
      step_response: stringifyData(stepData.step_response),
      search_key: params.search_key,
      remark: stepData.remark,
    };

    logger[getLogLevel(params.error, logLevel)](payload, msg);
  };

  const logIn = (msg: string, params: LogInParams, log_cat = LogCategory.ORDER): void => {
    const txid = getTxid(params.txid, defaultTxid);
    const result_code = coalesceNonEmptyString(params.result_code, '0');

    const payload: LogData = {
      ...buildLogPayloadBase({
        txid,
        log_cat,
        service_type: serviceType,
        start_date,
        elapsed_time: elapsedTime(params.elapsed_time),
        result_indicator: 'INPROGRESS',
        result_code,
        source: params,
      }),
      step_name: txid,
      ref_id: params.ref_id,
    };

    logger.info(payload, msg);
    logStep(msg, getStepParams(msg, txid, params));
  };

  const logOut = (msg: string, params: LogOutParams, log_cat = LogCategory.ORDER): void => {
    const txid = getTxid(params.txid, defaultTxid);
    const result_code = coalesceNonEmptyString(params.result_code, '0');

    const payload: LogData = {
      ...buildLogPayloadBase({
        txid,
        log_cat,
        service_type: serviceType,
        start_date,
        elapsed_time: elapsedTime(params.elapsed_time),
        result_indicator: 'COMPLETED',
        result_code,
        source: params,
      }),
      step_name: txid,
      ref_id: params.ref_id,
      msisdn: params.msisdn,
      employee_id: params.employee_id,
      dealer_code: params.dealer_code,
      transaction_data: params.transaction_data,
      sms_to_customer: params.sms_to_customer,
      certificate_id: params.certificate_id,
      certificate_type: params.certificate_type,
      customer_name: params.customer_name,
      customer_type: params.customer_type,
      customer_subtype: params.customer_subtype,
      customer_priceplan: params.customer_priceplan,
      project_name: params.project_name,
      campaign_code: params.campaign_code,
      campaign_name: params.campaign_name,
    };

    logStep(msg, getStepParams(msg, txid, params));
    logger.info(payload, msg);
  };

  const logError = (msg: string, params: LogErrorParams, log_cat = LogCategory.ORDER): void => {
    const txid = getTxid(params.txid, defaultTxid);
    const values = getErrorLogValues(params);
    const errorValues = params.error ? getErrorLogValuesFromError(params, values) : values;
    const stepParams = params.error
      ? getErrorStepParams(msg, txid, params)
      : getStepParams(msg, txid, { ...params, result_code: errorValues.result_code });

    const payload: LogData = {
      ...buildLogPayloadBase({
        txid,
        log_cat,
        service_type: serviceType,
        start_date,
        elapsed_time: elapsedTime(params.elapsed_time),
        result_indicator: 'FAILED',
        result_code: errorValues.result_code,
        source: {
          ...params,
          endpoint: errorValues.endpoint,
          request: errorValues.request,
          response: errorValues.response,
        },
      }),
      step_name: txid,
      ref_id: params.ref_id,
    };

    logStep(msg, stepParams, 'error');
    logger.error(payload, msg);
  };

  const clone = (): LogModel =>
    createLogModel({ txid: defaultTxid, service_type, product, started_at: Date.now() });

  return { logIn, logStep, logOut, logError, clone };
};
