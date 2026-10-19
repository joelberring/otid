/** Fältfel i formulären (PLAN.md steg 24): på svenska och med fältets namn, i stället för webbläsarens egna. */
export const formErrorsSv = {
  eventName: "Skriv tävlingens namn (minst 2 tecken).",
  stageName: "Skriv etappens eller loppets namn med minst 2 tecken, eller lämna fältet tomt.",
  raceDate: "Skriv tävlingens datum som ÅÅÅÅ-MM-DD, till exempel 2026-10-25.",
  timeZone: "Skriv en tidszon, till exempel Europe/Stockholm.",
  courseName: "Skriv banans namn.",
  className: "Skriv klassens namn.",
  controls: "Skriv kontrollerna i ordning, till exempel 31 32 33.",
  controlsInvalid: "Kontrollkoderna ska vara positiva heltal, till exempel 31 32 33.",
  timeLimit: "Skriv tidsgränsen i minuter (1–2 880).",
  penalty: "Skriv straffet i poäng per påbörjad minut (0–1 000).",
  chooseCourse: "Välj vilken bana klassen springer.",
  chooseClass: "Välj klass.",
  classFull: "Klassen är full. Välj en annan klass eller höj maxantalet under Klasser.",
  givenName: "Skriv förnamnet.",
  familyName: "Skriv efternamnet.",
  card: "Bricknumret ska bara vara siffror, utan inledande nolla.",
  startTime: "Skriv starttiden som klockslag, till exempel 18:30.",
  firstStart: "Ange första start som klockslag, till exempel 10:00.",
  email: "Skriv en e-postadress, till exempel namn@klubb.se.",
  tooLong: (max: number) => `Högst ${max} tecken.`
} as const;
