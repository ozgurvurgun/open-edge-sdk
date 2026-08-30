export const FORBIDDEN_LABEL_KEYS = new Set([
  "user_id",
  "request_id",
  "trace_id",
  "session_id",
  "order_id",
  "customer_id",
  "email",
]);

export const MAX_LABELS = 20;
export const MAX_LABEL_KEY_LENGTH = 64;
export const MAX_LABEL_VALUE_LENGTH = 256;

const KEY_RE = /^[a-z_][a-z0-9_]*$/;

export function normalizeLabelKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^([0-9])/, "_$1")
    .slice(0, MAX_LABEL_KEY_LENGTH);
}

export function sanitizeLabels(
  raw: Record<string, string> | undefined,
  defaults: Record<string, string> = {},
): Record<string, string> {
  const merged = { ...defaults, ...(raw ?? {}) };
  const out: Record<string, string> = {};
  const keys = Object.keys(merged).sort();
  for (const rawKey of keys) {
    if (Object.keys(out).length >= MAX_LABELS) break;
    const key = normalizeLabelKey(rawKey);
    if (!key || !KEY_RE.test(key) || FORBIDDEN_LABEL_KEYS.has(key)) continue;
    const value = String(merged[rawKey] ?? "")
      .trim()
      .slice(0, MAX_LABEL_VALUE_LENGTH);
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

export function sanitizeFields(raw: Record<string, string> | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = normalizeLabelKey(k);
    if (!key) continue;
    const value = String(v).trim().slice(0, MAX_LABEL_VALUE_LENGTH);
    if (value) out[key] = value;
  }
  return out;
}
