import type { PublicParticipantRouteComparisonResponse } from "@o-tid/contracts";
import { publicRoutePlaybackMarker, type PublicRoutePlaybackMarker } from "./public-route-playback";

type ComparisonRoute = PublicParticipantRouteComparisonResponse["routes"][number];

export function publicRouteComparisonPlaybackDuration(routes: readonly ComparisonRoute[]): number | null {
  const durations = routes.map((route) => route.playback.status === "AVAILABLE" && route.metadata.timing.status === "AVAILABLE" ? route.metadata.timing.durationMilliseconds : null);
  if (durations.length < 2) return null;
  let longest = 0;
  for (const duration of durations) {
    if (duration === null) return null;
    longest = Math.max(longest, duration);
  }
  return longest;
}

/**
 * Every selected route starts at its own relative GPX zero. A finished route
 * disappears while the others continue so the UI never presents an invented
 * later point.
 */
export function publicRouteComparisonPlaybackMarkers(routes: readonly ComparisonRoute[], elapsedMilliseconds: number): readonly (PublicRoutePlaybackMarker | null)[] | null {
  if (publicRouteComparisonPlaybackDuration(routes) === null) return null;
  return routes.map((route) => {
    if (route.playback.status !== "AVAILABLE" || route.metadata.timing.status !== "AVAILABLE" || elapsedMilliseconds > route.metadata.timing.durationMilliseconds) return null;
    return publicRoutePlaybackMarker(route.points, route.playback.pointElapsedMilliseconds, elapsedMilliseconds);
  });
}
