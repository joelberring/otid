/** Steg 56: stafettformulären – fält, fel vid fälten, mallar och "Fler inställningar". */
type Method = "MASS_START" | "RESTART";
export type RelayTemplateId = "STANDARD" | "TEAM_SPRINT" | "YOUTH" | "LINE";

export const relayFormSv = {
  // Fält
  sameCourse: "Samma bana på alla sträckor",
  sameCourseHelp: "Snabbval: fyller i banan på alla sträckor. Du kan sedan ändra en sträcka i taget.",
  chooseSameCourse: "Välj bana",
  legCourse: (leg: number) => `Bana sträcka ${leg}`,
  chooseLegCourse: "Välj bana",
  more: "Fler inställningar",
  moreHelp: "Lag i omstart, gaffling, teamsprint och växlingskontroll. Förvalen passar en vanlig stafett.",
  // Mallar
  templates: "Mall",
  templatesHelp: "Välj en mall för att fylla i sträckorna och inställningarna. Klassnamn och banor ändras inte. Du kan byta mall tills du sparar.",
  template: { STANDARD: "Vanlig stafett (3 sträckor)", TEAM_SPRINT: "Teamsprint (2 löpare × 4 sträckor)",
    YOUTH: "Ungdomsstafett (sträcka 2 med 2 löpare)", LINE: "Linjestafett med flygande omstart" } satisfies Record<RelayTemplateId, string>,
  templateNote: {
    STANDARD: "Vanlig stafett: 3 sträckor med en löpare var. Sträcka 1 har masstart och de andra växling.",
    TEAM_SPRINT: "Teamsprint: 4 sträckor med växling, utläsning efter varje sträcka. Löparna och vilka sträckor de springer anger du på varje lag.",
    YOUTH: "Ungdomsstafett: 3 sträckor. På sträcka 2 springer 2 löpare samtidigt; den första i mål växlar och båda ska vara godkända.",
    LINE: "Linjestafett: 5 sträckor. Lag som är mer än 60 minuter efter ledaren startar i flygande omstart. Välj bana för varje sträcka."
  } satisfies Record<RelayTemplateId, string>,
  // Fel
  summary: (count: number) => count === 1 ? "Rätta 1 fält innan du sparar:" : `Rätta ${count} fält innan du sparar:`,
  name: "Skriv klassens namn.",
  tooLong: (max: number) => `Högst ${max} tecken.`,
  course: (leg: number) => `Välj bana för sträcka ${leg}.`,
  time: (leg: number, method: Method) => method === "RESTART"
    ? `Skriv omstartstiden för sträcka ${leg} som klockslag, till exempel 18:30.`
    : `Skriv masstarttiden för sträcka ${leg} som klockslag, till exempel 18:30.`,
  minutes: (leg: number) => `Skriv minuter efter ledaren för sträcka ${leg} som ett heltal 1–720.`,
  changeoverCode: "Växlingskontrollen är en kontrollkod 1–999, eller tom.",
  changeoverCodeRequired: "Utläsning efter sista sträckan kräver en växlingskontroll.",
  teamClass: "Välj stafettklass.",
  teamNumber: "Lagnumret är ett heltal 1–99 999, eller tomt för nästa lediga.",
  teamName: "Skriv lagets namn.",
  givenName: "Skriv förnamnet.",
  familyName: "Skriv efternamnet.",
  card: "Bricknumret ska bara vara siffror, utan inledande nolla.",
  cardRepeated: "Brickan används redan i laget."
} as const;
