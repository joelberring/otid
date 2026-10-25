/** Självregistrering på tävlingsdagen (PLAN.md steg 41): det publika formuläret och admins inställning. */
export const selfRegistrationSv = {
  title: "Registrera din pinne",
  intro: {
    party: "Skriv in numret på din pinne (SPORTident-brickan) och ditt namn, så känner baren igen dig.",
    race: "Skriv in numret på din bricka, ditt namn och välj klass, så är du anmäld."
  },
  cardNumber: "Bricknummer",
  cardHelp: "Siffrorna på pinnen, till exempel 8123456.",
  givenName: "Förnamn",
  familyName: "Efternamn",
  club: "Klubb (valfri)",
  displayName: "Visningsnamn (valfritt)",
  displayNameHelp: (example: string) => `Visas på fest-sidan och i baren. Fullt namn visas aldrig där. Tomt: ${example}.`,
  receiptDisplayName: (name: string) => `Du visas som ${name}.`,
  className: "Klass",
  chooseClass: "Välj klass",
  submit: "Registrera",
  saving: "Registrerar …",
  /** Steg 46: vad som visas publikt, per slag. */
  privacy: {
    race: "Namn, klubb och klass syns i den publika startlistan och resultatlistan, märkt ”självreg.”.",
    party: "Namnet kopplas till pinnen och syns för arrangören och i baren. Fest-sidan visar inga namn.",
    partyNames: "Dina köp visas med ditt visningsnamn på den här sidan. Fullt namn syns bara för arrangören och i baren."
  },
  privacyLink: "Om personuppgifter",
  receipt: (card: string, name: string) => `Klart! Pinne ${card} är kopplad till ${name}.`,
  receiptClass: (className: string) => `Du är anmäld i ${className}.`,
  again: "Registrera en pinne till",
  trap: "Lämna tomt",
  errors: {
    cardNumber: "Skriv bricknumret med siffror (1–9 999 999).",
    givenName: "Skriv ditt förnamn (högst 60 tecken).",
    familyName: "Skriv ditt efternamn (högst 60 tecken).",
    club: "Klubben får vara högst 80 tecken och innehålla bokstäver.",
    classId: "Välj en klass.",
    displayName: "Visningsnamnet får vara högst 40 tecken och innehålla bokstäver.",
    taken: "Pinnen är redan registrerad. Kontakta arrangören.",
    full: "Klassen är full. Välj en annan klass eller kontakta arrangören.",
    closed: "Självregistreringen är stängd just nu.",
    rateLimited: "För många registreringar på kort tid. Vänta några minuter och försök igen.",
    failed: "Registreringen kunde inte sparas. Försök igen."
  },
  setting: {
    label: "Tillåt självregistrering på tävlingsdagen",
    help: "Alla kan registrera en ny pinne med namn på den publika sidan utan att logga in, men bara på tävlingsdagen och när tävlingen är publicerad.",
    helpParty: "Gästerna kan koppla sitt namn till sin pinne på fest-sidan utan att logga in, på festens dag och natten efter till kl 06, när festen är publicerad.",
    on: "Självregistreringen är på.",
    off: "Självregistreringen är av.",
    failed: "Inställningen kunde inte sparas."
  },
  settingTitle: "Självregistrering",
  selfRegistered: "Självregistrerad",
  /** Steg 46: under Anmälda. */
  cleanup: {
    title: "Självregistrerade som inte läst ut",
    load: "Stryk alla självregistrerade som inte läst ut",
    help: "De här har registrerat sig själva och har ingen avläsning eller något beslut. Strukna försvinner från alla listor och brickan blir ledig. Inget tas bort.",
    count: (count: number) => count === 1 ? "1 självregistrerad som inte läst ut" : `${count} självregistrerade som inte läst ut`,
    none: "Inga självregistrerade att stryka.",
    confirm: (count: number) => count === 1 ? "Stryk 1 självregistrerad" : `Stryk ${count} självregistrerade`,
    cancel: "Avbryt",
    retry: "Försök igen",
    saved: (struck: number, skipped: number) => `${struck === 1 ? "1 självregistrerad är struken" : `${struck} självregistrerade är strukna`}.` +
      (skipped > 0 ? ` ${skipped} lämnades kvar eftersom de har läst ut eller ändrats under tiden.` : ""),
    loadError: "Listan kunde inte hämtas. Försök igen.",
    saveError: "Inget ströks. Försök igen."
  }
} as const;
