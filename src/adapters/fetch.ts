import type { TelemetrySession } from "../application/ports.js";

export type InstrumentedFetchOptions = {
  operationPrefix?: string;
  recordStatus?: boolean;
};

export function createInstrumentedFetch(
  session: TelemetrySession,
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
  options: InstrumentedFetchOptions = {},
): typeof fetch {
  const prefix = options.operationPrefix ?? "HTTP";
  const recordStatus = options.recordStatus !== false;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    let method = init?.method ?? "GET";
    if (typeof input !== "string" && !(input instanceof URL) && input.method) {
      method = input.method;
    }
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "unknown";
      }
    })();

    const span = session.startSpan(`${prefix} ${method}`, {
      parentSpanId: session.rootSpanId ?? null,
      attributes: { "http.url": url.slice(0, 256), "http.method": method, peer: host },
    });

    const headers = new Headers(
      init?.headers ??
        (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined),
    );
    for (const [k, v] of Object.entries(session.propagationHeaders(span.spanId))) {
      headers.set(k, v);
    }

    try {
      const res = await baseFetch(input, { ...init, headers });
      span.end(res.ok ? "ok" : "error", recordStatus ? { http_status: String(res.status) } : undefined);
      return res;
    } catch (error) {
      span.end("error", { error: "network" });
      throw error;
    }
  };
}
