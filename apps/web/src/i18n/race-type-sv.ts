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
    ROGAINING: { name: "Rogaining", help: "Valfria kontroller med poäng, tidsgräns och straff. Resultat på poäng, sedan tid." },
    PARTY: { name: "Fest", help: "Bardisk: gästerna stämplar själva på varornas enheter och läser ut brickan. Köp, summa per person och export." }
  } satisfies Record<RaceType, { name: string; help: string }>,
  typeLegend: "Typ av tävling",
  sections: {
    COURSES: "Banor", COURSES_CLASSES: "Banor & klasser", CONTROLS_POINTS: "Kontroller & poäng", CLASSES: "Klasser",
    CLASSES_LEGS: "Klasser & sträckor", ENTRIES: "Anmälda", PARTICIPANTS: "Deltagare", TEAMS: "Lag", START: "Start", PUBLISH: "Publicera",
    READOUT: "Avläsning", RESULTS: "Resultat", PARTY: "Fest", SETTINGS: "Inställningar"
  } satisfies Record<SectionLabel, string>,
  navigation: "Tävlingens delar",
  start: "Start",
  speaker: "Speaker",
  openSpeaker: "Öppna speaker",
  openReadout: "Öppna avläsningen",
  openPartyDesk: "Öppna bardisken",
  newTab: "öppnas i ny flik",
  attention: "Behöver åtgärd",
  liveState: "Läget just nu",
  functionary: "Funktionär",
  live: { readOut: "avlästa", inForest: "kvar i skogen", unknown: (count: number) => count === 1 ? "okänd bricka" : "okända brickor" },
  shortcuts: "Genvägar",
  menu: "Meny",
  settings: {
    title: "Inställningar",
    help: "Namn, datum och typ. Att byta typ ändrar bara vilka delar som syns; inget tas bort.",
    eventName: "Tävlingens namn",
    raceName: "Etapp/lopp",
    raceNameHelp: "Till exempel Etapp 1 eller Torsdag. Lämna tomt om evenemanget bara har ett lopp.",
    raceDate: "Datum",
    raceDateLocked: "Datumet kan inte ändras när någon har läst ut eller har resultat.",
    /** ADR-0187 beslut 3: datumet flyttas med starttiderna. */
    dateMove: {
      help: "Starttiderna följer med till det nya datumet med samma klockslag. Du ser vad som händer innan det sparas.",
      title: "Flytta tävlingen",
      summary: (from: string, to: string) => `Tävlingen flyttas från ${from} till ${to}. Starttiderna behåller sina klockslag.`,
      startTimes: (count: number, first: string, last: string) =>
        `${count === 1 ? "1 löpare" : `${count} löpare`} med starttid ${first === last ? first : `${first}–${last}`} får samma tid det nya datumet.`,
      drawClasses: (count: number) => count === 1 ? "Lottningen för 1 klass följer med, med vakanta tider." : `Lottningen för ${count} klasser följer med, med vakanta tider.`,
      relayLegs: (count: number) => count === 1 ? "1 stafettsträcka med masstart eller omstart följer med." : `${count} stafettsträckor med masstart eller omstart följer med.`,
      after: (firstDay: string, first: string, lastDay: string, last: string) => firstDay === lastDay
        ? `Efter flytten: ${firstDay} ${first}–${last}.` : `Efter flytten: ${firstDay} ${first} till ${lastDay} ${last}.`,
      republish: "Startlistan är publicerad. Publicera den igen under Start när tävlingen är flyttad.",
      journal: "Flytten sparas i en enda ändring och står i tävlingens historik med varje löpares gamla och nya tid.",
      confirm: "Flytta tävlingen och starttiderna",
      cancel: "Avbryt",
      saved: (date: string) => `Tävlingen är flyttad till ${date} med samma starttider.`,
      blockedTitle: (date: string) => `Tävlingen kan inte flyttas till ${date}: den har redan börjat.`,
      blocked: { READOUTS: "Någon har läst ut sin bricka.", PUNCHES: "Det finns stämplingar från radiokontroller.",
        CHECKINS: "Någon är incheckad vid starten.", RESULTS: "Det finns resultat." }
    },
    save: "Spara inställningar",
    saved: "Inställningarna är sparade.",
    conflict: "Inställningarna kunde inte sparas: något har ändrats under tiden. Uppdatera och försök igen.",
    failed: "Inställningarna kunde inte sparas. Försök igen.",
    people: {
      title: "Personer med behörighet",
      help: "Funktionärer når avläsning, direktanmälan av okänd bricka, kvar i skogen, start och speaker. De ser deltagarnas fulla namn och kan ladda ner festens köp som CSV-fil. Administratörer når allt. Banläggning ger bara banläggningen på den här tävlingen: ändra, föreslå ändringar eller läsa och kommentera. Kartritaren ser bara kartan och kartfelen (inga banor eller kontroller, inga foton), svarar och markerar dem klara; ett kartfel nära en kontroll kan ändå avslöja den. Personen loggar in med sitt eget konto; behörigheten gäller när personen har bekräftat sin e-postadress.",
      loading: "Hämtar personer …",
      loadError: "Listan kunde inte hämtas. Försök igen.",
      name: "Namn",
      email: "E-post",
      role: "Roll",
      roles: { OWNER: "Ägare", ADMIN: "Administratör", FUNCTIONARY: "Funktionär", COURSE_EDIT: "Banläggning: ändra",
        COURSE_SUGGEST: "Banläggning: föreslå", COURSE_COMMENT: "Banläggning: läsa och kommentera",
        COURSE_MAP: "Kartritare: bara kartan och kartfelen" },
      you: "du",
      /** ADR-0186: behörigheten gäller först när personen har bekräftat sin e-postadress. */
      pendingVerification: "väntar på bekräftad e-post",
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
    publishLink: "Publiceringen och tävlingssidans adress finns i steget Publicera.",
    publishOpen: "Gå till Publicera",
    import: "Import",
    importHelp: "Läs in anmälda eller en startlista från en IOF XML-fil. Banfiler läses in under Banor och Eventor under Inställningar → Eventor.",
    importLink: "Öppna import"
  }
} as const;
