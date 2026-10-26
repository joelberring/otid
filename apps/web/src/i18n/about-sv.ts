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
    "Live för publiken med senast i mål och radiotider, sträcktider i resultaten, speakersida och Kvar i skogen.",
    "Självregistrering på tävlingsdagen: löparen anmäler sig själv med bricka på tävlingssidan, märkt ”självreg.”.",
    "Fest med bar: köp med SPORTident-pinnar, in- och utcheckning i baren och en publik fest-sida utan belopp och utan namn om arrangören inte väljer det.",
    "Funktionärer med egna konton som når avläsning, start, Kvar i skogen och speaker.",
    "Nödlägen under tävlingen: justera tiden för en station, kontroll ur funktion, manuell tid och omläsning från sparade rådata.",
    "Tävlingstyperna Träning, Liten tävling, Tävling, Tävling med gafflade banor, Stafett och Rogaining."
  ],
  // Steg 54: uppmätt i docs/lasttest.md på en liten server (Hetzner CX23). Enkel svenska, inga tekniska ord.
  capacityTitle: "Hur stora tävlingar klarar O-Tid?",
  capacity: [
    "O-Tid körs på en liten server med två processorkärnor och 4 GB minne. Vi har provat den med en tävling med 3 000 löpare och 1 000 besökare samtidigt, medan de sista 150 löparna kom i mål.",
    "Tävlingen går före publiken. Avläsningen fick svar på under en sekund för 95 av 100 brickor, och arbetsytan och funktionärerna arbetade som vanligt.",
    "När många tittar blir resultatlistan och Live långsammare. Ett nytt resultat syntes oftast efter 5–10 sekunder, ibland lite senare.",
    "Stafetter med 300 lag går också, både med tre sträckor och som 25-manna (7 500 sträcklöpare). I en 25-manna där många lag växlar samtidigt kan det ta några sekunder, ibland upp till tio, innan avläsningen får svar.",
    "Avläsningar går aldrig förlorade. Varje avläsning sparas först på avläsningsdatorn och tas bort därifrån först när servern har tagit emot den. Är nätet borta eller servern upptagen skickas den senare.",
    "Väntar ni fler besökare än så fungerar O-Tid ändå, men listorna uppdateras mer sällan."
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
