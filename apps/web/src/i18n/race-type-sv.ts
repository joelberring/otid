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
  functionary: "Funktionär",
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
    people: {
      title: "Personer med behörighet",
      help: "Funktionärer når avläsning, direktanmälan av okänd bricka, kvar i skogen, start och speaker. Administratörer når allt. Personen loggar in med sitt eget konto.",
      loading: "Hämtar personer …",
      loadError: "Listan kunde inte hämtas. Försök igen.",
      name: "Namn",
      email: "E-post",
      role: "Roll",
      roles: { OWNER: "Ägare", ADMIN: "Administratör", FUNCTIONARY: "Funktionär" },
      you: "du",
      remove: "Ta bort",
      removeLabel: (name: string) => `Ta bort behörigheten för ${name}`,
      confirmRemove: (name: string) => `Ta bort ${name}s behörighet? Personen förlorar åtkomsten direkt.`,
      removed: (name: string) => `${name} har inte längre behörighet.`,
      addTitle: "Lägg till person",
      addEmail: "E-postadress",
      addEmailHelp: "Samma adress som personen loggar in med.",
      addRole: "Roll",
      add: "Lägg till",
      added: (name: string, role: string) => `${name} är tillagd som ${role.toLowerCase()}.`,
      noAccount: "Det finns inget konto med den adressen. Be personen skapa ett konto med den adressen först.",
      already: "Personen har redan behörighet på tävlingen.",
      ownerOnly: "Bara ägaren kan lägga till och ta bort administratörer.",
      failed: "Ändringen kunde inte sparas. Försök igen.",
      sessionExpired: "Sessionen har gått ut. Ladda om sidan och försök igen."
    },
    import: "Import",
    importHelp: "Läs in anmälda eller en startlista från en IOF XML-fil. Banfiler läses in under Banor, Eventor ovan.",
    importLink: "Öppna import"
  }
} as const;
