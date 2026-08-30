import type { IngestTransport } from "../application/ports.js";

export type FetchLike = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type HttpTransportOptions = {
  apiKey: string;
  baseUrl?: string;
  fetcher?: FetchLike;
  maxBatchSize?: number;
  retry?: RetryOptions;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function createHttpTransport(options: HttpTransportOptions): IngestTransport {
  if (!options.fetcher && !options.baseUrl) {
    throw new Error("@open-edge/sdk: provide either fetcher (service binding) or baseUrl");
  }
  if (!options.apiKey?.startsWith("oe_")) {
    throw new Error("@open-edge/sdk: apiKey must start with oe_");
  }

  const fetchImpl = options.fetcher ?? { fetch: globalThis.fetch.bind(globalThis) };
  const origin = options.fetcher
    ? "https://open-edge.internal"
    : options.baseUrl!.replace(/\/$/, "");
  const maxBatchSize = options.maxBatchSize ?? 100;
  const maxAttempts = options.retry?.maxAttempts ?? 3;
  const baseDelayMs = options.retry?.baseDelayMs ?? 50;
  const maxDelayMs = options.retry?.maxDelayMs ?? 2000;

  async function postOnce(path: string, body: unknown): Promise<void> {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json",
      "oe-api-key": options.apiKey,
      "x-api-key": options.apiKey,
      authorization: `Bearer ${options.apiKey}`,
    });
    const res = await fetchImpl.fetch(
      new Request(`${origin}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`Open Edge ${path} → ${res.status}: ${text.slice(0, 200)}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
  }

  async function postWithRetry(path: string, body: unknown): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await postOnce(path, body);
        return;
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number }).status;
        const retryable = status === undefined || isRetryableStatus(status);
        if (!retryable || attempt === maxAttempts) break;
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        const jitter = Math.floor(Math.random() * delay * 0.2);
        await sleep(delay + jitter);
      }
    }
    throw lastError;
  }

  async function ingestBatched(path: string, events: unknown[]): Promise<void> {
    if (events.length === 0) return;
    for (const batch of chunk(events, maxBatchSize)) {
      await postWithRetry(path, { events: batch });
    }
  }

  return {
    ingestLogs: (events) => ingestBatched("/api/v1/logs/ingest", events),
    ingestMetrics: (events) => ingestBatched("/api/v1/metrics/ingest", events),
    ingestTraces: (events) => ingestBatched("/api/v1/traces/ingest", events),
  };
}
