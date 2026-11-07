/** ADR-0180 beslut 13: förslag på kontrollbeskrivning ur kartfilen. */
export const courseSettingSuggestSv = {
  heading: (label: string) => `Förslag för ${label}`,
  level: { HIGH: "säkert", MEDIUM: "troligt", LOW: "osäkert" } as Record<string, string>,
  confidence: (level: string, percent: number) => `${level} (${percent} %)`,
  accept: "Godta",
  acceptEmpty: (count: number) => `Godta alla tomma (${count})`,
  acceptEmptyHelp: "Bästa förslaget för varje kontroll i vyn som saknar detalj (kolumn D).",
  alternatives: "Andra tolkningar",
  alternative: (text: string, reason: string) => `Godta ${text}: ${reason}`,
  computing: "Räknar förslag ur kartan …",
  failed: "Förslagen kunde inte räknas ur kartfilen.",
  none: "Kartan har inget tydligt objekt i ringen. Välj symbolerna själv.",
  noMap: "Förslag kräver kartfilen (OCAD eller Mapper).",
  hover: "Peka på ett förslag för att se objektet på kartan.",
  preview: "förslag",
  previewHelp: (count: number) => count === 1 ? "1 kontroll visar ett förslag (ljusare) tills det godtas."
    : `${count} kontroller visar förslag (ljusare) tills de godtas.`,
  field: (text: string) => `Förslag: ${text}`,
};
