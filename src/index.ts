export { OpenEdge, type OpenEdgeOptions } from "./facade/open-edge.js";
export type {
  TelemetrySession,
  LiveSpan,
  IngestTransport,
  ServiceIdentity,
} from "./application/ports.js";
export type {
  LogLevel,
  LogRecord,
  MetricRecord,
  MetricType,
  SpanRecord,
  SpanStatus,
  TraceId,
} from "./domain/telemetry.js";
export {
  sanitizeLabels,
  sanitizeFields,
  FORBIDDEN_LABEL_KEYS,
} from "./domain/labels.js";
export {
  parseTraceparent,
  formatTraceparent,
  type TraceContext,
} from "./domain/trace-context.js";
export { shouldSample } from "./domain/sampling.js";
export {
  createCardinalityGuard,
  fingerprintLabels,
} from "./domain/cardinality.js";
export {
  createHttpTransport,
  type FetchLike,
  type HttpTransportOptions,
  type RetryOptions,
} from "./infrastructure/http-transport.js";
export {
  createQueuedTransport,
  type QueuedTransportOptions,
  type DropPolicy,
} from "./infrastructure/queued-transport.js";
export { createTelemetrySession } from "./application/session.js";
export {
  createInstrumentedFetch,
  type InstrumentedFetchOptions,
} from "./adapters/fetch.js";
export {
  createSpillOnFailureTransport,
  type SpillOptions,
} from "./infrastructure/spill-transport.js";
