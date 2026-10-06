import type { RaceCopySummary } from "@o-tid/contracts";

/** "Ny tävling som …" (PLAN.md steg 21): dialogen i Mina tävlingar och under Inställningar. */
export const raceCopySv = {
  action: "Kopiera",
  actionLabel: (raceName: string) => `Kopiera ${raceName} till en ny tävling`,
  settingsTitle: "Ny tävling som den här",
  settingsHelp: "Gör återkommande träningar snabba: samma banor, klasser och inställningar, men utan deltagare och resultat.",
  settingsAction: "Ny tävling som den här …",
  title: "Ny tävling som …",
  intro: (name: string) => `Skapar en ny tävling med samma banor, klasser och inställningar som ${name}.`,
  eventName: "Tävlingens namn",
  raceName: "Loppets namn",
  raceDate: "Datum",
  includePeople: "Ta med funktionärer och administratörer",
  includePeopleHelp: "Du blir ägare. Övriga administratörer (även nuvarande ägare) blir administratörer, funktionärer blir funktionärer.",
  includePeopleOff: "Bara du får behörighet till den nya tävlingen.",
  copiedTitle: "Följer med",
  copiedList: "Banor med kontroller och gafflingar, klasser med startsätt och maxantal, stafettens sträckor, rogainingpoäng, " +
    "karta med georeferens och radiokontroller (avstängda tills du slår på dem).",
  notCopiedTitle: "Följer inte med",
  notCopiedList: "Deltagare och lag, starttider och lottning, avläsningar, resultat, rutter, Eventor-kopplingen och publiceringen. " +
    "Den nya tävlingen är opublicerad och får en egen kort adress.",
  submit: "Skapa kopian",
  copying: "Kopierar …",
  cancel: "Avbryt",
  close: "Stäng",
  created: "Kopian är skapad.",
  summary: (copied: RaceCopySummary) => [
    `${copied.courses} ${copied.courses === 1 ? "bana" : "banor"}`,
    `${copied.classes} ${copied.classes === 1 ? "klass" : "klasser"}`,
    `${copied.controls} ${copied.controls === 1 ? "kontroll" : "kontroller"}`,
    ...(copied.people > 0 ? [`${copied.people} ${copied.people === 1 ? "person" : "personer"} med behörighet`] : []),
    ...(copied.map ? ["karta"] : [])
  ].join(" · "),
  eventorNote: "Källan var kopplad till Eventor. Välj Eventor-tävling för kopian under Inställningar om anmälningarna ska hämtas därifrån.",
  radioNote: "Radiokontrollerna är avstängda i kopian. Slå på dem under Inställningar inför tävlingen.",
  open: "Öppna kopian",
  opening: "Öppnar …",
  errors: {
    forbidden: "Bara ägare och administratörer kan kopiera tävlingen.",
    notFound: "Tävlingen finns inte längre, eller så har du inte behörighet till den.",
    invalid: "Kontrollera namnen (minst två tecken) och datumet.",
    session: "Inloggningen har gått ut. Logga in igen och försök på nytt.",
    conflict: "Begäran krockade med en tidigare kopiering. Stäng och försök igen.",
    open: "Kopian kunde inte öppnas. Hitta den under Mina tävlingar.",
    network: "Ingen kontakt med servern. Försök igen – samma försök skapar inte två kopior.",
    generic: (status: number) => `Kopieringen misslyckades (${status}). Försök igen – samma försök skapar inte två kopior.`
  }
} as const;
