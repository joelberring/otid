import type { RaceType } from "@o-tid/contracts";
import type { SectionLabel } from "../lib/race-sections";

/** ADR-0170: tävlingstyperna, delarnas namn och arbetsytans skal. */
export const raceTypeSv = {
  types: {
    TRAINING: { name: "Träning", help: "Fri start. Banor och klasser på samma ställe, deltagare, avläsning och resultat." },
    SMALL: { name: "Liten tävling", help: "Klasser, anmälda och starttider utan lottning. För närtävlingar och klubbmästerskap." },
    STANDARD: { name: "Tävling", help: "Lottning, import, speaker och fastställda resultat." },
    FORKED: { name: "Tävling med gafflade banor", help: "Som Tävling, med banvarianter och gafflingskontroll." },
    RELAY: { name: "Stafett", help: "Lag och sträckor, masstart och omstart, lagresultat och speaker." },
    ROGAINING: { name: "Rogaining", help: "Valfria kontroller med poäng, tidsgräns och straff. Resultat på poäng, sedan tid." }
  } satisfies Record<RaceType, { name: string; help: string }>,
  typeLegend: "Typ av tävling",
  sections: {
    COURSES: "Banor", COURSES_CLASSES: "Banor & klasser", CONTROLS_POINTS: "Kontroller & poäng", CLASSES: "Klasser",
    CLASSES_LEGS: "Klasser & sträckor", ENTRIES: "Anmälda", PARTICIPANTS: "Deltagare", TEAMS: "Lag", START: "Start",
    READOUT: "Avläsning", RESULTS: "Resultat", SETTINGS: "Inställningar"
  } satisfies Record<SectionLabel, string>,
  navigation: "Tävlingens delar",
  start: "Start",
  speaker: "Speaker",
  openSpeaker: "Öppna speaker",
  openReadout: "Öppna avläsningen",
  newTab: "öppnas i ny flik",
  attention: "Behöver åtgärd",
  liveState: "Läget just nu",
  live: { readOut: "avlästa", inForest: "kvar i skogen", unknown: (count: number) => count === 1 ? "okänd bricka" : "okända brickor" },
  shortcuts: "Genvägar",
  settings: {
    title: "Inställningar",
    help: "Namn, datum och typ. Att byta typ ändrar bara vilka delar som syns; inget tas bort.",
    eventName: "Tävlingens namn",
    raceName: "Loppets namn",
    raceDate: "Datum",
    raceDateLocked: "Datumet kan inte ändras när det finns starttider eller avläsningar.",
    save: "Spara inställningar",
    saved: "Inställningarna är sparade.",
    conflict: "Inställningarna kunde inte sparas: något har ändrats under tiden. Uppdatera och försök igen.",
    failed: "Inställningarna kunde inte sparas. Försök igen.",
    staff: "Funktionärer",
    staffHelp: "Personer som hjälper till vid start och mål utan eget konto.",
    import: "Import",
    importHelp: "Läs in anmälda eller en startlista från en IOF XML-fil. Banfiler läses in under Banor, Eventor ovan.",
    importLink: "Öppna import"
  }
} as const;
