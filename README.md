# Kafka Consumer

Node.js TypeScript Kafka consumer using Clean Architecture, Docker, automated tests, pre-commit checks, and SonarQube-friendly coding standards.

## Tech Stack

- Node.js 24.15.0
- TypeScript
- KafkaJS
- Docker / Docker Compose
- Vitest
- ESLint
- Prettier
- Husky
- lint-staged
- SonarQube-compatible quality standards

## Project Folder Structure

```txt
kafka-consumer/
├── docker/
│   └── Dockerfile
├── src/
│   ├── main.ts
│   ├── bootstrap/
│   │   ├── app.ts
│   │   └── env.ts
│   ├── domain/
│   │   └── ...
│   ├── application/
│   │   ├── use-cases/
│   │   ├── ports/
│   │   └── services/
│   ├── infra/
│   │   ├── kafka/
│   │   │   ├── kafka-client.ts
│   │   │   ├── consumer.ts
│   │   │   ├── manual-message-publisher.ts
│   │   │   └── topic-admin.ts
│   │   ├── http/
│   │   │   └── manual-api-server.ts
│   │   ├── logger/
│   │   │   ├── col-logger.ts
│   │   │   ├── logger.ts
│   │   │   └── step-name-map.ts
│   │   └── config/
│   │       └── env.ts
│   └── shared/
│       ├── result.ts
│       ├── errors.ts
│       └── types.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── setup.ts
├── .husky/
│   └── pre-commit
├── .dockerignore
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── eslint.config.js
├── lint-staged.config.js
└── README.md
```

## Architecture Rules

This project follows Clean Architecture.

- `domain/` contains business rules only.
- `application/` contains use cases, ports, and application services.
- `infra/` contains external implementations such as Kafka, database, logger, and config.
- `bootstrap/` wires dependencies and starts the application.
- `shared/` contains reusable primitives that do not depend on framework or infra code.

Dependency direction must point inward:

```txt
infra -> application -> domain
bootstrap -> infra/application/domain
```

The `domain` layer must not import from `application`, `infra`, `bootstrap`, KafkaJS, database clients, environment loaders, or logger implementations.

Use the `@/` path alias for imports from `src`:

```ts
import { logger } from '@/infra/logger/logger';
import { env } from '@/infra/config/env';
```

Avoid deep relative imports such as `../../../infra/logger/logger` for project modules.

## Logging

The project uses Pino for structured JSON logs.

Logger files:

- `src/infra/logger/col-logger.ts` contains the main logger instance and `createLogModel`.
- `src/infra/logger/logger.ts` re-exports logger APIs for stable imports.
- `src/infra/logger/step-name-map.ts` contains endpoint-to-step-name mapping rules.
- `src/infra/config/env.ts` contains logger and runtime environment validation.

Basic usage:

```ts
import { createLogModel } from '@/infra/logger/logger';

const log = createLogModel();

log.logStep('consume-message', {
  txid: 'transaction-id',
  activity_name: 'consume-message',
  endpoint: 'kafka://example-topic',
  step_request: { orderId: 'order-001' },
  step_response: { status: 'processed' },
});
```

For failures:

```ts
log.logStep(
  'consume-message',
  {
    txid: 'transaction-id',
    activity_name: 'consume-message',
    endpoint: 'kafka://example-topic',
    step_request: { orderId: 'order-001' },
    step_response: { status: 'failed', message: 'Invalid payload' },
  },
  'error',
);
```

The Kafka consumer logs once per consumed message after processing finishes. It uses `x-correlator-id` from Kafka headers as the log transaction id. If the header is missing, the consumer generates a UUID.

```json
{
  "headers": {
    "x-correlator-id": "manual-transaction-id"
  }
}
```

The logger still exposes `logIn`, `logOut`, and `logError` for workflows that need order-level logs, but the Kafka consumer currently uses only `logStep`.
txid: 'transaction-id',
endpoint: 'kafka://example-topic',
error,
});

````

File logging is controlled by `LOG_TO_FILE`. When enabled, logs are written through `pino-roll` to `LOG_PATH`.

## Kafka Flow

The sample consumer flow is:

```txt
consume data -> process -> log result
````

Input messages are consumed from `KAFKA_TOPIC`. The application use case parses the message value and creates a processing result. The current service finishes the workflow in-process and records the result in the step log.

Example input message value:

```json
{
  "orderId": "order-001",
  "amount": 100
}
```

Example response message value:

```json
{
  "txid": "transaction-id",
  "status": "processed",
  "source": {
    "topic": "example-topic",
    "partition": 0,
    "offset": "12",
    "key": "message-key"
  },
  "data": {
    "orderId": "order-001",
    "amount": 100
  },
  "processedAt": "2026-05-26T00:00:00.000Z"
}
```

The sample processing logic lives in `src/application/use-cases/process-consumed-message.ts`. Kafka-specific consume implementations live in `src/infra/kafka/`.

If a future workflow must publish a Kafka response, add a response publisher adapter in `src/infra/kafka/`, inject it into `KafkaConsumer`, call it after `processor.execute(input)`, and start/stop the producer from `src/bootstrap/app.ts`.

When processing fails, the consumer logs the failed step and rethrows the error so KafkaJS can retry according to consumer behavior.

Multiple consumers are supported from `src/bootstrap/app.ts` through the `consumerConfigs` array. Each config owns its own `processor`, so different topics can execute different use cases while sharing the same Kafka consumer infrastructure.

Example shape:

```ts
const consumerConfigs = [
  {
    name: 'primary-consumer',
    groupId: env.KAFKA_GROUP_ID,
    topic: env.KAFKA_TOPIC,
    processor: new ProcessConsumedMessageUseCase(),
  },
  // {
  //   name: 'secondary-consumer',
  //   groupId: env.KAFKA_SECONDARY_GROUP_ID,
  //   topic: env.KAFKA_SECONDARY_TOPIC,
  //   processor: new ProcessSecondaryConsumedMessageUseCase(),
  // },
];
```

To enable a second consumer, uncomment the second config block and provide:

```env
KAFKA_SECONDARY_GROUP_ID=kafka-secondary-consumer-group
KAFKA_SECONDARY_TOPIC=example-secondary-topic
```

## Manual API

The service exposes a small HTTP API using Node's built-in `node:http` module. No extra HTTP framework dependency is required.

Configure the port with:

```env
MANUAL_API_PORT=3000
```

Publish a test message into Kafka:

```sh
curl -X POST http://localhost:3000/api/manual \
  -H 'content-type: application/json' \
  -d '{
    "topic": "example-topic",
    "key": "order-001",
    "value": {
      "orderId": "order-001",
      "amount": 100
    },
    "headers": {
      "source": "manual-api",
      "x-correlator-id": "manual-transaction-id"
    }
  }'
```

The `topic` field is required.

```json
{
  "topic": "example-topic",
  "key": "message-key",
  "value": "hello"
}
```

Health check returns plain text `ok`:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/healthz
```

## Testing

Vitest is the preferred test runner for this project because it is lightweight and works well with TypeScript.

Expected test layout:

- `tests/unit/` for isolated domain and application tests.
- `tests/integration/` for Kafka, database, and infrastructure integration tests.
- `tests/setup.ts` for shared test setup.

Expected scripts:

```json
{
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

## Pre-commit

Husky should run the following pre-commit checks:

```sh
npx --no-install lint-staged
gitleaks protect --staged
trivy fs --quiet --severity HIGH,CRITICAL --ignore-unfixed .
npm audit --audit-level=high
npm test
```

Recommended `lint-staged.config.js`:

```js
export default {
  '*.{ts,tsx,js,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
```

## SonarQube Standards

Code should be written to pass SonarQube quality expectations.

Baseline rules:

- Keep functions small and focused.
- Avoid duplicated logic.
- Avoid deeply nested control flow.
- Use clear names for variables, functions, classes, and modules.
- Prefer explicit error handling over silent failures.
- Avoid unused code, unused exports, and dead branches.
- Avoid hardcoded secrets, credentials, tokens, and internal URLs.
- Keep cyclomatic complexity low.
- Keep test coverage meaningful for domain and application logic.
- Do not ignore lint or type errors without a documented reason.
- Prefer dependency injection at application boundaries.
- Keep infrastructure details out of domain and application business rules.

Recommended SonarQube quality gate targets:

- No blocker or critical issues.
- No new security hotspots without review.
- No new duplicated code.
- New code coverage should meet the team's configured threshold.
- Maintainability rating should remain acceptable for production services.

## Docker

The project should include:

- `docker/Dockerfile` for building and running the consumer.
- `docker-compose.yml` for local Kafka and service execution using `apache/kafka:3.8.0`.
- `.dockerignore` to keep images small and avoid copying local-only files.

The compose setup includes health checks for Kafka and the consumer. The consumer health check calls `/healthz` on the manual API and expects plain text `ok`.

Docker images use `public.ecr.aws/docker/library/node:24.15.0-alpine` by default through the `NODE_IMAGE` build argument.

Topic creation is disabled by default in application configuration. `docker-compose.yml` enables `KAFKA_ENSURE_TOPICS_ENABLED=true` for local development only. Keep it `false` in deployed environments when Kafka topics are managed outside the service.

Override the image when needed:

```sh
docker build --build-arg NODE_IMAGE=node:24.15.0-alpine -f docker/Dockerfile .
```

## Node Version

This project is pinned to Node.js `24.15.0`.

Use one of the version manager files before installing dependencies:

```sh
nvm use
```

or:

```sh
fnm use
```

## Environment

Runtime configuration should come from environment variables. A `.env.example` file should document required values such as:

```env
NODE_ENV=development
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=kafka-consumer
KAFKA_GROUP_ID=kafka-consumer-group
KAFKA_TOPIC=example-topic
KAFKA_ENSURE_TOPICS_ENABLED=false
# KAFKA_SECONDARY_GROUP_ID=kafka-secondary-consumer-group
# KAFKA_SECONDARY_TOPIC=example-secondary-topic
KAFKA_SSL_ENABLED=false
KAFKA_SSL_REJECT_UNAUTHORIZED=true
# KAFKA_SSL_CA=base64-encoded-ca
# KAFKA_SSL_CERT=base64-encoded-client-cert
# KAFKA_SSL_KEY=base64-encoded-client-key
# KAFKA_SSL_PASSPHRASE=changeit
KAFKA_SASL_ENABLED=false
KAFKA_SASL_MECHANISM=plain
# KAFKA_SASL_USERNAME=username
# KAFKA_SASL_PASSWORD=password
MANUAL_API_PORT=3000
LOG_LEVEL=info
LOG_PATH=./logs
LOG_TO_FILE=false
LOG_CHANNEL=kafka-consumer
LOG_PRODUCT=kafka-consumer
SERVICE_TYPE=consumer
```
