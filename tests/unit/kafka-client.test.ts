import type { KafkaConfig } from 'kafkajs';
import { afterEach, describe, expect, it, vi } from 'vitest';

type TestEnv = {
  KAFKA_CLIENT_ID: string;
  KAFKA_BROKERS: string;
  KAFKA_SSL_ENABLED: boolean;
  KAFKA_SSL_REJECT_UNAUTHORIZED: boolean;
  KAFKA_SSL_CA?: string;
  KAFKA_SSL_CERT?: string;
  KAFKA_SSL_KEY?: string;
  KAFKA_SSL_PASSPHRASE?: string;
  KAFKA_SASL_ENABLED: boolean;
  KAFKA_SASL_MECHANISM: 'plain' | 'scram-sha-256' | 'scram-sha-512';
  KAFKA_SASL_USERNAME?: string;
  KAFKA_SASL_PASSWORD?: string;
};

const baseEnv: TestEnv = {
  KAFKA_CLIENT_ID: 'kafka-consumer',
  KAFKA_BROKERS: ' kafka-1:9092, kafka-2:9092 ',
  KAFKA_SSL_ENABLED: false,
  KAFKA_SSL_REJECT_UNAUTHORIZED: true,
  KAFKA_SASL_ENABLED: false,
  KAFKA_SASL_MECHANISM: 'plain',
};

const importKafkaClient = async (env: TestEnv) => {
  const kafkaConstructor = vi.fn();

  vi.resetModules();
  vi.doMock('@/infra/config/env', () => ({ env }));
  vi.doMock('kafkajs', () => ({
    Kafka: kafkaConstructor,
  }));

  const module = await import('@/infra/kafka/kafka-client');
  return { createKafkaClient: module.createKafkaClient, kafkaConstructor };
};

describe('createKafkaClient', () => {
  afterEach(() => {
    vi.doUnmock('@/infra/config/env');
    vi.doUnmock('kafkajs');
    vi.resetModules();
  });

  it('creates Kafka client with trimmed brokers and retry defaults', async () => {
    const { createKafkaClient, kafkaConstructor } = await importKafkaClient(baseEnv);

    createKafkaClient();

    expect(kafkaConstructor).toHaveBeenCalledWith({
      clientId: 'kafka-consumer',
      brokers: ['kafka-1:9092', 'kafka-2:9092'],
      ssl: undefined,
      sasl: undefined,
      retry: {
        initialRetryTime: 1000,
        retries: 5,
      },
    });
  });

  it('builds SSL and SASL config from env values', async () => {
    const sslCa = Buffer.from('ca').toString('base64');
    const sslCert = Buffer.from('cert').toString('base64');
    const sslKey = Buffer.from('key').toString('base64');
    const { createKafkaClient, kafkaConstructor } = await importKafkaClient({
      ...baseEnv,
      KAFKA_SSL_ENABLED: true,
      KAFKA_SSL_REJECT_UNAUTHORIZED: false,
      KAFKA_SSL_CA: sslCa,
      KAFKA_SSL_CERT: sslCert,
      KAFKA_SSL_KEY: sslKey,
      KAFKA_SSL_PASSPHRASE: 'secret',
      KAFKA_SASL_ENABLED: true,
      KAFKA_SASL_MECHANISM: 'scram-sha-512',
      KAFKA_SASL_USERNAME: 'user',
      KAFKA_SASL_PASSWORD: 'pass',
    });

    createKafkaClient();

    const config = kafkaConstructor.mock.calls[0]?.[0] as KafkaConfig;
    expect(config.ssl).toMatchObject({
      rejectUnauthorized: false,
      passphrase: 'secret',
    });
    expect(config.ssl && typeof config.ssl === 'object' ? config.ssl.ca : undefined).toEqual([
      Buffer.from('ca'),
    ]);
    expect(config.ssl && typeof config.ssl === 'object' ? config.ssl.cert : undefined).toEqual(
      Buffer.from('cert'),
    );
    expect(config.ssl && typeof config.ssl === 'object' ? config.ssl.key : undefined).toEqual(
      Buffer.from('key'),
    );
    expect(config.sasl).toEqual({
      mechanism: 'scram-sha-512',
      username: 'user',
      password: 'pass',
    });
  });

  it('builds partial SSL config without SASL when credentials are missing', async () => {
    const { createKafkaClient, kafkaConstructor } = await importKafkaClient({
      ...baseEnv,
      KAFKA_SSL_ENABLED: true,
      KAFKA_SSL_REJECT_UNAUTHORIZED: true,
      KAFKA_SASL_ENABLED: true,
    });

    createKafkaClient();

    const config = kafkaConstructor.mock.calls[0]?.[0] as KafkaConfig;
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.sasl).toBeUndefined();
  });
});
