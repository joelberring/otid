/** Konton (ADR-0172): glömt lösenord, Mitt konto, ta bort tävling och personuppgifter. */
export const accountSv = {
  backToEvents: "Mina tävlingar",
  genericError: (status: number) => `Något gick fel (${status}). Försök igen.`,
  networkError: "Kunde inte nå servern. Kontrollera anslutningen och försök igen.",
  sessionExpired: "Du är inte inloggad.",
  logIn: "Logga in",
  reset: {
    kicker: "O-Tid · Konto",
    title: "Glömt lösenordet",
    checking: "Kontrollerar …",
    intro: "Skriv e-postadressen till ditt konto. Vi skickar en länk där du väljer ett nytt lösenord.",
    email: "E-postadress",
    invalidEmail: "Skriv en giltig e-postadress.",
    send: "Skicka länk",
    sending: "Skickar …",
    sent: "Om adressen har ett konto i O-Tid har vi skickat en länk dit. Den gäller i en timme och kan användas en gång. Titta också i skräpposten.",
    noMailTitle: "Återställning via e-post är inte påslagen",
    noMail: "Kontakta den som driver O-Tid och be om en återställningslänk. Länken gäller i en timme.",
    contact: "Kontakt:",
    newTitle: "Välj nytt lösenord",
    newIntro: "Skriv det nya lösenordet två gånger. Du loggas in här och ut på alla andra enheter. Har du inte bekräftat e-postadressen än blir den bekräftad samtidigt.",
    password: "Nytt lösenord",
    save: "Spara och logga in",
    saving: "Sparar …",
    saved: "Lösenordet är bytt och du är inloggad. Öppnar Mina tävlingar …",
    invalidLink: "Länken är ogiltig, redan använd eller har gått ut. Be om en ny länk.",
    newLink: "Be om en ny länk",
    backToLogin: "Tillbaka till inloggningen"
  },
  /** ADR-0186, ändrat av ADR-0205: bekräftelselänken bevisar adressen och personen väljer lösenordet. */
  verify: {
    kicker: "O-Tid · Konto",
    title: "Bekräfta e-postadressen",
    intro: "Välj lösenordet du vill logga in med och skriv det två gånger. Det kan vara samma som när du skapade kontot eller ett nytt. Sedan är adressen bekräftad och du är inloggad.",
    sameBrowserIntro: "Du skapade kontot i den här webbläsaren. Lösenordet du valde då gäller, så du behöver inte skriva det igen. Tryck på knappen, så är adressen bekräftad och du är inloggad.",
    otherPassword: "Välj ett annat lösenord",
    choosePassword: "Välj lösenordet du vill logga in med och skriv det två gånger.",
    submit: "Bekräfta och logga in",
    verifying: "Bekräftar …",
    alreadyVerified: "E-postadressen är redan bekräftad. Logga in med ditt lösenord. Har du glömt det kan du välja ett nytt.",
    invalid: "Länken har gått ut eller är redan använd. Välj ett nytt lösenord via Glömt lösenordet, så bekräftas adressen samtidigt och du loggas in.",
    newPassword: "Välj nytt lösenord",
    noToken: "Länken saknar sin nyckel. Öppna länken i mejlet igen."
  },
  /** ADR-0205: lösenordsfälten (registrering, återställning, bekräftelse och byte). */
  passwordField: {
    password: "Lösenord",
    repeat: "Upprepa lösenordet",
    rule: "Minst 8 tecken.",
    tooShort: "Lösenordet är för kort (minst 8 tecken).",
    mismatch: "Lösenorden är inte lika.",
    show: "Visa lösenordet",
    hide: "Dölj lösenordet"
  },
  me: {
    kicker: "O-Tid · Konto",
    title: "Mitt konto",
    loading: "Hämtar kontot …",
    details: "Uppgifter",
    detailsHelp: "E-postadressen är din inloggning och kan inte ändras här.",
    email: "E-postadress",
    created: "Skapat",
    role: "Roll",
    superadmin: "Superadmin",
    displayName: "Namn",
    saveName: "Spara namn",
    nameSaved: "Namnet är sparat.",
    password: "Byt lösenord",
    passwordHelp: "Alla andra inloggningar slutar gälla. Den här enheten förblir inloggad. Loggar du in med Google och har inget eget lösenord: välj ett med Glömt lösenordet.",
    currentPassword: "Nuvarande lösenord",
    newPassword: "Nytt lösenord",
    savePassword: "Byt lösenord",
    passwordSaved: "Lösenordet är bytt. Andra enheter behöver logga in igen.",
    wrongPassword: "Lösenordet stämmer inte.",
    delete: "Ta bort kontot",
    deleteHelp: "Kontot, ditt namn, din e-postadress och ditt lösenord tas bort. Det går inte att ångra.",
    deleteEvents: "Tävlingarna du har skapat tas bort samtidigt, med anmälda, avläsningar och resultat:",
    deleteNoEvents: "Du äger inga tävlingar. Tävlingar där du är medadministratör finns kvar hos sina ägare.",
    deleteOthers: "Tävlingar där du är medadministratör finns kvar hos sina ägare; du försvinner bara som administratör.",
    deletePassword: "Skriv ditt lösenord för att bekräfta",
    deleteButton: "Ta bort mitt konto",
    /** Ändrat 2026-11-07: ensam ägare av en klubb eller ensam ledare av en träningsgrupp. */
    deleteHandOver: (names: readonly string[]) => `Lämna över ägarskapet för ${names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " och " + names.at(-1)} först. `
      + "Kontot kan inte tas bort så länge ingen annan kan sköta dem.",
    deleteHandOverAlone: "Gör någon annan till ägare (klubb) eller ledare (grupp) under Medlemmar. Är du ensam där: kontakta den som driver O-Tid.",
    deleteSoleOwner: "Kontot är inte borttaget: lämna över ägarskapet först (se ovan).",
    soleOwnerClub: (name: string) => `Klubben ${name} – du är enda ägaren`,
    soleOwnerGroup: (name: string) => `Träningsgruppen ${name} – du är enda ledaren`,
    soleOwnerMapProject: (name: string) => `Kartprojektet ${name} – du är enda ägaren`,
    deleted: "Kontot är borttaget.",
    /** Ändrat 2026-11-07 (ADR-0205): ett konto som bara loggar in med Google bekräftar borttagningen med en ny Google-inloggning. */
    deleteWithGoogle: "Du loggar in med Google och har inget eget lösenord. Bekräfta genom att logga in med Google en gång till – sedan tas kontot bort direkt.",
    deleteWithGoogleButton: "Logga in med Google och ta bort kontot",
    deleteGoing: "Går till Google …",
    deleteDone: {
      "annat-konto": "Kontot är inte borttaget: du loggade in med ett annat Google-konto än det som är kopplat hit.",
      "for-gammal": "Kontot är inte borttaget: Google bekräftade inte en ny inloggning. Försök igen och logga in hos Google när du blir ombedd.",
      "ensam-agare": "Kontot är inte borttaget: lämna över ägarskapet först (se ovan).",
      losenord: "Kontot har ett eget lösenord. Bekräfta borttagningen med lösenordet.",
      sessionen: "Borttagningen gällde en annan inloggning. Försök igen härifrån.",
      avbruten: "Inloggningen hos Google avbröts. Kontot är inte borttaget.",
      fel: "Borttagningen med Google misslyckades. Kontot är inte borttaget. Försök igen."
    } as Record<string, string>,
    /** ADR-0205 tillägg: Koppla Google-konto. Kontots adress ändras inte; Googles visas bara som kopplingen. */
    google: "Inloggning med Google",
    googleHelp: "Koppla ditt Google-konto, också om det har en annan e-postadress än kontot. Sedan kan du logga in med Google. Kontots e-postadress ändras inte.",
    googleLink: "Koppla Google-konto",
    googleLinking: "Går till Google …",
    googleLinked: (email: string) => `Kopplat Google-konto: ${email}`,
    googleLinkedUnknown: "Ett Google-konto är kopplat. Adressen visas efter nästa inloggning med Google.",
    googleNone: "Inget Google-konto är kopplat.",
    googleUnlink: "Ta bort kopplingen",
    googleUnlinked: "Kopplingen är borttagen. Du loggar in med e-postadressen och lösenordet.",
    googleLastMethod: "Kopplingen kan inte tas bort: kontot har inget eget lösenord. Logga ut och välj ett med Glömt lösenordet (till kontots e-postadress) först.",
    googleDone: {
      kopplat: (email: string) => `Google-kontot (${email}) är kopplat – du kan logga in med Google.`,
      upptaget: "Google-kontot är kopplat till ett annat konto som används. Logga in på det och ta bort kopplingen där först.",
      /** Ändrat 2026-11-07: det andra kontot skapades med Google och har inget eget lösenord, så kopplingen tas inte bort där direkt. */
      "upptaget-utan-losenord": "Google-kontot är kopplat till ett annat konto som används och som inte har något eget lösenord. "
        + "Logga ut och välj Glömt lösenordet med det kontots e-postadress (oftast Google-kontots) för att ge det ett lösenord. Logga sedan in "
        + "på det, ta bort kopplingen under Mitt konto och koppla Google här igen.",
      obekraftad: "Google har inte bekräftat e-postadressen på Google-kontot. Bekräfta den hos Google och försök igen.",
      sessionen: "Kopplingen gällde en annan inloggning. Logga in igen och tryck på Koppla Google-konto en gång till.",
      avbruten: "Kopplingen avbröts hos Google. Inget är ändrat.",
      fel: "Kopplingen till Google misslyckades. Försök igen."
    },
    moved: (email: string) => `Google-kontot (${email}) är kopplat – du kan logga in med Google. Det tomma kontot är borttaget.`,
    /** ADR-0205 tillägg: Logga ut från alla enheter (telefonen, klubbens dator, tävlingens dator). */
    sessions: "Inloggningar",
    sessionsHelp: "Har du loggat in på en lånad dator eller tappat telefonen: logga ut överallt. Du loggar in igen här efteråt.",
    logoutAll: "Logga ut från alla enheter",
    logoutAllFailed: "Utloggningen kunde inte bekräftas. Kontrollera nätet och försök igen."
  },
  /** ADR-0205 tillägg: sidan som bekräftar att Google-kopplingen flyttas från ett tomt konto (dubbletten). */
  googleMove: {
    kicker: "O-Tid · Konto",
    title: "Flytta Google-kopplingen hit",
    loading: "Läser kopplingen …",
    what: (google: string, source: string, target: string) => `Google-kontot ${google} är kopplat till ett annat konto i O-Tid (${source}). `
      + `Det kontot är tomt: inga tävlingar, behörigheter, klubbar eller arkivinnehåll (bara svaret på vilken klubb du tillhör). Kopplingen flyttas till ${target}, och du loggar sedan in med Google här.`,
    duplicate: (source: string, created: string) => `Kontot ${source} (skapat ${created}) tas bort som dubblett och loggas ut överallt. Inbjudningar till adressen väntar kvar.`,
    password: "Ditt lösenord",
    passwordHelp: "Bekräfta flytten med lösenordet till det här kontot.",
    recentLogin: "Du loggade in nyss, så det räcker att bekräfta.",
    loginAgain: "Logga ut och in igen, och koppla sedan Google en gång till (kontot har inget eget lösenord, och inloggningen är äldre än tio minuter).",
    confirm: "Flytta kopplingen och ta bort dubbletten",
    cancel: "Avbryt",
    expired: "Flytten gäller inte längre (för gammal, eller en annan inloggning). Tryck på Koppla Google-konto under Mitt konto igen.",
    inUse: "Google-kontot är kopplat till ett annat konto som används. Logga in på det och ta bort kopplingen där först.",
    wrongPassword: "Lösenordet stämmer inte."
  },
  raceDelete: {
    title: "Ta bort tävling",
    help: "Tävlingen tas bort helt: banor, klasser, anmälda, råa avläsningar, radiostämplingar, resultat, karta, rutter och Eventor-koppling. Det går inte att ångra.",
    ownerOnly: "Bara den som skapade tävlingen kan ta bort den.",
    confirm: (name: string) => `Skriv tävlingens namn, ${name}, för att bekräfta`,
    button: "Ta bort tävlingen",
    mismatch: "Namnet stämmer inte. Skriv tävlingens namn exakt.",
    deleted: "Tävlingen är borttagen."
  },
  privacy: {
    title: "Personuppgifter i O-Tid",
    intro: "O-Tid sparar bara det som behövs för att arrangera tävlingar och visa resultat.",
    whatTitle: "Vad som sparas",
    accounts: "Konton: e-postadress, namn och lösenordet i krypterad form (det går inte att läsa tillbaka), när kontot skapades och senast loggade in, och när e-postadressen bekräftades. Bekräftelse- och återställningslänkar sparas bara som en hash och gäller ett dygn respektive en timme.",
    races: "Tävlingar: löparnas namn, klubbar, klasser, bricknummer, starttider, stämplingar och resultat, råa avläsningar från stationerna, radiostämplingar från ROC eller OResults och, om arrangören laddar upp dem, karta och GPS-rutter.",
    runners: "Löpardatabasen (om en arrangör hämtar den från Eventor): klubbens löpare, och tillagda klubbars eller hela landets om arrangören väljer det, med Eventors id, namn, födelseår (inte hela födelsedatumet), kön, klubb och SPORTident-brickor, samt Eventors lista över klubbar. Den sparas en gång per klubb och delas av klubbens tävlingar.",
    clubs: "Klubbar (ADR-0209): klubbarna du har valt, om och när klubben bekräftade dig och av vem. Klubblistan är Eventors förbund, distrikt och klubbar. För en klubbyta som är kopplad till Eventor sparas klubbens API-nyckel krypterad och, av klubbens medlemslista, bara Eventors person-id och en hash av varje e-postadress (inga namn eller andra uppgifter); listan ersätts vid varje hämtning. Bekräftade medlemmar ser varandras namn, aldrig adresser, när de bjuder in. Dina klubbar tas bort med kontot.",
    groups: "Träningsgrupper: gruppens namn och inställningar, ledare och medlemmar (deras konton, tillagda med e-postadress av en ledare) och gruppens tillfällen. Närvaro och poäng räknas fram ur tillfällenas publicerade resultat och sparas inte separat.",
    mapLink: "Länken till kartritaren: bara en hash av länkens nyckel, när den skapades, gäller till och när den senast öppnades. Ingen IP-adress eller webbläsare sparas med länken; IP-adressen räknas bara som en hash i spärren mot för många försök (rensas efter två dygn). Kartritarens svar sparas med det namn hen själv skriver, annars som ”Kartritaren”.",
    courseSetting: "Banläggning: banorna, kontrollerna och ändringarna med vem som gjorde dem, notiser och kartfel med text, ritning, svar och foto (fotot görs om i webbläsaren innan det skickas, så att kamerans uppgifter som plats och tid inte följer med), vem som har kollat en kontroll och utskriftsjobben. Telefonens position i fältläget sparas inte som sådan; den används bara när du själv flyttar en kontroll eller lägger en notis där du står.",
    printJobs: "Utskrifter: en PDF för tryck sparas i 7 dagar (högst tio per tävling) och raden om jobbet (vem, när, vad) i 30 dagar. PDF:erna tas inte med i säkerhetskopian.",
    backup: "Säkerhetskopior: hela databasen kopieras varje timme. På servern sparas timkopiorna i två dygn och en kopia per dag i 14 dagar. Om den som driver installationen har slagit på det skickas kopiorna dessutom krypterade till en lagringstjänst utanför servern och sparas där i upp till ett år (en per timme i två dygn, en per dag i 30 dagar, en per månad i 12 månader).",
    party: "Fester: gästens namn, klubb och visningsnamn kopplat till brickan, köpen (vara och klockslag, räknade ur brickans stämplingar), när gästen checkade in och ut i baren, ångrade köp och vem i baren som gjorde vad.",
    selfRegistration: "Självregistrering på tävlingsdagen: namn, klubb, klass (eller visningsnamn på en fest) och bricknummer, märkt som självregistrerad. IP-adressen sparas bara som en hash med en hemlig nyckel, för spärren mot för många registreringar, och tas bort efter två dygn.",
    logs: "Loggar: vem som ändrade vad i en tävling och vad superadmin har gjort (dolt eller tagit bort tävlingar, spärrat eller tagit bort konton). Antal försök att logga in, skapa konto, återställa lösenord och självregistrera räknas per adress, som bara sparas som en hash med en hemlig nyckel.",
    whyTitle: "Varför",
    why: "För att arrangörer ska kunna genomföra tävlingen eller festen, räkna fram resultat och köp och publicera start- och resultatlistor, och för att skydda kontona mot intrång och missbruk. Löpardatabasen används för att föreslå namn, klubb och klass när en okänd bricka läses av eller en ny deltagare anmäls, även utan nät.",
    howLongTitle: "Hur länge",
    howLong: "Tills tävlingen (festen) eller kontot tas bort. Då tas allt som hör till bort, också råa avläsningar, köp och loggar. Arrangören tar bort sin tävling under Inställningar och du tar bort ditt konto under Mitt konto. Strukna deltagare finns kvar i tävlingen men visas inte publikt. Räknarna för spärrarna tas bort efter två dygn. Löpardatabasen ersätts helt varje gång den uppdateras från Eventor och finns kvar tills den uppdateras eller raderas (Inställningar → Eventor → Radera löpardatabasen). Det som tagits bort finns kvar i säkerhetskopiorna tills de skrivs över: efter 14 dagar på servern och, om kopian utanför servern är påslagen, efter upp till 12 månader där.",
    // ADR-0189 beslut 5–6: en enskild löpare och gallringen.
    oneRunnerTitle: "Ta bort eller anonymisera en löpare",
    oneRunner: "Vill du inte finnas med i en tävling: kontakta arrangören. Arrangören kan ta bort en deltagare som inte har läst ut, och " +
      "anonymisera vem som helst på deltagarkortet (Anmälda → deltagaren → Anonymisera). Då tas namn, klubb, bricknummer, födelseår och " +
      "Eventors id bort ur tävlingen: ur anmälan, journalen, start- och resultatlistorna och de inlästa filerna, och GPS-rutten tas bort. " +
      "Resultatet och sträcktiderna står kvar som ”Anonym deltagare”, så att de andras placeringar stämmer. Brickans nummer finns kvar i " +
      "avläsningen av brickan (den ändras aldrig), men är inte längre kopplat till ett namn.",
    retention: (mode: "off" | "anonymize" | "delete", months: number) => mode === "off"
      ? "Den här servern gallrar inte tävlingar automatiskt; de finns kvar tills arrangören eller den som driver servern tar bort dem."
      : mode === "anonymize"
        ? `Den här servern anonymiserar automatiskt tävlingar som är äldre än ${months} månader: alla deltagare blir ”Anonym deltagare” och resultaten står kvar.`
        : `Den här servern tar automatiskt bort tävlingar som är äldre än ${months} månader, med allt som hör till dem.`,
    publicTitle: "Vad som är publikt",
    public: "När arrangören har publicerat tävlingen kan alla läsa startlistor och resultat med namn, klubb och tider utan att logga in. Sidorna med löpare (tävlingssidan, start- och resultatlistor, fester och träningsgrupper) är stängda för sökmotorer och AI-tjänster.",
    publicItems: [
      "Startlistan visar inte bricknummer i nya tävlingar. Arrangören kan slå på det under Inställningar → Information till löparna → ”Visa bricknummer i den publika startlistan” (tävlingar skapade före november 2026 behåller sitt val).",
      "Variantens bokstav i en gafflad bana och kartan visas publikt först efter start, om inte arrangören har valt annat under Publicera.",
      "Resultaten har sträcktider. Live visar senast i mål, ledare per klass och radiokontrollernas tider. Vilka löpare du följer sparas bara i din webbläsare.",
      "Självregistrerade syns i startlistan märkta ”självreg.”.",
      "Fest-sidan visar antal köp, varor och klockslag, aldrig belopp, bricknummer eller fullt namn. Visningsnamnen visas bara om arrangören slår på ”Visa namn på den publika sidan” (av från början). Fest-sidan är stängd för sökmotorer.",
      "Speakersidan, Kvar i skogen, avläsningen, baren och CSV-filerna är bara för arrangörens administratörer och funktionärer, som ser fullt namn."
    ],
    runnersPublic: "Löpardatabasen är aldrig publik: bara tävlingens administratörer och funktionärer ser den (som förslag), och den följer med avläsningssidans paket för att fungera utan nät.",
    organizerCopyTitle: "Arrangörens egna kopior",
    organizerCopy: "En administratör kan ladda ner en säkerhetskopia av sin tävling (Inställningar → Säkerhetskopia) och läsa in den som en ny tävling, också på en annan server. Filen innehåller tävlingens personuppgifter: namn, klubbar, bricknummer, starttider, resultat och e-post för dem som har behörighet, men inga lösenord eller konton. En kopia på arrangörens dator eller i arrangörens lagring är arrangörens ansvar: spara den där bara arrangörerna kommer åt den och ta bort den när den inte behövs. Att tävlingen tas bort i O-Tid tar inte bort sådana kopior.",
    responsibleTitle: "Vem som ansvarar",
    responsible: "Servern och kontona sköts av den som driver den här O-Tid-installationen (kontakt nedan). Vilka löpare och uppgifter som läggs in i en tävling, träningsgrupp eller fest bestämmer arrangören, det vill säga den som skapade den och de som den gett behörighet.",
    contactTitle: "Kontakt",
    contact: "Frågor om dina uppgifter, eller om du vill att något tas bort, skickar du till den som driver den här O-Tid-installationen:"
  }
} as const;
