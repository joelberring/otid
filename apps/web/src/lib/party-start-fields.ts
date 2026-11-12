import { formatPartyTime } from "@o-tid/domain";

/**
 * Användartestet 2026-11-12: fälten för festens start. En sparad start visas; utan sparad start är fälten tomma (med
 * platshållare), så att ett förifyllt datum och klockslag inte ser sparat ut. Klockslaget går inte att gissa.
 */
export function partyStartFields(startsAt: string | null | undefined, timeZone: string): { date: string; clock: string; saved: boolean } {
  if (!startsAt) return { date: "", clock: "", saved: false };
  const current = formatPartyTime(startsAt, timeZone);
  return { date: current.slice(0, 10), clock: current.slice(11, 16), saved: true };
}
