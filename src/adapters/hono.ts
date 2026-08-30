import type { Context, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { OpenEdge } from "../facade/open-edge.js";
import type { LiveSpan, TelemetrySession } from "../application/ports.js";

export type OpenEdgeHonoVariables = {
  openEdge: TelemetrySession;
  openEdgeRoot: LiveSpan;
};

export type OpenEdgeMiddlewareOptions = {
  ignorePaths?: string[];
  useWaitUntil?: boolean;
  httpMetrics?: boolean;
};

type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

function routeLabel(c: Context): string {
  const matched = routePath(c, -1);
  const path =
    matched && matched !== "/*" && matched !== "*" ? matched : c.req.path;
  return `${c.req.method} ${path}`;
}

export function openEdgeMiddleware(
  oe: OpenEdge,
  options: OpenEdgeMiddlewareOptions = {},
): MiddlewareHandler {
  const ignore = new Set(options.ignorePaths ?? ["/health", "/favicon.ico"]);
  const useWaitUntil = options.useWaitUntil !== false;
  const httpMetrics = options.httpMetrics !== false;

  return async (c, next) => {
    if (ignore.has(c.req.path)) {
      await next();
      return;
    }

    const session = oe.session({
      traceparent: c.req.header("traceparent"),
    });
    const root = session.startSpan(`HTTP ${c.req.method} ${c.req.path}`, {
      parentSpanId: null,
      attributes: {
        http_method: c.req.method,
        http_path: c.req.path,
      },
    });
    session.rootSpanId = root.spanId;

    c.set("openEdge", session);
    c.set("openEdgeRoot", root);
    c.header("traceparent", session.traceparent(root.spanId));

    const started = Date.now();
    let finished = false;

    const recordHttp = (status: number) => {
      if (httpMetrics) {
        const route = routeLabel(c);
        session.metric({
          name: "http_requests_total",
          type: "counter",
          value: 1,
          labels: { route, status: String(status) },
        });
        session.metric({
          name: "http_request_duration_ms",
          type: "histogram",
          value: Math.max(0, Date.now() - started),
          labels: { route },
        });
      }
    };

    try {
      await next();
      const status = c.res?.status ?? 200;
      root.end(status >= 500 ? "error" : "ok", { http_status: String(status) });
      recordHttp(status);
      finished = true;
    } catch (error) {
      root.end("error", { http_status: "500" });
      recordHttp(500);
      finished = true;
      throw error;
    } finally {
      if (!finished) {
        root.end("error");
      }
      const flush = session.flush().then(() => oe.flush());
      const exec = (c as Context & { executionCtx?: WaitUntilCtx }).executionCtx;
      if (useWaitUntil && exec?.waitUntil) {
        exec.waitUntil(flush);
      } else {
        await flush;
      }
    }
  };
}
