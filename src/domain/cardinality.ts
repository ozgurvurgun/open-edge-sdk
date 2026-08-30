export type CardinalityGuard = {
  allow(fingerprint: string): boolean;
  size(): number;
};

export function createCardinalityGuard(maxUnique: number): CardinalityGuard {
  const seen = new Set<string>();
  return {
    allow(fingerprint: string) {
      if (seen.has(fingerprint)) return true;
      if (seen.size >= maxUnique) return false;
      seen.add(fingerprint);
      return true;
    },
    size: () => seen.size,
  };
}

export function fingerprintLabels(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(",");
}
