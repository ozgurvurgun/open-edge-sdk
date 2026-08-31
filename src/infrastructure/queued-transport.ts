import type { IngestTransport } from "../application/ports.js";

export type DropPolicy = "oldest" | "newest";

export type QueuedTransportOptions = {
  flushIntervalMs?: number;
  maxQueueEvents?: number;
  drop?: DropPolicy;
  onDrop?: (count: number) => void;
};

type Kind = "logs" | "metrics" | "traces";

type Item = { kind: Kind; events: unknown[] };

export function createQueuedTransport(
  inner: IngestTransport,
  options: QueuedTransportOptions = {},
): IngestTransport & { flushNow(): Promise<void>; pending(): number } {
  const flushIntervalMs = options.flushIntervalMs ?? 1000;
  const maxQueueEvents = options.maxQueueEvents ?? 5000;
  const drop = options.drop ?? "oldest";
  const queue: Item[] = [];
  let eventCount = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let flushing = false;

  function countEvents(item: Item): number {
    return item.events.length;
  }

  function recount(): void {
    eventCount = queue.reduce((n, item) => n + countEvents(item), 0);
  }

  function enqueue(kind: Kind, events: unknown[]): void {
    if (events.length === 0) return;
    let incoming = events;
    while (eventCount + incoming.length > maxQueueEvents && queue.length > 0) {
      if (drop === "newest") {
        const overflow = eventCount + incoming.length - maxQueueEvents;
        options.onDrop?.(Math.min(overflow, incoming.length));
        incoming = incoming.slice(0, Math.max(0, incoming.length - overflow));
        break;
      }
      const removed = queue.shift()!;
      eventCount -= countEvents(removed);
      options.onDrop?.(countEvents(removed));
    }
    if (incoming.length === 0) return;
    if (eventCount + incoming.length > maxQueueEvents) {
      const keep = maxQueueEvents - eventCount;
      options.onDrop?.(incoming.length - keep);
      incoming = incoming.slice(0, keep);
    }
    if (incoming.length === 0) return;
    queue.push({ kind, events: incoming });
    eventCount += incoming.length;
    ensureTimer();
    if (eventCount >= maxQueueEvents) {
      void flushNow();
    }
  }

  function ensureTimer(): void {
    if (flushIntervalMs <= 0 || timer) return;
    timer = setInterval(() => {
      void flushNow();
    }, flushIntervalMs);
    if (typeof timer === "object" && timer && "unref" in timer) {
      (timer as { unref?: () => void }).unref?.();
    }
  }

  async function flushNow(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, queue.length);
        recount();

        const logs: unknown[] = [];
        const metrics: unknown[] = [];
        const traces: unknown[] = [];
        for (const item of batch) {
          if (item.kind === "logs") logs.push(...item.events);
          else if (item.kind === "metrics") metrics.push(...item.events);
          else traces.push(...item.events);
        }

        const jobs: Array<{ kind: Kind; events: unknown[]; run: Promise<void> }> = [];
        if (logs.length) jobs.push({ kind: "logs", events: logs, run: inner.ingestLogs(logs) });
        if (metrics.length) {
          jobs.push({ kind: "metrics", events: metrics, run: inner.ingestMetrics(metrics) });
        }
        if (traces.length) {
          jobs.push({ kind: "traces", events: traces, run: inner.ingestTraces(traces) });
        }

        const results = await Promise.allSettled(jobs.map((j) => j.run));
        const failed: Item[] = [];
        let firstError: unknown;
        for (let i = 0; i < results.length; i += 1) {
          const result = results[i]!;
          const job = jobs[i]!;
          if (result.status === "rejected") {
            failed.push({ kind: job.kind, events: job.events });
            firstError ??= result.reason;
          }
        }
        if (failed.length > 0) {
          queue.unshift(...failed);
          recount();
          throw firstError;
        }
      }
    } finally {
      flushing = false;
      if (queue.length === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  }

  return {
    ingestLogs: async (events) => enqueue("logs", events),
    ingestMetrics: async (events) => enqueue("metrics", events),
    ingestTraces: async (events) => enqueue("traces", events),
    flushNow,
    pending: () => eventCount,
  };
}
