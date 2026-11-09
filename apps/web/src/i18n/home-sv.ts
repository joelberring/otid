/**
 * Idéerna 2026-11-08: den nya startsidan. Tävlingarna tar fortsatt störst plats; den inloggade ser sina klubbar, grupper och
 * kartprojekt, och alla ser vad O-Tid gör utöver tidtagning, hur det är byggt och var koden finns.
 */
export const homeSv = {
  personalTitle: "Ditt O-Tid",
  myRaces: "Mina tävlingar",
  clubs: "Klubbar",
  groups: "Träningsgrupper",
  projects: "Kartprojekt",
  more: (count: number) => `och ${count} till`,
  showAll: "Visa alla",
  featuresTitle: "Mer än tidtagning",
  features: [
    { title: "Tidtagning och resultat", text: "Avläsning med SPORTident direkt i webbläsaren, även utan nät. Start- och resultatlistor, Live och sträcktider för publiken." },
    { title: "Banläggning", text: "Lägg banor på kartan i webbläsaren, med gafflingar, kontrollbeskrivningar, utskrift och PDF för tryck." },
    { title: "Kartor och klubbarkiv", text: "Klubbens kartor och versioner på ett ställe, med avtal, gamla banor och kartor till starten." },
    { title: "Kartritning", text: "Rita och revidera kartor tillsammans: laser, ortofoto, baskartor, generalisering och normkontroll som förslag." },
    { title: "AI-koppling", text: "Koppla ditt eget Claude-konto. AI:n läser banor och kartor och lämnar bara förslag som du godkänner." },
    { title: "Klubbar och grupper", text: "Verifierade klubbar via Eventor, träningsgrupper med anmälan på plats och funktionärer med egna konton." }
  ],
  builtTitle: "Så är O-Tid byggt",
  built: "En webbapp i Next.js och TypeScript med en PostgreSQL-databas, på en egen server. Avläsningen sker i webbläsaren (Web Serial "
    + "och WebUSB). Laserdata och ritningar körs på en separat geo-server med Karttapullautin och LibreDWG, som egna program.",
  code: "Källkoden finns öppet på GitHub.",
  codeLink: "O-Tid på GitHub",
  about: "Mer om O-Tid"
} as const;
