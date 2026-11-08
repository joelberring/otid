import { plural } from "./plural";

/** Ägaren 2026-11-08: klubbens enhetsregister (fliken Enheter i klubbarkivet). */
export const clubDevicesSv = {
  help: "Klubbens SPORTident-enheter. En enhet sparas här när den läses ut eller ställs in under en tävling (Avläsning → Läs ut enheter) med klubben vald. "
    + "Batteriets ålder räknas från bytesdatumet som enheten anger; SPORTident räknar med 3–5 år för BSF8 och 4–7 år för BSF7.",
  none: "Inga enheter än. Läs ut en enhet under en tävling och välj klubben för att spara den här.",
  count: (count: number) => plural(count, "enhet", "enheter"),
  columns: { code: "Kod", serial: "Serienummer", model: "Modell", mode: "Läge", battery: "Batteri bytt", clock: "Klocka", read: "Senast läst", note: "Anteckning" },
  batteryAge: (years: number) => years < 1 ? "under ett år" : `${years.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} år`,
  batteryOld: "kontrollera",
  clock: (ms: number | null) => ms === null ? "–" : Math.abs(ms) < 2000 ? "stämde" : `${ms > 0 ? "+" : "−"}${Math.round(Math.abs(ms) / 1000)} s`,
  read: (date: string, by: string | null) => `${date}${by ? `, ${by}` : ""}`,
  noteLabel: (serial: number) => `Anteckning för ${serial}`,
  save: "Spara",
  remove: "Ta bort",
  removeConfirm: (serial: number) => `Ta bort enheten ${serial} ur registret?`,
  failed: "Det gick inte. Försök igen.",
  loading: "Hämtar enheterna …",
  modes: { 2: "Kontroll", 3: "Start", 4: "Mål", 5: "Avläsning", 7: "Nollställning", 10: "Check" } as Record<number, string>
} as const;
