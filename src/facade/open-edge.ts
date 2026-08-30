import { createTelemetrySession } from "../application/session.js";
import type { TelemetrySession } from "../application/ports.js";
import {
  createHttpTransport,
  type FetchLike,
  type RetryOptions,
} from "../infrastructure/http-transport.js";
import {
  createQueuedTransport,
  type DropPolicy,
  type QueuedTransportOptions,
} from "../infrastructure/queued-transport.js";
import { createSpillOnFailureTransport } from "../infrastructure/spill-transport.js";
import { parseTraceparent } from "../domain/trace-context.js";
import { createCardinalityGuard, type CardinalityGuard } from "../domain/cardinality.js";
import type { IngestTransport } from "../application/ports.js";

export type OpenEdgeOptions = {
  apiKey: string;
  service: string;
  environment: string;
  baseUrl?: string;
  fetcher?: FetchLike;
  maxBatchSize?: number;
  retry?: RetryOptions;
  sampleRate?: number;
  maxCardinality?: number;
  queue?: boolean | QueuedTransportOptions;
  durableSpill?: boolean;
  onFlushError?: (error: unknown) => void;
  onDrop?: (count: number) => void;
};

type Queued = IngestTransport & { flushNow(): Promise<void>; pending(): number };

export class OpenEdge {
  private readonly transport: IngestTransport;
  private readonly queued: Queued | null;
  private readonly identity;
  private readonly onFlushError?: (error: unknown) => void;
  private readonly sampleRate: number;
  private readonly cardinality: CardinalityGuard;

  public constructor(options: OpenEdgeOptions) {
    let http: IngestTransport = createHttpTransport({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetcher: options.fetcher,
      maxBatchSize: options.maxBatchSize,
      retry: options.retry,
    });

    if (options.durableSpill) {
      http = createSpillOnFailureTransport(http, {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        fetcher: options.fetcher,
      });
    }

    if (options.queue) {
      const qopts: QueuedTransportOptions =
        typeof options.queue === "boolean" ? {} : options.queue;
      this.queued = createQueuedTransport(http, {
        ...qopts,
        onDrop: options.onDrop ?? qopts.onDrop,
      });
      this.transport = this.queued;
    } else {
      this.queued = null;
      this.transport = http;
    }

    this.identity = {
      service: options.service,
      environment: options.environment,
    };
    this.onFlushError = options.onFlushError;
    this.sampleRate = options.sampleRate ?? 1;
    this.cardinality = createCardinalityGuard(options.maxCardinality ?? 2000);
  }

  public session(options?: {
    traceId?: string;
    parentSpanId?: string | null;
    traceparent?: string | null;
  }): TelemetrySession {
    const parent = options?.traceparent ? parseTraceparent(options.traceparent) : null;
    const session = createTelemetrySession(this.transport, this.identity, {
      traceId: options?.traceId ?? parent?.traceId,
      parentSpanId: options?.parentSpanId ?? parent?.spanId ?? null,
      onFlushError: this.onFlushError,
      sampleRate: this.sampleRate,
      cardinality: this.cardinality,
    });
    return session;
  }

  public async flush(): Promise<void> {
    await this.queued?.flushNow();
  }

  public pending(): number {
    return this.queued?.pending() ?? 0;
  }
}

export type { DropPolicy };
