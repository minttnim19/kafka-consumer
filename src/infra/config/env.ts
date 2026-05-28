import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const normalizedValue = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) return true;
  if (['false', '0', 'no', 'off'].includes(normalizedValue)) return false;

  return value;
}, z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    KAFKA_BROKERS: z.string().min(1),
    KAFKA_CLIENT_ID: z.string().min(1),
    KAFKA_GROUP_ID: z.string().min(1),
    KAFKA_TOPIC: z.string().min(1),
    KAFKA_ENSURE_TOPICS_ENABLED: booleanFromEnv.default(false),
    KAFKA_SECONDARY_GROUP_ID: z.string().min(1).optional(),
    KAFKA_SECONDARY_TOPIC: z.string().min(1).optional(),
    KAFKA_SSL_ENABLED: booleanFromEnv.default(false),
    KAFKA_SSL_REJECT_UNAUTHORIZED: booleanFromEnv.default(true),
    KAFKA_SSL_CA: z.string().min(1).optional(),
    KAFKA_SSL_CERT: z.string().min(1).optional(),
    KAFKA_SSL_KEY: z.string().min(1).optional(),
    KAFKA_SSL_PASSPHRASE: z.string().min(1).optional(),
    KAFKA_SASL_ENABLED: booleanFromEnv.default(false),
    KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).default('plain'),
    KAFKA_SASL_USERNAME: z.string().min(1).optional(),
    KAFKA_SASL_PASSWORD: z.string().min(1).optional(),
    MANUAL_API_PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PATH: z.string().default('./logs'),
    LOG_TO_FILE: booleanFromEnv.default(false),
    LOG_CHANNEL: z.string().default('kafka-consumer'),
    LOG_PRODUCT: z.string().default('kafka-consumer'),
    SERVICE_TYPE: z.string().default('consumer'),
  })
  .superRefine((env, ctx) => {
    if (env.KAFKA_SASL_ENABLED && !env.KAFKA_SASL_USERNAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'KAFKA_SASL_USERNAME is required when KAFKA_SASL_ENABLED=true',
        path: ['KAFKA_SASL_USERNAME'],
      });
    }

    if (env.KAFKA_SASL_ENABLED && !env.KAFKA_SASL_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'KAFKA_SASL_PASSWORD is required when KAFKA_SASL_ENABLED=true',
        path: ['KAFKA_SASL_PASSWORD'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export function loadEnv(): Env {
  return env;
}
