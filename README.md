# @open-edge/sdk

Instrumentation client for Open Edge.

## Install

```bash
npm install github:compartsoftware/open-edge-sdk#main
# or monorepo: "file:../sdk"
```

## Quick start

```ts
import { OpenEdge, createInstrumentedFetch } from "@open-edge/sdk";

const oe = new OpenEdge({
  apiKey: env.OPEN_EDGE_API_KEY,
  service: "checkout",
  environment: "production",
  fetcher: env.OPEN_EDGE,
  queue: { flushIntervalMs: 1000, maxQueueEvents: 5000, drop: "oldest" },
  sampleRate: 1,
  maxCardinality: 2000,
  retry: { maxAttempts: 3 },
});

const t = oe.session({ traceparent: req.headers.get("traceparent") });
const fetchIx = createInstrumentedFetch(t);
await fetchIx("https://payments.internal/charge", { method: "POST" });
await t.flush();
await oe.flush(); // drain cross-request queue
```

## Hono

```ts
import { openEdgeMiddleware } from "@open-edge/sdk/hono";
app.use("*", openEdgeMiddleware(oe));
```

## OTLP (Alloy / Collector)

Point OTLP HTTP exporter at Open Edge (API key auth):

```text
https://<open-edge-host>/v1/traces
https://<open-edge-host>/v1/logs
https://<open-edge-host>/v1/metrics
```

Also available under `/api/v1/otlp/v1/*`. JSON protobuf encoding only (not gRPC).

## Still not Loki/Alloy

No disk WAL across isolate eviction, no full auto-instrumentation matrix, no Promtail file tail. Those remain agent-side concerns; this SDK + OTLP intake is the Cloudflare-native half.
