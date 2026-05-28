import type { ConnectionOptions } from 'node:tls';

import { Kafka, type KafkaConfig, type SASLOptions } from 'kafkajs';

import { env } from '@/infra/config/env';

const readBase64Value = (value: string | undefined): Buffer | undefined =>
  value ? Buffer.from(value, 'base64') : undefined;

const createSslConfig = (): KafkaConfig['ssl'] => {
  if (!env.KAFKA_SSL_ENABLED) return undefined;

  const ssl: ConnectionOptions = {
    rejectUnauthorized: env.KAFKA_SSL_REJECT_UNAUTHORIZED,
  };
  const ca = readBase64Value(env.KAFKA_SSL_CA);
  const cert = readBase64Value(env.KAFKA_SSL_CERT);
  const key = readBase64Value(env.KAFKA_SSL_KEY);

  if (ca) ssl.ca = [ca];
  if (cert) ssl.cert = cert;
  if (key) ssl.key = key;
  if (env.KAFKA_SSL_PASSPHRASE) ssl.passphrase = env.KAFKA_SSL_PASSPHRASE;

  return ssl;
};

const createSaslConfig = (): SASLOptions | undefined => {
  if (!env.KAFKA_SASL_ENABLED) return undefined;

  const username = env.KAFKA_SASL_USERNAME;
  const password = env.KAFKA_SASL_PASSWORD;

  if (!username || !password) return undefined;

  return {
    mechanism: env.KAFKA_SASL_MECHANISM,
    username,
    password,
  };
};

export function createKafkaClient(): Kafka {
  const config: KafkaConfig = {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(',').map((broker) => broker.trim()),
    ssl: createSslConfig(),
    sasl: createSaslConfig(),
    retry: {
      initialRetryTime: 1000,
      retries: 5,
    },
  };

  return new Kafka(config);
}
