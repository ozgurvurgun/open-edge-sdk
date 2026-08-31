import type {
  IngestTransport,
  LiveSpan,
  ServiceIdentity,
  TelemetrySession,
} from "./ports.js";
import type { LogRecord, MetricRecord, SpanRecord, TraceId } from "../domain/telemetry.js";
import { sanitizeFields, sanitizeLabels } from "../domain/labels.js";
import {
  formatTraceparent,
  newSpanId,
  newTraceId,
  normalizeSpanId,
  normalizeTraceId,
} from "../domain/trace-context.js";
import { shouldSample } from "../domain/sampling.js";
import {
  fingerprintLabels,
  type CardinalityGuard,
} from "../domain/cardinality.js";

type LogEvent = {
  eventId: string;
  timestamp: number;
  line: string;
  labels: Record<string, string>;
  fields?: Record<string, string>;
  traceId?: string;
  spanId?: string;
};

type MetricEvent = {
  eventId: string;
  timestamp: number;
  name: string;
  type: "counter" | "gauge" | "histogram";
  labels: Record<string, string>;
  value: number;
};

type TraceEvent = {
  eventId: string;
  traceId: string;
  spans: Array<{
    spanId: string;
    parentSpanId?: string | null;
    service: string;
    operation: string;
    startTime: number;
    durationMs: number;
    status?: "ok" | "error";
    attributes?: Record<string, string>;
  }>;
};

export type SessionOptions = {
  traceId?: TraceId;
  parentSpanId?: string | null;
  onFlushError?: (error: unknown) => void;
  sampleRate?: number;
  cardinality?: CardinalityGuard;
};

function newEventId(): string {
  return globalThis.crypto.randomUUID();
}
export function createTelemetrySession(
  transport: IngestTransport,
  identity: ServiceIdentity,
  options?: SessionOptions,
): TelemetrySession {
  const traceId = normalizeTraceId(options?.traceId ?? newTraceId());
  const sampled = shouldSample(traceId, options?.sampleRate ?? 1);
  const onFlushError =
    options?.onFlushError ??
    ((error: unknown) => {
      console.error("open_edge_flush_failed", String(error));
    });

  const logs: LogEvent[] = [];
  const metrics: MetricEvent[] = [];
  const spansByTrace = new Map<string, SpanRecord[]>();

  const session: TelemetrySession = {
    traceId,

    log(record: LogRecord) {
      if (!sampled) return;
      const labels = sanitizeLabels(record.labels, {
        service: identity.service,
        env: identity.environment,
        level: record.level,
      });
      logs.push({
        eventId: newEventId(),
        timestamp: record.timestamp ?? Date.now(),
        line: record.message.slice(0, 16_384),
        labels,
        fields: sanitizeFields({
          level: record.level,
          ...(record.fields ?? {}),
        }),
        traceId: record.traceId ? normalizeTraceId(record.traceId) : traceId,
        spanId: record.spanId ? normalizeSpanId(record.spanId) : undefined,
      });
    },

    metric(record: MetricRecord) {
      if (!sampled) return;
      const labels = sanitizeLabels(record.labels, {
        service: identity.service,
        env: identity.environment,
      });
      const fp = `${record.name}|${fingerprintLabels(labels)}`;
      if (options?.cardinality && !options.cardinality.allow(fp)) {
        return;
      }
      metrics.push({
        eventId: newEventId(),
        timestamp: record.timestamp ?? Date.now(),
        name: record.name,
        type: record.type,
        value: record.value,
        labels,
      });
    },

    span(span: SpanRecord & { traceId: TraceId }) {
      if (!sampled) return;
      const tid = normalizeTraceId(span.traceId);
      const list = spansByTrace.get(tid) ?? [];
      list.push({
        ...span,
        spanId: normalizeSpanId(span.spanId),
        parentSpanId: span.parentSpanId ? normalizeSpanId(span.parentSpanId) : null,
      });
      spansByTrace.set(tid, list);
    },

    startSpan(operation, spanOptions) {
      const spanId = newSpanId();
      const startTime = Date.now();
      const parent =
        spanOptions?.parentSpanId === undefined
          ? (session.rootSpanId ?? options?.parentSpanId ?? null)
          : spanOptions.parentSpanId;
      const live: LiveSpan = {
        spanId,
        traceId,
        end(status = "ok", attributes) {
          session.span({
            traceId,
            spanId,
            parentSpanId: parent,
            operation,
            startTime,
            durationMs: Math.max(0, Date.now() - startTime),
            status,
            attributes: sanitizeFields({
              ...(spanOptions?.attributes ?? {}),
              ...(attributes ?? {}),
            }),
          });
        },
      };
      return live;
    },

    traceparent(spanId) {
      return formatTraceparent(traceId, spanId ?? session.rootSpanId ?? newSpanId());
    },

    propagationHeaders(spanId) {
      return {
        traceparent: session.traceparent(spanId),
      };
    },

    async flush() {
      if (!sampled) return;
      const traces: TraceEvent[] = [...spansByTrace.entries()].map(([id, spans]) => ({
        eventId: newEventId(),
        traceId: id,
        spans: spans.map((s) => ({
          spanId: s.spanId,
          parentSpanId: s.parentSpanId ?? null,
          service: identity.service,
          operation: s.operation,
          startTime: s.startTime,
          durationMs: s.durationMs,
          status: s.status ?? "ok",
          attributes: s.attributes,
        })),
      }));

      const jobs: Promise<void>[] = [];
      if (logs.length) jobs.push(transport.ingestLogs(logs.splice(0)));
      if (metrics.length) jobs.push(transport.ingestMetrics(metrics.splice(0)));
      if (traces.length) {
        spansByTrace.clear();
        jobs.push(transport.ingestTraces(traces));
      }
      if (jobs.length === 0) return;

      const results = await Promise.allSettled(jobs);
      for (const result of results) {
        if (result.status === "rejected") onFlushError(result.reason);
      }
    },
  };

  return session;
}
