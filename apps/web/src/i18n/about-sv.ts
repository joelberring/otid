/** Om O-Tid och sidfoten (PLAN.md steg 37). Bara avsnittet "Tekniska funktioner" får ha tekniska ord. */
export const aboutSv = {
  metaTitle: "Om O-Tid",
  metaDescription: "O-Tid är tidtagning för orientering i webbläsaren, för klubbtävlingar och träningar.",
  kicker: "O-Tid",
  title: "Om O-Tid",
  intro: "O-Tid är tidtagning för orientering i webbläsaren. Det är gjort för klubbtävlingar och träningar.",
  introMore: "Du lägger in banor, klasser och anmälda på webben. I mål läser du av brickorna med en SPORTident-station. " +
    "Löparna ser start- och resultatlistor på mobilen utan att logga in.",
  betaTitle: "Beta – fritt att använda",
  beta: "O-Tid är i beta. Det är öppet och gratis att använda. Det fungerar, men det kan finnas fel. " +
    "Hör gärna av dig om något krånglar.",
  madeTitle: "Så är det gjort",
  made: "O-Tid är utvecklat av Joel Berring med AI-stöd. Det är en webbapp i Next.js och TypeScript med en " +
    "PostgreSQL-databas, och den körs på en egen server. Avläsningen sker direkt i webbläsaren, utan något program att installera.",
  featuresTitle: "Tekniska funktioner",
  features: [
    "SPORTident-avläsning direkt i webbläsaren: Web Serial i Chrome eller Edge på dator, WebUSB i Chrome på Android-platta. iPhone och iPad går inte.",
    "Brickorna SI-Card 5, 6, 8, 9, 10, 11 och SIAC. Alla bricktyper är inte provade i skarpt läge än.",
    "Avläsning även utan nät: avläsningarna sparas i en lokal kö i webbläsaren och skickas när nätet kommer tillbaka.",
    "Eventor: klasser, anmälda och löpardatabas med klubbens löpare och brickor.",
    "IOF XML 3.0: banor in från banläggningsprogram (Purple Pen, OCAD, Condes), startlista och resultat ut.",
    "Lottning med fri start, minutstart och masstart, vakanser, klubbseparering och avancerade regler.",
    "Radiokontroller via ROC (eller OResults) med mellantider i listorna och hos speakern.",
    "Live för publiken, speakersida och Kvar i skogen.",
    "Funktionärer med egna konton som når avläsning, start, Kvar i skogen och speaker.",
    "Nödlägen under tävlingen: justera tiden för en station, kontroll ur funktion, manuell tid och omläsning från sparade rådata.",
    "Tävlingstyperna Träning, Liten tävling, Tävling, Tävling med gafflade banor, Stafett och Rogaining."
  ],
  contactTitle: "Frågor och kontakt",
  contact: "Har du frågor om O-Tid, hittat ett fel eller saknar något? Skicka ett mejl till",
  clubTitle: "Vill du använda O-Tid på din klubb?",
  club: "Skapa ett konto och lägg upp en träning. Det kostar inget. Vill du ha hjälp att komma igång: hör av dig.",
  clubLink: "Skapa konto eller logga in",
  privacyLink: "Så hanterar O-Tid personuppgifter",
  footer: {
    label: "Om O-Tid och kontakt",
    name: "O-Tid",
    beta: "beta",
    questions: "Frågor:",
    about: "Om O-Tid",
    privacy: "Personuppgifter"
  }
} as const;
