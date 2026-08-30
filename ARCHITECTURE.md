# Architecture

`@open-edge/sdk` follows the same hexagonal / ports-and-adapters discipline as the Open Edge backend.

## Layers

```text
src/facade/open-edge.ts
src/adapters/hono.ts              Optional Hono middleware
        ↓
src/application/session.ts        Buffer + sanitize + W3C helpers
src/application/ports.ts
        ↓
src/domain/{telemetry,labels,trace-context}.ts
        ↑
src/infrastructure/http-transport.ts   Batch + retry ingest
```

## Rules

- Domain has no `fetch`, Hono, or Cloudflare imports.
- Application depends only on ports + domain.
- Infrastructure implements `IngestTransport`.
- Applications should depend on `OpenEdge` / `TelemetrySession`, not on HTTP paths.

## Ingest contract

```text
POST /api/v1/logs/ingest
POST /api/v1/metrics/ingest
POST /api/v1/traces/ingest
```

Envelope and auth are owned by the Open Edge backend (`openapi.yaml`).
