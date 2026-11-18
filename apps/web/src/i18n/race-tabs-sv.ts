import type { RaceNavLabel } from "../lib/race-tabs";

/** Tävlingsraden i telefonbredd (ägaren 2026-11-18, ADR-0227 tillägg). */
export const raceTabsSv = {
  label: "Tävlingens meny",
  back: "Mitt O-Tid",
  backLabel: "Tillbaka till Mitt O-Tid",
  mode: "Läge",
  modes: { PREPARE: "Förbereda", RACE_DAY: "Tävlingsdag" },
  more: "Mer",
  moreTitle: "Mer i arrangemanget",
  switchFunction: "Byt funktion",
  switchTitle: "Byt funktion",
  close: "Stäng",
  refresh: "Uppdatera översikten",
  newTab: "öppnas i ny flik så att stationen förblir ansluten",
  /** Korta namn i flikarna. */
  tabs: {
    COURSES: "Banor", COURSES_CLASSES: "Banor", CONTROLS_POINTS: "Kontroller", CLASSES: "Klasser", CLASSES_LEGS: "Klasser",
    ENTRIES: "Anmälda", PARTICIPANTS: "Deltagare", TEAMS: "Lag", START: "Start", PUBLISH: "Publicera", SECRETARIAT: "Sekretariat",
    RESULTS: "Resultat", PARTY: "Fest", PEOPLE: "Personer", SETTINGS: "Inställningar", READOUT_STATION: "Avläsning",
    PARTY_DESK: "Bardisk", SPEAKER: "Speaker", COURSE_SETTING: "Banläggning", MAP_ERRORS: "Kartfel", EXERCISE_SETUP: "Övning",
    MASTERMIND: "Mastermind", BINGO: "Bingo", SHIPS: "Sänka skepp", CONTROLS: "Kontroller"
  } satisfies Record<RaceNavLabel, string>,
  /** Namn och en rad om innehållet i listan (Mer och Byt funktion). */
  items: {
    COURSES: ["Banor", "Banfil, banor och gafflingar"], COURSES_CLASSES: ["Banor & klasser", "Banor och klasser på ett ställe"],
    CONTROLS_POINTS: ["Kontroller & poäng", "Kontrollernas poäng, klasser och tidsgräns"], CLASSES: ["Klasser", "Klasser och banor"],
    CLASSES_LEGS: ["Klasser & sträckor", "Stafettklasser och sträckor"], ENTRIES: ["Anmälda", "Anmälda, import och brickor"],
    PARTICIPANTS: ["Deltagare", "Deltagare och brickor"], TEAMS: ["Lag", "Lagen och sträcklöparna"],
    START: ["Start", "Startlistor, lottning och kartor till starten"], PUBLISH: ["Publicera", "Tävlingen och startlistan"],
    SECRETARIAT: ["Sekretariat", "Kvar i skogen, okända brickor, felstämplade, direktanmälan"],
    RESULTS: ["Resultat", "Resultatlistor och fastställande"], PARTY: ["Fest", "Varor, gäster och köp"],
    PEOPLE: ["Personer", "Administratörer, funktionärer och banläggare"], SETTINGS: ["Inställningar", "Namn, datum, typ och kopplingar"],
    READOUT_STATION: ["Avläsning", "Avläsningsstationen"], PARTY_DESK: ["Bardisk", "Bardisken med brickan"],
    SPEAKER: ["Speaker", "Speakerns tavla"], COURSE_SETTING: ["Banläggning", "Kartan, kontrollerna och utskriften"],
    MAP_ERRORS: ["Kartfel", "Kartfelen till banläggaren"], EXERCISE_SETUP: ["Övning i mobilen", "Bingo, Sänka skepp och virtuella kontroller"],
    MASTERMIND: ["Mastermind med kontroller", "Lek med SI-enheter: varje färg är en kontroll, laget gissar mönstret"],
    BINGO: ["Bingo", "Ledarens sida"], SHIPS: ["Sänka skepp", "Ledarens sida"], CONTROLS: ["Virtuella kontroller", "Ledarens sida"]
  } satisfies Record<RaceNavLabel, readonly [string, string]>
};
