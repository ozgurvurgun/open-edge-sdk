export function shouldSample(traceId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  let hash = 0;
  for (let i = 0; i < traceId.length; i += 1) {
    hash = (hash * 31 + traceId.charCodeAt(i)) >>> 0;
  }
  return hash / 0xffff_ffff < sampleRate;
}
