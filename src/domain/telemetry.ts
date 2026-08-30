export type LogLevel = "debug" | "info" | "warn" | "error";

export type MetricType = "counter" | "gauge" | "histogram";

export type SpanStatus = "ok" | "error";

export type LogRecord = {
  level: LogLevel;
  message: string;
  labels?: Record<string, string>;
  fields?: Record<string, string>;
  traceId?: string;
  spanId?: string;
  timestamp?: number;
};

export type MetricRecord = {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
};

export type SpanRecord = {
  spanId: string;
  parentSpanId?: string | null;
  operation: string;
  startTime: number;
  durationMs: number;
  status?: SpanStatus;
  attributes?: Record<string, string>;
};

export type TraceId = string;
