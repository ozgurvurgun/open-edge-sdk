# @open-edge/sdk

Instrumentation client for Open Edge (logs, metrics, traces).

## Install

```bash
npm install github:ozgurvurgun/open-edge-sdk#main
```

Monorepo / local path:

```json
"@open-edge/sdk": "file:../sdk"
```

Requires Node 20+. Optional peer: `hono` (only if you use `@open-edge/sdk/hono`).

Either `fetcher` (Cloudflare service binding) or `baseUrl` (HTTP origin) is required. API keys must start with `oe_`.

## OpenEdge

```ts
import { OpenEdge } from "@open-edge/sdk";

const oe = new OpenEdge({
  apiKey: env.OPEN_EDGE_API_KEY,
  service: "checkout",
  environment: "production",

  // one of:
  fetcher: env.OPEN_EDGE, // Workers service binding
  // baseUrl: "https://open-edge.example.workers.dev",

  maxBatchSize: 100,
  retry: { maxAttempts: 3, baseDelayMs: 40, maxDelayMs: 1000 },
  sampleRate: 1, // 0..1 trace sampling by trace id
  maxCardinality: 2000, // distinct metric name+label fingerprints

  // cross-request buffer (optional)
  queue: {
    flushIntervalMs: 1000,
    maxQueueEvents: 5000,
    drop: "oldest", // or "newest"
  },
  // queue: true  // defaults above

  durableSpill: true, // on ingest failure, POST /api/v1/buffer/enqueue
  onFlushError: (err) => console.error(err),
  onDrop: (count) => console.warn("dropped", count),
});

oe.pending(); // queued event count (0 if queue disabled)
await oe.flush(); // drain queue now
```

## Session

One session = one unit of work (usually one request). Buffer locally, then `flush()`.

```ts
const t = oe.session({
  traceparent: req.headers.get("traceparent"), // W3C parent (optional)
  // traceId: "...",
  // parentSpanId: "...",
});

t.traceId;
t.rootSpanId = "..."; // set after creating the root span if you need children

t.log({
  level: "info", // debug | info | warn | error
  message: "order accepted",
  labels: { operation: "place_order" },
  fields: { order_id: "o_1" },
  spanId: span.spanId, // optional
});

t.metric({
  name: "orders_created_total",
  type: "counter", // counter | gauge | histogram
  value: 1,
  labels: { sku: "sku_a" },
});

// timed span helper
const span = t.startSpan("checkout.charge", {
  parentSpanId: t.rootSpanId ?? null,
  attributes: { provider: "demo-pay" },
});
// ... work ...
span.end("ok"); // or "error", optional attributes on end

// or record a finished span
t.span({
  traceId: t.traceId,
  spanId: "...",
  parentSpanId: null,
  operation: "manual",
  startTime: Date.now() - 12,
  durationMs: 12,
  status: "ok",
  attributes: { key: "value" },
});

t.traceparent(span.spanId); // W3C header value
t.propagationHeaders(span.spanId); // { traceparent: "..." }

await t.flush();
await oe.flush();
```

Unsampled sessions (`sampleRate`) no-op on record/flush. Labels are sanitized; `service` and `env` come from `OpenEdge` identity. Each buffered log, metric, and trace event gets a client `eventId` (UUID) so Open Edge ingest dedup can drop retries.

## Instrumented fetch

Wraps `fetch`, starts a child span, injects `traceparent`.

```ts
import { createInstrumentedFetch } from "@open-edge/sdk";

const fetchIx = createInstrumentedFetch(t, globalThis.fetch, {
  operationPrefix: "HTTP", // span name: `${prefix} ${method}`
  recordStatus: true, // attach http_status on end
});

await fetchIx("https://payments.internal/charge", { method: "POST" });
```

## Hono middleware

```ts
import { openEdgeMiddleware } from "@open-edge/sdk/hono";
import type { OpenEdgeHonoVariables } from "@open-edge/sdk/hono";

type Env = { Variables: OpenEdgeHonoVariables };

app.use(
  "*",
  openEdgeMiddleware(oe, {
    ignorePaths: ["/health", "/favicon.ico"],
    useWaitUntil: true, // Workers: flush via executionCtx.waitUntil
    httpMetrics: true, // http_requests_total + http_request_duration_ms
  }),
);

app.post("/orders", async (c) => {
  const session = c.get("openEdge");
  const root = c.get("openEdgeRoot");
  session.log({ level: "info", message: "hit", spanId: root.spanId });
  // response already gets traceparent from middleware
  return c.json({ ok: true });
});
```

Middleware creates a session from inbound `traceparent`, starts root `HTTP ...` span, records HTTP metrics, then flushes (`session.flush` + `oe.flush`).

## OTLP (Alloy / Collector)

Point an OTLP HTTP exporter at Open Edge (API key auth). JSON protobuf encoding only (not gRPC):

```text
https://<open-edge-host>/v1/traces
https://<open-edge-host>/v1/logs
https://<open-edge-host>/v1/metrics
```

Also under `/api/v1/otlp/v1/*`.

## Advanced: build your own stack

Most apps use `OpenEdge`. These exports are for custom wiring:

```ts
import {
  createHttpTransport,
  createQueuedTransport,
  createSpillOnFailureTransport,
  createTelemetrySession,
  createCardinalityGuard,
  sanitizeLabels,
  sanitizeFields,
  FORBIDDEN_LABEL_KEYS,
  parseTraceparent,
  formatTraceparent,
  shouldSample,
  fingerprintLabels,
} from "@open-edge/sdk";

const http = createHttpTransport({
  apiKey,
  fetcher, // or baseUrl
  maxBatchSize: 100,
  retry: { maxAttempts: 3 },
});

const spilled = createSpillOnFailureTransport(http, { apiKey, fetcher });
const transport = createQueuedTransport(spilled, {
  flushIntervalMs: 1000,
  maxQueueEvents: 5000,
  drop: "oldest",
});

const parent = parseTraceparent(header);
const session = createTelemetrySession(
  transport,
  { service: "checkout", environment: "production" },
  {
    traceId: parent?.traceId,
    parentSpanId: parent?.spanId ?? null,
    sampleRate: 1,
    cardinality: createCardinalityGuard(2000),
    onFlushError: console.error,
  },
);
```

`createTelemetrySession` options: `traceId`, `parentSpanId`, `sampleRate`, `cardinality`, `onFlushError`.

## Ingest paths used by the SDK

```text
POST /api/v1/logs/ingest
POST /api/v1/metrics/ingest
POST /api/v1/traces/ingest
POST /api/v1/buffer/enqueue   # durableSpill only
```

Auth: `oe-api-key` / `Authorization: Bearer oe_...`.

## Scope

This package targets Workers and OTLP HTTP intake. It does not provide disk WAL across isolate eviction, a full auto-instrumentation matrix, or Promtail-style file tailing.

## See also

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- Example Worker: [open-edge-example](https://github.com/ozgurvurgun/open-edge-example)
