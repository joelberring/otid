/**
 * Beskedet för den senaste avläsningen, bedömt om när paketet eller den här webbläsarens direktanmälningar ändras, och om
 * brickan redan har lästs ut för någon annan (lånad bricka, steg 31).
 */
import { useMemo } from "react";
import type { ReadoutPackage } from "@o-tid/contracts";
import { evaluateLocally, linkedVariants, withLocalRegistrations } from "./evaluate";
import type { QueuedReadout, QueuedRegistration } from "./store";
import type { Current } from "./verdict-panel";

export function useCurrentVerdict({ current, pkg, items, registrations }: { current: Current | undefined; pkg: ReadoutPackage | undefined;
  items: readonly QueuedReadout[]; registrations: readonly QueuedRegistration[] }) {
  // Paketet med den här webbläsarens direktanmälningar, så att en anmäld bricka bedöms lokalt även utan nät (PLAN.md steg 25).
  const effectivePkg = useMemo(() => pkg ? withLocalRegistrations(pkg, registrations) : undefined, [pkg, registrations]);
  const currentItem = current?.phase === "done" ? items.find((item) => item.localSequence === current.localSequence) : undefined;
  // Beskedet bedöms om när paketet eller anmälningarna ändras, så att "Lägg till" ger beskedet för den nya löparen direkt.
  const localVerdict = useMemo(() => {
    if (current?.phase !== "done") return undefined;
    if (!currentItem || !effectivePkg) return current.verdict;
    const earlier = items.filter((item) => item.localSequence < currentItem.localSequence).map((item) => item.payload);
    return evaluateLocally(currentItem.payload, effectivePkg, earlier, currentItem.stationReceivedAt,
      pkg ? linkedVariants(pkg, registrations) : undefined);
  }, [current, currentItem, effectivePkg, items, pkg, registrations]);
  // Steg 31 (B4): brickan har redan lästs ut för någon annan. Serverns svar avgör: okänd = lånad bricka (den förstes
  // resultat skrivs inte över), ett resultat = samma avläsning igen. Utan svar räcker en tidigare annorlunda avläsning här.
  const registeredHere = current?.phase === "done" && registrations.some((row) => row.request.cardNumber === current.cardNumber &&
    row.localSequence === current.localSequence && row.status !== "rejected");
  const alreadyReadOut = !registeredHere && localVerdict?.alreadyReadOutBy && (currentItem?.serverResult
    ? currentItem.serverResult.status === "UNKNOWN_CARD" : true) ? localVerdict.alreadyReadOutBy : undefined;
  const borrowed = alreadyReadOut && (alreadyReadOut.certain || currentItem?.serverResult?.status === "UNKNOWN_CARD")
    ? alreadyReadOut : undefined;
  const verdict = useMemo(() => localVerdict && borrowed
    ? { ...localVerdict, status: "UNKNOWN_CARD" as const, reason: "UNKNOWN_CARD" as const, missingControls: [], splits: [] }
    : localVerdict, [localVerdict, borrowed]);
  const currentRegistration = current?.phase === "done"
    ? registrations.filter((row) => row.request.cardNumber === current.cardNumber).at(-1) : undefined;
  return { effectivePkg, currentItem, verdict, alreadyReadOut, borrowed, currentRegistration };
}
