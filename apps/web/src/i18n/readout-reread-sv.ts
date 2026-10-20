import { formatDuration } from "../lib/clock-time";

/** Läs om avläsningar från rådata (PLAN.md steg 36). */
type Status = "OK" | "OVERTIME" | "MP" | "UNKNOWN_CARD";
type ManualDecision = "DSQ" | "APPROVAL" | "DNF" | "OOC" | "NT" | "FINISH_TIME" | "START_TIME" | "MANUAL_TIME" | "CONTROL_APPROVAL";

const status: Record<Status, string> = { OK: "Godkänd", OVERTIME: "Maxtid", MP: "Felstämplad", UNKNOWN_CARD: "Okänd bricka" };
const punches = (count: number) => `${count} ${count === 1 ? "stämpling" : "stämplingar"}`;

export const readoutRereadSv = {
  title: "Läs om avläsningar från rådata",
  help: "Läser varje sparad avläsning på nytt från brickans råa data med den nuvarande avläsningen, med samma klocka som när brickan lästes. Bara de som blir annorlunda visas. Den gamla avläsningen sparas alltid.",
  show: "Visa vad som händer",
  confirm: "Spara och räkna om",
  cancel: "Avbryt",
  retry: "Försök igen",
  checked: (count: number) => `${count} ${count === 1 ? "avläsning lästes" : "avläsningar lästes"} om.`,
  noChanges: "Ingen avläsning blir annorlunda.",
  changes: (count: number) => `${count} ${count === 1 ? "avläsning blir annorlunda" : "avläsningar blir annorlunda"}:`,
  choose: "Läs om",
  side: (count: number, value: Status, elapsedMs: number | null) =>
    `${punches(count)}, ${status[value]}${elapsedMs !== null ? ` ${formatDuration(elapsedMs)}` : ""}`,
  card: (cardNumber: string) => `Bricka ${cardNumber}`,
  manual: (decision: ManualDecision) => `${readoutRereadSv.decisions[decision]} gäller fortfarande. Ta bort den med "${readoutRereadSv.withdrawals[decision]}" i deltagarkortet om omläsningen ska gälla.`,
  decisions: { DSQ: "Diskvalifikationen", APPROVAL: "Det manuella godkännandet", DNF: "Brutit", OOC: "Utom tävlan",
    NT: "Utan tidtagning", FINISH_TIME: "Den rättade måltiden", START_TIME: "Den rättade starttiden", MANUAL_TIME: "Den manuella tiden",
    CONTROL_APPROVAL: "De godkända kontrollerna" } satisfies Record<ManualDecision, string>,
  withdrawals: { DSQ: "Ta bort diskvalificering", APPROVAL: "Ta bort manuellt godkännande", DNF: "Ta bort brutit",
    OOC: "Ta bort utom tävlan", NT: "Ta bort utan tidtagning", FINISH_TIME: "Ta bort manuell tid", START_TIME: "Ta bort manuell tid",
    MANUAL_TIME: "Ta bort manuell tid", CONTROL_APPROVAL: "Ta bort godkända kontroller" } satisfies Record<ManualDecision, string>,
  unreadableTitle: "Går inte att läsa om",
  unreadable: (cardNumber: string, name: string, detail: string) => `Bricka ${cardNumber} · ${name}: ${detail}`,
  unreadableReasons: { FRAMES: "råa data går inte att avkoda", TIME: "tiderna går inte att placera", PAYLOAD: "råa data saknas" },
  notSaved: "Inget är sparat än.",
  noneChosen: "Välj minst en avläsning.",
  saved: (count: number) => `Sparat. ${count} ${count === 1 ? "avläsning lästes" : "avläsningar lästes"} om och räknades om.`,
  conflict: "Något har ändrats sedan du tryckte på Visa vad som händer. Visa igen.",
  invalid: "Förfrågan gick inte att tolka. Visa igen.",
  unreachable: "Servern svarar inte. Inget är bekräftat sparat; försök igen.",
  cardRow: "Avläsningen kan läsas om från rådata",
  cardReview: "Läs om avläsningen"
};
