import type { ReadoutPlacement, ReadoutStandingSummary } from "@o-tid/contracts";
import { formatRunningTime } from "./evaluate";
import type { QueuedReadout } from "./store";

/**
 * Steg 57: placeringen vid avläsningen i klartext, på skärmen och på kvittot. Placeringen kommer från serverns kvitto och
 * gäller de som hittills är godkända i klassen – den är preliminär och sägs vara det.
 */
export const placementText = {
  preliminary: "preliminärt",
  offline: "Placering visas när nätet är tillbaka.",
  sending: "Placering visas när avläsningen är sparad.",
  receiptLater: "Placering: se resultatlistan (QR-koden).",
  label: "Placering"
} as const;

/** Svenska ordningstal med siffror: 1:a, 2:a, 3:e … 11:e, 12:e, 21:a, 22:a. */
export function placeOrdinal(position: number): string {
  const lastTwo = position % 100;
  const last = position % 10;
  return `${position}:${(last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12 ? "a" : "e"}`;
}

const plus = (ms: number) => `+${formatRunningTime(ms)}`;
const points = (value: number) => `${value} p`;

/** Rangen: "3:a av 12 i mål", "Delad 3:e av 12 i mål". `suffix` byter "i mål" (stafett: "efter sträcka 2"). */
function rank(standing: ReadoutStandingSummary, suffix: string): string {
  return `${standing.tied ? "Delad " : ""}${placeOrdinal(standing.position)} av ${standing.finished} ${suffix}`;
}

/** Avståndet till ledaren eller marginalen till tvåan, eller undefined. */
function distance(standing: ReadoutStandingSummary, secondName: string): string | undefined {
  if (standing.ahead) {
    if (standing.ahead.points !== undefined) return `${points(standing.ahead.points)} före ${secondName}`;
    return standing.ahead.ms !== undefined ? `${formatRunningTime(standing.ahead.ms)} före ${secondName}` : undefined;
  }
  const leader = standing.leader;
  if (!leader) return undefined;
  if (standing.position === 1) return `samma ${leader.pointsBehind === undefined ? "tid" : "poäng"} som ${leader.name}`;
  if (leader.pointsBehind !== undefined) return `${points(leader.pointsBehind)} efter ${leader.name}`;
  return leader.behindMs !== undefined ? `${plus(leader.behindMs)} efter ${leader.name}` : `efter ${leader.name}`;
}

/** Individuell klass: "3:a av 12 i mål · +2:14 efter Ada Ek", "Leder · 1:05 före tvåan", "Leder · ensam i mål". */
export function individualPlacementText(standing: ReadoutStandingSummary): string {
  if (standing.position === 1 && !standing.tied) {
    if (standing.finished === 1) return "Leder · ensam i mål";
    const ahead = distance(standing, "tvåan");
    return ahead ? `Leder · ${ahead}` : "Leder";
  }
  return [rank(standing, "i mål"), distance(standing, "tvåan")].filter(Boolean).join(" · ");
}

/** Stafett: "Laget 3:a av 12 efter sträcka 2 · +2:14 efter OK Ek 1", "Laget leder efter sträcka 2 · 1:05 före tvåan". */
export function relayTeamPlacementText(standing: ReadoutStandingSummary, leg: number): string {
  if (standing.position === 1 && !standing.tied) {
    if (standing.finished === 1) return `Laget leder efter sträcka ${leg} · först i mål`;
    const ahead = distance(standing, "tvåan");
    return `Laget leder efter sträcka ${leg}${ahead ? ` · ${ahead}` : ""}`;
  }
  return [`Laget ${rank(standing, `efter sträcka ${leg}`).replace(/^D/, "d")}`, distance(standing, "tvåan")].filter(Boolean).join(" · ");
}

/** Sträcktiden: "Sträcktid 23:10 · 4:e av 10 på sträckan · +1:02 efter bästa", "Sträcktid 23:10 · bäst på sträckan". */
export function relayLegPlacementText(standing: ReadoutStandingSummary & { elapsedMs: number }): string {
  const time = `Sträcktid ${formatRunningTime(standing.elapsedMs)}`;
  if (standing.position === 1 && !standing.tied) {
    const ahead = standing.ahead?.ms !== undefined && standing.finished > 1 ? ` (${formatRunningTime(standing.ahead.ms)} före tvåan)` : "";
    return `${time} · bäst på sträckan${ahead}`;
  }
  if (standing.position === 1) return `${time} · delad bästa på sträckan`;
  const behind = standing.leader?.behindMs !== undefined ? ` · ${plus(standing.leader.behindMs)} efter bästa` : "";
  return `${time} · ${rank(standing, "på sträckan").replace(/^D/, "d")}${behind}`;
}

/** Raderna för placeringen (en för individuellt, en eller två för stafett). */
export function placementLines(placement: ReadoutPlacement): string[] {
  if (placement.kind === "individual") return [individualPlacementText(placement.standing)];
  return [placement.team ? relayTeamPlacementText(placement.team, placement.leg) : undefined,
    placement.legTime ? relayLegPlacementText(placement.legTime) : undefined].filter((line): line is string => line !== undefined);
}

/**
 * Vad avläsningen kan säga om placeringen just nu: raderna ur serverns kvitto, att den kommer när avläsningen skickats
 * (utan nät: när nätet är tillbaka), eller inget (kvitterad utan placering, avvisad).
 */
export type PlacementState =
  | { readonly kind: "known"; readonly lines: readonly string[] }
  | { readonly kind: "offline" | "sending" | "none" };

export function placementState(item: Pick<QueuedReadout, "status" | "placement"> | undefined, online: boolean): PlacementState {
  if (item?.placement) {
    const lines = placementLines(item.placement);
    return lines.length > 0 ? { kind: "known", lines } : { kind: "none" };
  }
  if (!item || item.status === "pending") return { kind: online ? "sending" : "offline" };
  return { kind: "none" };
}
