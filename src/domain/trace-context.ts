export type TraceContext = {
  version: string;
  traceId: string;
  spanId: string;
  flags: string;
};

const TRACEPARENT_RE =
  /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;

export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  if (!header) return null;
  const match = TRACEPARENT_RE.exec(header.trim());
  if (!match) return null;
  const [, version, traceId, spanId, flags] = match;
  if (version === "ff" || traceId === "0".repeat(32) || spanId === "0".repeat(16)) {
    return null;
  }
  return {
    version: version!.toLowerCase(),
    traceId: traceId!.toLowerCase(),
    spanId: spanId!.toLowerCase(),
    flags: flags!.toLowerCase(),
  };
}

export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  const tid = normalizeTraceId(traceId);
  const sid = normalizeSpanId(spanId);
  return `00-${tid}-${sid}-${sampled ? "01" : "00"}`;
}

export function normalizeTraceId(id: string): string {
  const hex = id.replace(/-/g, "").toLowerCase().replace(/[^a-f0-9]/g, "");
  if (hex.length >= 32) return hex.slice(0, 32);
  return hex.padStart(32, "0");
}

export function normalizeSpanId(id: string): string {
  const hex = id.replace(/-/g, "").toLowerCase().replace(/[^a-f0-9]/g, "");
  if (hex.length >= 16) return hex.slice(0, 16);
  return hex.padStart(16, "0");
}

export function newTraceId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

export function newSpanId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
