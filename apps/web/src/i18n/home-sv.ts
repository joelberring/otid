/**
 * Idéerna 2026-11-08: den nya startsidan. Tävlingarna tar fortsatt störst plats; den inloggade ser sina klubbar, grupper och
 * kartprojekt, och alla ser vad O-Tid gör utöver tidtagning (rutorna leder vidare). Hur O-Tid är byggt står på Om O-Tid.
 */
export const homeSv = {
  /** Översynen av startsidan 2026-11-17: gå med med kod, och arrangörens väg. */
  joinTitle: "Har du en kod?",
  joinHelp: "Koden står på QR-lappen eller sist i länken du fått. Du kan också klistra in hela länken.",
  joinLabel: "Kod eller länk",
  joinPlaceholder: "t.ex. k7m2pq",
  join: "Gå med",
  joinMissing: "Koden hittades inte. Kontrollera att du skrivit rätt.",
  joinBusy: "För många försök. Vänta en stund och försök igen.",
  /** Ägaren 2026-11-21: några rader om vad O-Tid är, för den som inte är inloggad. */
  organizerTitle: "Ett nytt system för orientering",
  organizerText: "O-Tid håller ihop kartritning, banläggning, sekretariat och klubbens träningar. Gratis, i datorn och i mobilen.",
  organizerFilm: "Se filmen",
  organizerStart: "Skapa konto eller logga in",
  /** Ägaren 2026-11-22: "arrangör" avskräckte; kontot är för alla som gör något i O-Tid. */
  organizerStartHint: "Gratis. För banläggare, kartritare, ledare och arrangörer.",
  personalTitle: "Ditt O-Tid",
  myRaces: "Mitt O-Tid",
  clubs: "Klubbar",
  groups: "Träningsgrupper",
  projects: "Kartprojekt",
  more: (count: number) => `och ${count} till`,
  showAll: "Visa alla",
  demo: "Prova: se en demotävling",
  demoHelp: "Startlista, resultat, Live och sträcktider från en riktig träning, utan att logga in."
} as const;
