# Agent Instructions

This repository is a Node.js + TypeScript Kafka consumer using Clean Architecture, KafkaJS, a small Node HTTP manual API, structured Pino logging, Docker, Vitest, ESLint, Prettier, and SonarQube-friendly coding standards. Use these instructions for all AI-agent work in this repo.

## Shell Commands

- Target Node.js `24.15.0`, as declared in `package.json`, `.nvmrc`, and `.node-version`.
- Prefer prefixing shell commands with `rtk` when it is available.
- If `rtk` is not installed or misparses a command with flags, run the equivalent command directly or through `rtk proxy`.
- Use `rg` or `rg --files` for searching before slower alternatives.

## Architecture Rules

- Preserve the dependency direction:
  - `src/domain` owns business rules only.
  - `src/application` owns use cases, ports, and application services.
  - `src/application` must not import from `src/infra`, runtime config, KafkaJS clients, Axios clients, database clients, or logger implementations.
  - `src/infra` owns Kafka adapters, HTTP adapters, logger implementations, database adapters, config, and infrastructure-specific runtime code.
  - `src/bootstrap` wires dependencies and starts/stops the application.
  - `src/shared` contains reusable primitives that do not depend on framework, Kafka, HTTP, config, or infra code.
  - `src/main.ts` should stay thin and call the bootstrap entrypoint.
- Keep application behavior behind ports such as `MessageProcessor` and `ManualMessagePublisher`.
- Keep environment-specific values, adapter construction, and process-level concerns in `src/infra/config`, `src/bootstrap`, or infrastructure wiring code.
- Use the `@/` path alias for imports from `src`; avoid deep relative imports for project modules.
- This project is ESM (`"type": "module"`) and builds with `tsup` to `node24`; prefer ESM imports/exports and avoid introducing new CommonJS patterns such as `require`, `module.exports`, or CommonJS-only globals.

## Kafka Consumer Pattern

The service consumes from `KAFKA_TOPIC` using KafkaJS. Topic-specific behavior is provided by a `MessageProcessor` implementation.

When adding or changing a consumed-message flow, check the whole path:

- App wiring: `src/bootstrap/app.ts`
- Kafka client setup: `src/infra/kafka/kafka-client.ts`
- Consumer implementation: `src/infra/kafka/consumer.ts`
- Topic admin behavior: `src/infra/kafka/topic-admin.ts`
- Application port: `src/application/ports/message-processor.ts`
- Use case implementation: `src/application/use-cases`
- Tests for the changed behavior under `tests/unit`
- README and `.env.example` when commands, env vars, topics, health checks, or local runtime behavior change

The Kafka consumer uses the `x-correlator-id` Kafka header as the transaction id. If the header is missing, it generates a UUID. Preserve this behavior unless the task explicitly changes the tracing contract.

The consumer logs one `logStep` after message processing succeeds. On failure, it logs a failed `logStep` with a result code derived from the thrown error or response status, then rethrows so KafkaJS can handle retry behavior. Do not swallow processing errors silently.

Multiple consumers are configured from `src/bootstrap/app.ts` through the `consumerConfigs` array. Each config should own its own `MessageProcessor` so different topics can execute different use cases while sharing Kafka infrastructure.

Topic creation is disabled by default through `KAFKA_ENSURE_TOPICS_ENABLED=false`. Keep auto-creation guarded for local development only; deployed environments should assume topics are managed outside the service unless the task says otherwise.

## Manual API

The manual API uses Node's built-in `node:http` module, not an external web framework.

- Health endpoints `/health` and `/healthz` return plain text `ok`.
- `POST /api/manual` publishes a message to Kafka through `PublishManualMessageUseCase` and `KafkaManualMessagePublisher`.
- The `topic` field is required for manual publish requests.
- Keep manual API behavior aligned across `src/infra/http/manual-api-server.ts`, `src/application/use-cases/publish-manual-message.ts`, tests, README, and env examples when it changes.

## HTTP Client

Shared outbound HTTP calls should use `src/infra/http/http-client.ts`.

- Prefer defining an application port first, then implementing it with an infrastructure HTTP client.
- Pass `metadata.txid` on outbound requests when the call is part of a consumed-message flow so HTTP step logs remain traceable with the Kafka transaction id.
- The HTTP client logs a `logStep` on success or Axios error when `metadata.txid` is present.
- Do not add direct Axios calls in application or domain code.

## Logging Rules

- `src/infra/logger/col-logger.ts` contains the main logger and `createLogModel`.
- `src/infra/logger/logger.ts` is the stable import surface for logger APIs.
- `src/infra/logger/step-name-map.ts` owns endpoint-to-step-name mapping rules.
- Preserve the structured log fields used by Splunk-facing consumers, including transaction ids, timestamps, result fields, endpoint, step request, and step response.
- The logger exposes `logIn`, `logOut`, `logError`, and `logStep`, but the Kafka consumer currently uses `logStep`.
- File logging is controlled by `LOG_TO_FILE` and `LOG_PATH`; keep local file behavior optional.

## Configuration

- Environment variables are parsed and validated in `src/infra/config/env.ts`.
- Bootstrap loads config through `src/bootstrap/env.ts`.
- When adding, renaming, or removing env vars, update `src/infra/config/env.ts`, `.env.example`, README configuration notes, Docker Compose, and related tests together when they are affected.
- Do not read `process.env` directly outside config/bootstrap/logger setup unless there is already a local pattern for that case.
- Keep Kafka SSL and SASL validation explicit. If `KAFKA_SASL_ENABLED=true`, username and password must remain required.

## Local Development and Docker

- Unit tests, lint, type checks, and most build checks do not require Docker.
- Use Docker Compose for manual end-to-end checks that need Kafka or the containerized application.
- Before changing local runtime behavior, check `docker-compose.yml`, `docker/Dockerfile`, `.dockerignore`, `.env.example`, and README.
- Docker Compose uses Kafka health checks and the service health endpoint. The consumer health check expects `/healthz` to return plain text `ok`.
- Docker images use `public.ecr.aws/docker/library/node:24.15.0-alpine` by default through the `NODE_IMAGE` build argument.
- The Dockerfile lives at `docker/Dockerfile` while the build context is the repository root. When changing container behavior, keep paths, copy rules, health checks, and runtime env vars aligned across `docker/Dockerfile`, `.dockerignore`, and `docker-compose.yml`.

## Implementation Rules

- Read the relevant code path before editing.
- Prefer narrow, behavior-focused changes.
- Do not refactor unrelated files.
- Follow existing naming, import aliases, formatting, and test style.
- Add or update focused tests for changed behavior.
- Preserve Kafka consume semantics, manual API behavior, structured logging, transaction-id propagation, env validation, health endpoints, and retry behavior unless the task explicitly changes them.
- Update `.env.example`, README, Docker Compose, buildspecs, or other docs when config, commands, topic mappings, health/manual API behavior, logging contracts, build behavior, or local development flow changes.
- Do not introduce new dependencies unless the task clearly requires them.

## Planning

- For small, localized changes, proceed directly after reading the relevant files.
- For larger changes, first produce a short plan that lists:
  - files likely to change
  - architecture boundary considerations
  - tests to add or update
  - validation commands to run
- Do not implement a large refactor without an agreed plan.

## Persistent Plans

- For small localized changes, a chat plan and final summary are enough.
- For medium or large tasks, create or update a plan file under `docs/agent-plans/`.
- Name plan files with the date and task or feature slug, for example `docs/agent-plans/YYYY-MM-DD-add-secondary-consumer.md`.
- Keep persistent plans concise and update them when scope, decisions, files changed, or validation status changes.
- Do not create persistent plan files for trivial formatting, typo, or one-line fixes unless the user asks.
- A persistent plan should include:
  - goal
  - scope
  - checklist
  - decisions
  - files changed
  - validation
  - status
- If a task already has a plan file, update the existing file instead of creating a duplicate.

## Code Quality

- Keep functions focused, readable, and reasonably small; reduce cognitive complexity instead of adding deeply nested branching.
- Avoid duplicated code. Extract helpers only when they are genuinely reusable and fit an existing local module boundary.
- Avoid dead code, unused exports, unreachable branches, and unnecessary comments.
- Prefer explicit error handling and clear control flow over broad catches or silent fallbacks.
- Use `import type` for type-only imports.
- Keep meaningful unit tests with changed behavior so coverage remains useful.
- If a change is likely to affect maintainability, coverage, or static-analysis results, mention the risk and the relevant validation command in the plan or final summary.

## Testing Rules

- Use Vitest for tests.
- Keep isolated unit tests under `tests/unit`.
- Use existing Vitest globals and `tests/setup.ts` rather than adding one-off test bootstrap code.
- Preserve the `@/` alias in tests and source.
- Coverage is configured with the V8 provider and includes `src/**/*.ts`; `src/main.ts`, `src/bootstrap/**`, `src/infra/config/**`, and logger implementation files are intentionally excluded.
- Add tests near the behavior being changed, especially for Kafka message handling, manual API behavior, shared helpers, env parsing, and logger payload contracts.

## Pre-commit and Security Checks

- The Husky pre-commit hook runs `lint-staged`, `gitleaks protect --staged`, `trivy fs --quiet --severity HIGH,CRITICAL --ignore-unfixed .`, `npm audit --audit-level=high`, and `npm test`.
- `lint-staged.config.js` formats JSON, Markdown, YAML, and YAML-like files with Prettier, and runs ESLint plus Prettier for TypeScript/JavaScript files.
- If a commit or local validation fails on `gitleaks`, `trivy`, or `npm audit`, treat it as a real security/tooling signal. Do not bypass the hook unless the user explicitly asks.
- Keep generated or local-only files out of commits when they could trigger security scans or noisy formatting changes.

## Verification

Run the narrowest checks that prove the change. For implementation work, prefer:

```bash
rtk npm test
rtk npm run lint
rtk npm run type-check
```

For production, build, env, Docker, or packaging-impacting changes, also run:

```bash
rtk npm run build
```

For coverage or SonarQube-review impact, run:

```bash
rtk npm run test:coverage
```

If `rtk` is not available, run the same commands without the `rtk` prefix.

## Git Safety

- Check the working tree before editing.
- Do not revert or overwrite unrelated user changes.
- Do not use destructive git commands unless the user explicitly asks for them.
- Commit messages should follow Conventional Commits, for example `feat(kafka): add secondary consumer`.
