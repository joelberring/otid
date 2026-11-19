/** Mastermind med kontroller: den publika ställningen på tävlingssidan (ADR-0228). */
export const mastermindBoardSv = {
  heading: "Mastermind med kontroller",
  help: "Ställningen just nu. Tiden går från lagets första utläsning till utläsningen av gissningen som knäckte mönstret.",
  place: "Plats", team: "Lag", guesses: "Gissningar", time: "Tid", status: "Status",
  card: (end: string) => `Bricka …${end}`,
  none: "Inga spel än.",
  // "Spela på egen dator" (ADR-0228): knappen och reglerna när administratören har slagit på det.
  play: "Spela på den här datorn",
  playHelp: "Öppnar spelplanen. Datorn behöver en avläsningsstation (USB, eller Reader BT i Chrome, Edge eller Opera).",
  rules: [
    "Varje färg är en kontroll. Brickan har ett eget hemligt mönster av färger.",
    "Läs ut brickan en gång: klockan startar.",
    "Stämpla färgkontrollerna i den ordning ni gissar och läs ut. Svart stift: rätt färg på rätt plats. Vitt: rätt färg på fel plats.",
    "Klockan stannar när ni har knäckt mönstret. Snabbast vinner."
  ],
  states: { playing: "spelar", won: "klart", lost: "slut på gissningar" }
};
