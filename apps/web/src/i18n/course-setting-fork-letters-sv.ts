import { plural } from "./plural";

/** ADR-0175, tillägg 2026-11-21 (b): nycklarna (grenarnas bokstäver) i utkast och låsta, och «Ordna nycklarna». */
export const forkLettersSv = {
  heading: "Nycklarna",
  draft: "Utkast: nycklarna ordnas medan du arbetar (A, B; C, D … i banans ordning).",
  draftKept: (letters: string) => `Utkast: nycklarna är ${letters}. De ordnas när du ändrar en gaffling, eller med «Ordna nycklarna».`,
  locked: (reason: string, at: string) => `Låst: ${reason} (${at}). En gren behåller sin bokstav, en ny gren får en oanvänd.`,
  reasons: {
    MANUAL: "låst för hand",
    PRINT: "kartor med variantkod är tryckta",
    ASSIGNED: "löpare har fått varianter i tävlingen",
    START_LIST: "startlistan är publicerad"
  },
  lock: "Lås nycklarna",
  unlock: "Häv låset",
  renumber: "Ordna nycklarna",
  renumberNothing: "Nycklarna står redan i banans ordning.",
  preview: "Förhandsvisning: gammal → ny kod",
  previewCaption: (name: string) => `Nya koder för ${name}`,
  from: "Nu",
  to: "Blir",
  same: "samma",
  excluded: "bortvald (följer med)",
  apply: "Ordna nycklarna",
  cancel: "Avbryt",
  confirmUnlock: "Häv låset för nycklarna? En gren som tas bort eller läggs till ordnar då om bokstäverna i banan.",
  confirmRenumber: "Ordna nycklarna i en låst bana? Kontrollera det som berörs nedan.",
  confirm: "Ja, fortsätt",
  affected: "Det här berörs",
  loading: "Hämtar det som berörs …",
  loadFailed: "Det som berörs gick inte att hämta. Försök igen, eller avbryt.",
  printed: (count: number) => `${plural(count, "karta", "kartor")} med variantkod i tryckjobben har den gamla koden.`,
  printedUnknown: "Kartor som skrivits ut i webbläsaren kan inte räknas.",
  startList: "Den publicerade startlistan har de gamla koderna tills den publiceras igen.",
  runners: (count: number) => `${plural(count, "löpare", "löpare")} med tilldelad variant: koden byts vid nästa «Överför till tävlingen», kontrollerna är desamma.`,
  more: (count: number) => `och ${count} till`,
  excludedAffected: (codes: string) => `Bortvalda varianter som får ny kod: ${codes}.`,
  nothingAffected: "Inga tryckta kartor, tilldelade varianter eller publicerad startlista."
};
