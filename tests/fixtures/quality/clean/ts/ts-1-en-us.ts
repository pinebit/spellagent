/**
 * Returns the number of whole days between two dates.
 *
 * Both arguments are interpreted in UTC, so daylight saving changes never
 * shift the result. The order of the arguments does not matter.
 *
 * @param start - The earlier or later date.
 * @param end - The other date.
 */
export function daysBetween(start: Date, end: Date): number {
  // Convert to UTC midnight before subtracting to avoid partial days.
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const second = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.abs(second - first) / 86_400_000;
}
