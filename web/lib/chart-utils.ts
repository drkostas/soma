/**
 * Shared chart utilities for Soma.
 * Extracted to eliminate ~20× duplication of tick dedup logic across chart components.
 */

/**
 * Returns true if the data spans more than 60 days.
 */
export function isLongRange(chartData: { date: string }[]): boolean {
  if (chartData.length < 2) return false;
  const spanDays =
    (new Date(chartData[chartData.length - 1].date).getTime() -
      new Date(chartData[0].date).getTime()) /
    86400000;
  return spanDays > 60;
}

/**
 * Builds a deduplicated tick date array for long-range charts (one tick per month).
 * Returns undefined for short-range data, letting Recharts choose ticks automatically.
 */
export function buildChartTicks(chartData: { date: string }[]): string[] | undefined {
  if (!isLongRange(chartData)) return undefined;
  const seen = new Set<string>();
  return chartData
    .filter((d) => {
      const key = new Date(d.date).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((d) => d.date);
}

/**
 * Formats a chart tick date label.
 * Long-range: "Mar '25". Short-range: "Mar 5".
 */
export function formatChartTick(dateStr: string, longRange: boolean): string {
  const date = new Date(dateStr);
  return longRange
    ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
