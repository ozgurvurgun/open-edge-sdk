import { describe, expect, it, vi } from "vitest";
import { shouldSample } from "./domain/sampling.js";
import { createCardinalityGuard, fingerprintLabels } from "./domain/cardinality.js";
import { createQueuedTransport } from "./infrastructure/queued-transport.js";
import { createTelemetrySession } from "./application/session.js";
import type { IngestTransport } from "./application/ports.js";
import { createInstrumentedFetch } from "./adapters/fetch.js";

describe("shouldSample", () => {
  it("always keeps at rate 1", () => {
    expect(shouldSample("abcdef0123456789abcdef0123456789", 1)).toBe(true);
  });

  it("always drops at rate 0", () => {
    expect(shouldSample("abcdef0123456789abcdef0123456789", 0)).toBe(false);
  });

  it("is deterministic for a given trace id", () => {
    const id = "11111111111111111111111111111111";
    expect(shouldSample(id, 0.5)).toBe(shouldSample(id, 0.5));
  });
});

describe("cardinality guard", () => {
  it("allows known fingerprints and rejects overflow", () => {
    const g = createCardinalityGuard(2);
    expect(g.allow("a")).toBe(true);
    expect(g.allow("b")).toBe(true);
    expect(g.allow("c")).toBe(false);
    expect(g.allow("a")).toBe(true);
    expect(g.size()).toBe(2);
  });

  it("fingerprints labels stably", () => {
    expect(fingerprintLabels({ b: "2", a: "1" })).toBe("a=1,b=2");
  });
});

describe("queued transport", () => {
  it("coalesces and flushes on demand", async () => {
    const inner: IngestTransport = {
      ingestLogs: vi.fn(async () => undefined),
      ingestMetrics: vi.fn(async () => undefined),
      ingestTraces: vi.fn(async () => undefined),
    };
    const q = createQueuedTransport(inner, { flushIntervalMs: 0, maxQueueEvents: 100 });
    await q.ingestLogs([{ a: 1 }]);
    await q.ingestLogs([{ a: 2 }]);
    expect(q.pending()).toBe(2);
    expect(inner.ingestLogs).not.toHaveBeenCalled();
    await q.flushNow();
    expect(inner.ingestLogs).toHaveBeenCalledOnce();
    expect((inner.ingestLogs as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(2);
    expect(q.pending()).toBe(0);
  });

  it("drops oldest under pressure", async () => {
    const drops: number[] = [];
    const inner: IngestTransport = {
      ingestLogs: vi.fn(async () => undefined),
      ingestMetrics: vi.fn(async () => undefined),
      ingestTraces: vi.fn(async () => undefined),
    };
    const q = createQueuedTransport(inner, {
      flushIntervalMs: 0,
      maxQueueEvents: 2,
      drop: "oldest",
      onDrop: (n) => drops.push(n),
    });
    // Single oversized batch; excess dropped immediately.
    await q.ingestLogs([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(drops.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(q.pending()).toBeLessThanOrEqual(2);
  });

  it("keeps only failed kinds after a partial flush", async () => {
    const inner: IngestTransport = {
      ingestLogs: vi.fn(async () => undefined),
      ingestMetrics: vi.fn(async () => {
        throw new Error("metrics down");
      }),
      ingestTraces: vi.fn(async () => undefined),
    };
    const q = createQueuedTransport(inner, { flushIntervalMs: 0, maxQueueEvents: 100 });
    await q.ingestLogs([{ eventId: "l1" }]);
    await q.ingestMetrics([{ eventId: "m1" }]);
    await expect(q.flushNow()).rejects.toThrow("metrics down");
    expect(inner.ingestLogs).toHaveBeenCalledOnce();
    expect(q.pending()).toBe(1);

    (inner.ingestMetrics as ReturnType<typeof vi.fn>).mockImplementation(async () => undefined);
    await q.flushNow();
    expect(inner.ingestLogs).toHaveBeenCalledOnce();
    expect(inner.ingestMetrics).toHaveBeenCalledTimes(2);
    expect(q.pending()).toBe(0);
  });
});

describe("sampling in session", () => {
  it("skips flush when sampleRate is 0", async () => {
    const transport: IngestTransport = {
      ingestLogs: vi.fn(async () => undefined),
      ingestMetrics: vi.fn(async () => undefined),
      ingestTraces: vi.fn(async () => undefined),
    };
    const session = createTelemetrySession(
      transport,
      { service: "s", environment: "e" },
      { sampleRate: 0 },
    );
    session.log({ level: "info", message: "x" });
    await session.flush();
    expect(transport.ingestLogs).not.toHaveBeenCalled();
  });
});

describe("instrumented fetch", () => {
  it("injects traceparent and records a span", async () => {
    const transport: IngestTransport = {
      ingestLogs: vi.fn(async () => undefined),
      ingestMetrics: vi.fn(async () => undefined),
      ingestTraces: vi.fn(async () => undefined),
    };
    const session = createTelemetrySession(transport, {
      service: "s",
      environment: "e",
    });
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      expect(h.get("traceparent")).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
      return new Response("ok", { status: 200 });
    });
    const fetchIx = createInstrumentedFetch(session, base as unknown as typeof fetch);
    await fetchIx("https://example.test/x", { method: "POST" });
    await session.flush();
    expect(transport.ingestTraces).toHaveBeenCalledOnce();
  });
});
