import type { IngestTransport } from "../application/ports.js";
import type { FetchLike } from "./http-transport.js";

export type SpillOptions = {
  apiKey: string;
  baseUrl?: string;
  fetcher?: FetchLike;
};

export function createSpillOnFailureTransport(
  inner: IngestTransport,
  options: SpillOptions,
): IngestTransport {
  const base = (options.baseUrl ?? "").replace(/\/$/, "");
  const fetcher: FetchLike =
    options.fetcher ?? { fetch: globalThis.fetch.bind(globalThis) };

  async function spill(kind: "logs" | "metrics" | "traces", events: unknown[]): Promise<void> {
    if (events.length === 0) return;
    const url = `${base}/api/v1/buffer/enqueue`;
    const items = events.map((payload) => ({
      kind,
      payload,
      eventId: globalThis.crypto.randomUUID(),
    }));
    const res = await fetcher.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oe-api-key": options.apiKey,
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      throw new Error(`open_edge_spill_failed:${res.status}`);
    }
  }

  return {
    async ingestLogs(events) {
      try {
        await inner.ingestLogs(events);
      } catch {
        await spill("logs", events);
      }
    },
    async ingestMetrics(events) {
      try {
        await inner.ingestMetrics(events);
      } catch {
        await spill("metrics", events);
      }
    },
    async ingestTraces(events) {
      try {
        await inner.ingestTraces(events);
      } catch {
        await spill("traces", events);
      }
    },
  };
}
