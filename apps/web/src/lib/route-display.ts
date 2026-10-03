import type { PublicParticipantRouteViewResponse } from "@o-tid/contracts";

type RouteTiming = PublicParticipantRouteViewResponse["metadata"]["timing"];

export function routeDistance(meters: number): string { return meters < 1_000 ? `${Math.round(meters)} m` : `${(meters / 1_000).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} km`; }
export function routeDuration(milliseconds: number): string { const totalSeconds = Math.floor(milliseconds / 1_000), hours = Math.floor(totalSeconds / 3_600), minutes = Math.floor((totalSeconds % 3_600) / 60), seconds = totalSeconds % 60; return hours > 0 ? `${hours} h ${minutes} min` : minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`; }
export function routeTimingText(timing: RouteTiming, timeless: string): string { return timing.status === "AVAILABLE" ? `${timing.startedAt.slice(11, 19)}–${timing.finishedAt.slice(11, 19)} (${routeDuration(timing.durationMilliseconds)})` : timeless; }
