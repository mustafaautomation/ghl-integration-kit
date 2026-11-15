/** Count timestamps into `hours` buckets ending at `now`. Hours with no rows stay 0. */
export function bucketHours(times: Date[], now: Date, hours = 8): number[] {
  const buckets = Array.from({ length: hours }, () => 0);
  const size = 3_600_000;
  const start = now.getTime() - hours * size;
  for (const time of times) {
    const delta = time.getTime() - start;
    if (delta < 0 || delta >= hours * size) continue;
    const index = Math.min(hours - 1, Math.floor(delta / size));
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  return buckets;
}
