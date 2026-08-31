# Changelog

## 0.5.2

- Assign stable `eventId` on log / metric / trace events for backend ingest dedup
- Queued flush keeps only failed kinds on partial failure (no re-send of successes)

## 0.5.0

- **`durableSpill`** - on ingest failure, spill to Open Edge `POST /api/v1/buffer/enqueue` (server DO)

## 0.4.0

- Queued transport **re-queues on flush failure** (no silent drop after dequeue)
- Hono middleware drains `oe.flush()` after session flush

## 0.3.0

- In-memory **queued transport** (interval + max size + drop policy) across requests
- **Head-based sampling** (`sampleRate`) by trace id
- **Cardinality guard** for metric label sets (`maxCardinality`)
- **`createInstrumentedFetch`** - outbound fetch with W3C + client spans
- Backend **OTLP/HTTP JSON** ingest: `/v1/logs|traces|metrics` and `/api/v1/otlp/v1/*`

## 0.2.0

- W3C `traceparent`, label sanitization, retry/batch HTTP transport
- Optional `@open-edge/sdk/hono` middleware

## 0.1.0

- Initial `OpenEdge` session API (logs / metrics / traces)
