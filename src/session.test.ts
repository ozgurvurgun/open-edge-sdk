import { describe, expect, it, vi } from "vitest";
import { createTelemetrySession } from "./application/session.js";
import type { IngestTransport } from "./application/ports.js";
import { sanitizeLabels } from "./domain/labels.js";
import { formatTraceparent, parseTraceparent } from "./domain/trace-context.js";
import { createHttpTransport } from "./infrastructure/http-transport.js";

describe("sanitizeLabels", () => {
  it("drops high-cardinality keys and normalizes", () => {
    const labels = sanitizeLabels(
      { "User-ID": "u1", Route: "POST /orders", "order_id": "abc" },
      { service: "checkout", env: "prod" },
    );
    expect(labels.service).toBe("checkout");
    expect(labels.route).toBe("POST /orders");
    expect(labels.user_id).toBeUndefined();
    expect(labels.order_id).toBeUndefined();
  });
});

describe("W3C traceparent", () => {
  it("round-trips", () => {
    const header = formatTraceparent("abcdef0123456789abcdef0123456789", "0123456789abcdef");
    const parsed = parseTraceparent(header);
    expect(parsed?.traceId).toBe("abcdef0123456789abcdef0123456789");
    expect(parsed?.spanId).toBe("0123456789abcdef");
  });

  it("rejects invalid", () => {
    expect(parseTraceparent("nope")).toBeNull();
  });
});

describe("TelemetrySession", () => {
  it("flushes logs, metrics, and traces with sanitized labels", async () => {
    const transport: IngestTransport = {
      ingestLogs: vi.fn(async () => undefined),
      ingestMetrics: vi.fn(async () => undefined),
      ingestTraces: vi.fn(async () => undefined),
    };

    const session = createTelemetrySession(transport, {
      service: "test",
      environment: "test",
    });

    session.log({
      level: "info",
      message: "hello",
      labels: { order_id: "should-drop", route: "r1" },
    });
    session.metric({ name: "requests_total", type: "counter", value: 1 });
    const span = session.startSpan("work");
    span.end("ok");
    expect(session.traceparent(span.spanId)).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);

    await session.flush();

    expect(transport.ingestLogs).toHaveBeenCalledOnce();
    const logEvents = (transport.ingestLogs as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{
      labels: Record<string, string>;
    }>;
    expect(logEvents[0]!.labels.order_id).toBeUndefined();
    expect(logEvents[0]!.labels.route).toBe("r1");
    expect(transport.ingestMetrics).toHaveBeenCalledOnce();
    expect(transport.ingestTraces).toHaveBeenCalledOnce();
  });
});

describe("http transport retry", () => {
  it("retries 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = {
      fetch: vi.fn(async () => {
        calls += 1;
        if (calls < 3) {
          return new Response("busy", { status: 503 });
        }
        return new Response(JSON.stringify({ data: { accepted: 1 }, error: null }), {
          status: 202,
        });
      }),
    };

    const transport = createHttpTransport({
      apiKey: "oe_testkey_abcdefghijklmnopqrstuvwxyz012345",
      baseUrl: "https://example.test",
      fetcher: fetchImpl,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      maxBatchSize: 2,
    });

    await transport.ingestLogs([{ line: "a", labels: { service: "s" } }, { line: "b", labels: { service: "s" } }, { line: "c", labels: { service: "s" } }]);
    expect(fetchImpl.fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
