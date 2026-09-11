/** Readiness on the web: the 0-100 score comes from banister; the Tailwind class per traffic light is this surface's. */
export { readinessScore } from "banister";

/** Tailwind text-color class for a model traffic light. */
export function trafficLightText(light: string | null | undefined): string {
  switch (light) {
    case "green":
      return "text-green-400";
    case "yellow":
      return "text-yellow-400";
    case "red":
      return "text-red-400";
    default:
      return "text-foreground";
  }
}
