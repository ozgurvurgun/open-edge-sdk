import type { LogRecord, MetricRecord, SpanRecord, TraceId } from "../domain/telemetry.js";

export interface IngestTransport {
  ingestLogs(events: unknown[]): Promise<void>;
  ingestMetrics(events: unknown[]): Promise<void>;
  ingestTraces(events: unknown[]): Promise<void>;
}

export interface TelemetrySession {
  readonly traceId: TraceId;
  rootSpanId?: string;
  log(record: LogRecord): void;
  metric(record: MetricRecord): void;
  span(span: SpanRecord & { traceId: TraceId }): void;
  startSpan(
    operation: string,
    options?: { parentSpanId?: string | null; attributes?: Record<string, string> },
  ): LiveSpan;
  traceparent(spanId?: string): string;
  propagationHeaders(spanId?: string): Record<string, string>;
  flush(): Promise<void>;
}

export type LiveSpan = {
  readonly spanId: string;
  readonly traceId: TraceId;
  end(status?: "ok" | "error", attributes?: Record<string, string>): void;
};

export type ServiceIdentity = {
  service: string;
  environment: string;
};
