import { plural } from "./plural";

/** Superadminsidan (ADR-0172 beslut 2). */
export const superadminSv = {
  kicker: "O-Tid · Drift",
  title: "Superadmin",
  intro: "Alla konton och tävlingar. Varje åtgärd kräver ett skäl och loggas med vem och när.",
  loading: "Hämtar …",
  forbidden: "Den här sidan är bara för superadmin.",
  notLoggedIn: "Logga in med ett superadminkonto.",
  accounts: "Konton",
  accountsHelp: (shown: number, total: number) => shown < total ? `Visar de ${shown} senaste av ${total}. Sök för att hitta fler.`
    : `${plural(total, "konto", "konton")}, nyast först.`,
  searchAccounts: "Sök e-post eller namn",
  races: "Tävlingar",
  racesHelp: (shown: number, total: number) => shown < total ? `Visar de ${shown} senaste av ${total}. Sök för att hitta fler.`
    : `${plural(total, "tävling", "tävlingar")}, nyast först.`,
  searchRaces: "Sök tävling, lopp eller ägare",
  search: "Sök",
  noAccounts: "Inga konton matchar.",
  noRaces: "Inga tävlingar matchar.",
  columns: {
    email: "E-post", name: "Namn", created: "Skapat", lastLogin: "Senast inloggad", events: "Tävlingar", status: "Status",
    race: "Tävling", date: "Datum", owner: "Ägare", type: "Typ", actions: "Åtgärder"
  },
  never: "aldrig",
  noOwner: "ingen",
  status: { active: "Aktivt", blocked: "Spärrat", superadmin: "Superadmin", visible: "Synlig", hidden: "Dold",
    unverified: "Obekräftad adress" },
  action: {
    HIDE_RACE: "Dölj", UNHIDE_RACE: "Visa", DELETE_EVENT: "Ta bort", BLOCK_ACCOUNT: "Spärra", UNBLOCK_ACCOUNT: "Släpp spärr",
    DELETE_ACCOUNT: "Ta bort", CREATE_RESET_LINK: "Återställningslänk", VERIFY_EMAIL: "Bekräfta adressen", SET_ACCOUNT_LIMITS: "Gränser",
    GRANT_SUPERADMIN: "Gav superadmin", REVOKE_SUPERADMIN: "Tog bort superadmin"
  },
  logAction: {
    HIDE_RACE: "Dolde tävling", UNHIDE_RACE: "Visade tävling", DELETE_EVENT: "Tog bort tävling", BLOCK_ACCOUNT: "Spärrade konto",
    UNBLOCK_ACCOUNT: "Släppte spärr", DELETE_ACCOUNT: "Tog bort konto", CREATE_RESET_LINK: "Skapade återställningslänk",
    VERIFY_EMAIL: "Bekräftade adress", SET_ACCOUNT_LIMITS: "Ändrade gränser", GRANT_SUPERADMIN: "Gav superadmin", REVOKE_SUPERADMIN: "Tog bort superadmin"
  },
  confirmTitle: {
    HIDE_RACE: "Dölj tävlingen från de publika sidorna", UNHIDE_RACE: "Visa tävlingen på de publika sidorna igen",
    DELETE_EVENT: "Ta bort tävlingen med all data", BLOCK_ACCOUNT: "Spärra kontot", UNBLOCK_ACCOUNT: "Släpp spärren",
    DELETE_ACCOUNT: "Ta bort kontot", CREATE_RESET_LINK: "Skapa återställningslänk", VERIFY_EMAIL: "Bekräfta kontots e-postadress",
    SET_ACCOUNT_LIMITS: "Ändra kontots gränser"
  },
  confirmHelp: {
    HIDE_RACE: "Startlistor, resultat och sträcktider slutar synas för besökare. Arrangören ser tävlingen som vanligt.",
    UNHIDE_RACE: "Tävlingen syns igen för besökare.",
    DELETE_EVENT: "Allt tas bort: anmälda, råa avläsningar, radiostämplingar, resultat, karta, rutter och Eventor-koppling. Det går inte att ångra.",
    BLOCK_ACCOUNT: "Kontot loggas ut överallt och kan inte logga in förrän spärren släpps.",
    UNBLOCK_ACCOUNT: "Kontot kan logga in igen. Gamla inloggningar gäller inte.",
    DELETE_ACCOUNT: "Kontot och tävlingarna det äger tas bort. Det går inte att ångra.",
    CREATE_RESET_LINK: "Länken visas en gång. Ge den till kontots ägare; den gäller i en timme och kan användas en gång.",
    VERIFY_EMAIL: "Gör det bara om du vet att adressen är personens egen och att personen själv har valt kontots lösenord (till exempel om mejlet aldrig kommer fram). Behörigheter som andra gett adressen gäller sedan direkt. Lösenordet ändras inte; är du osäker, skapa en återställningslänk i stället.",
    SET_ACCOUNT_LIMITS: "Gränserna gäller bara det här kontot. Lämna ett fält tomt för att kontot ska följa förvalet. En sänkt gräns tar inte bort något; kontot kan bara inte spara mer förrän det ligger under gränsen."
  },
  ownedEvents: (count: number) => count === 1 ? "Kontot äger 1 tävling, som också tas bort." : `Kontot äger ${count} tävlingar, som också tas bort.`,
  limits: "Lagring och laserrutor",
  limitsHelp: (usedMb: number, limitMb: number | null, defaultMb: number | null, defaultTiles: number) =>
    `Kartfiler på servern: ${usedMb} MB${limitMb === null ? "" : ` av ${limitMb} MB`}. Förval per konto: ${defaultMb === null ? "ingen gräns" : `${defaultMb} MB`} lagring och ${defaultTiles} laserrutor i månaden. Listan visar konton som använt minst 70 % av en gräns och konton med egna gränser, de som ligger närmast gränsen först.`,
  limitsEmpty: "Inget konto är nära sin gräns och inget har egna gränser.",
  limitColumns: { storage: "Kartlagring", tiles: "Laserrutor i månaden", own: "Egna gränser" },
  storageUse: (usedMb: number, limitMb: number | null, percent: number | null) =>
    limitMb === null ? `${usedMb} MB (ingen gräns)` : `${usedMb} av ${limitMb} MB (${percent} %)`,
  tilesUse: (used: number, limit: number) => `${used} av ${limit}`,
  ownLimits: (mapQuotaMb: number | null, tiles: number | null) =>
    mapQuotaMb === null && tiles === null ? "Förval" : [mapQuotaMb === null ? null : `${mapQuotaMb} MB`, tiles === null ? null : `${tiles} rutor`].filter(Boolean).join(", "),
  nearLimit: "Nära gränsen",
  overLimit: "Över gränsen",
  mapQuotaField: (defaultMb: number | null) => `Kartlagring i MB (tomt = förvalet${defaultMb === null ? ", ingen gräns" : ` ${defaultMb}`})`,
  geoTilesField: (defaultTiles: number) => `Laserrutor per månad (tomt = förvalet ${defaultTiles})`,
  target: "Gäller",
  reason: "Skäl (loggas)",
  confirmName: (name: string) => `Skriv tävlingens namn, ${name}, för att bekräfta`,
  confirmEmail: (email: string) => `Skriv kontots e-postadress, ${email}, för att bekräfta`,
  perform: "Utför",
  cancel: "Avbryt",
  working: "Utför …",
  done: (label: string) => `Klart: ${label}.`,
  mismatch: "Bekräftelsen stämmer inte. Skriv namnet eller adressen exakt.",
  notFound: "Finns inte längre. Listan har uppdaterats.",
  ownAccount: "Ditt eget konto ändrar du under Mitt konto.",
  alreadyVerified: "Adressen är redan bekräftad. Listan har uppdaterats.",
  resetTitle: "Återställningslänk",
  resetHelp: (time: string) => `Gäller till ${time}, en gång. Den visas bara nu.`,
  copy: "Kopiera länken",
  copied: "Länken är kopierad.",
  copyFailed: "Kunde inte kopiera. Markera länken och kopiera den.",
  closeLink: "Stäng",
  log: "Logg",
  logHelp: "Senaste åtgärderna, nyast först. Loggen kan inte ändras.",
  logEmpty: "Inga åtgärder ännu.",
  logColumns: { when: "När", who: "Vem", what: "Vad", target: "Mot", reason: "Skäl" }
} as const;
