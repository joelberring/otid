import type { ReadoutPlacement, ReadoutStandingSummary } from "@o-tid/contracts";
import { formatDuration } from "@o-tid/domain";
import type { Texts } from "../lib/language";
import type { placementText } from "./placement-text";

/** Engelska, avläsningen: placeringen i klartext (samma regler som `placement-text.ts`). */
export const placementTextEn: Texts<typeof placementText> = {
  preliminary: "preliminary",
  offline: "The place is shown when the network is back.",
  sending: "The place is shown when the readout is saved.",
  receiptLater: "Place: see the results list (the QR code).",
  label: "Place"
};

/** 1st, 2nd, 3rd … 11th, 12th, 21st. */
export function placeOrdinalEn(position: number): string {
  const lastTwo = position % 100, last = position % 10;
  if (lastTwo >= 11 && lastTwo <= 13) return `${position}th`;
  return `${position}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

const plus = (ms: number) => `+${formatDuration(ms)}`;
const points = (value: number) => `${value} p`;

function rank(standing: ReadoutStandingSummary, suffix: string): string {
  return `${standing.tied ? "Shared " : ""}${placeOrdinalEn(standing.position)} of ${standing.finished} ${suffix}`;
}

function distance(standing: ReadoutStandingSummary, secondName: string): string | undefined {
  if (standing.ahead) {
    if (standing.ahead.points !== undefined) return `${points(standing.ahead.points)} ahead of ${secondName}`;
    return standing.ahead.ms !== undefined ? `${formatDuration(standing.ahead.ms)} ahead of ${secondName}` : undefined;
  }
  const leader = standing.leader;
  if (!leader) return undefined;
  if (standing.position === 1) return `same ${leader.pointsBehind === undefined ? "time" : "points"} as ${leader.name}`;
  if (leader.pointsBehind !== undefined) return `${points(leader.pointsBehind)} behind ${leader.name}`;
  return leader.behindMs !== undefined ? `${plus(leader.behindMs)} behind ${leader.name}` : `behind ${leader.name}`;
}

function individual(standing: ReadoutStandingSummary): string {
  if (standing.position === 1 && !standing.tied) {
    if (standing.finished === 1) return "Leading · alone at the finish";
    const ahead = distance(standing, "second");
    return ahead ? `Leading · ${ahead}` : "Leading";
  }
  return [rank(standing, "finished"), distance(standing, "second")].filter(Boolean).join(" · ");
}

function relayTeam(standing: ReadoutStandingSummary, leg: number): string {
  if (standing.position === 1 && !standing.tied) {
    if (standing.finished === 1) return `The team leads after leg ${leg} · first to finish`;
    const ahead = distance(standing, "second");
    return `The team leads after leg ${leg}${ahead ? ` · ${ahead}` : ""}`;
  }
  return [`The team ${rank(standing, `after leg ${leg}`).replace(/^S/, "s")}`, distance(standing, "second")].filter(Boolean).join(" · ");
}

function relayLeg(standing: ReadoutStandingSummary & { elapsedMs: number }): string {
  const time = `Leg time ${formatDuration(standing.elapsedMs)}`;
  if (standing.position === 1 && !standing.tied) {
    const ahead = standing.ahead?.ms !== undefined && standing.finished > 1 ? ` (${formatDuration(standing.ahead.ms)} ahead of second)` : "";
    return `${time} · best on the leg${ahead}`;
  }
  if (standing.position === 1) return `${time} · shared best on the leg`;
  const behind = standing.leader?.behindMs !== undefined ? ` · ${plus(standing.leader.behindMs)} behind the best` : "";
  return `${time} · ${rank(standing, "on the leg").replace(/^S/, "s")}${behind}`;
}

export function placementLinesEn(placement: ReadoutPlacement): string[] {
  if (placement.kind === "individual") return [individual(placement.standing)];
  return [placement.team ? relayTeam(placement.team, placement.leg) : undefined,
    placement.legTime ? relayLeg(placement.legTime) : undefined].filter((line): line is string => line !== undefined);
}
