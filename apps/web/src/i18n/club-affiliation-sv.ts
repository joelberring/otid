import { plural } from "./plural";
/**
 * Var klubbens API-nyckel finns i Eventor (Eventors guide "Get data via API": Club → Club settings; svenska Eventor: Klubb →
 * Klubbinställningar). Samma väg i kopplingsrutan, hjälpen, tävlingens Eventor-ruta och texten till klubbens Eventor-administratör.
 */
export const EVENTOR_KEY_PLACE = "Klubb → Klubbinställningar";

/** ADR-0209: klubbtillhörighet – Mina klubbar, klubben i Eventor, Vem ser vad, Från klubben och tävlingen i klubbarkivet. */
export const clubAffiliationSv = {
  picker: {
    search: "Sök klubb",
    placeholder: "t.ex. Älvsjö eller OKÄÖ",
    none: "Ingen klubb matchar. Skriv namnet under Annan klubb.",
    emptyDirectory: "Klubblistan är inte hämtad på den här servern än. Skriv klubbens namn under Annan klubb.",
    remove: (name: string) => `Ta bort ${name}`,
    other: "Annan klubb",
    otherHelp: "Om klubben inte finns i listan (t.ex. en klubb utanför Sverige)."
  },
  status: {
    PENDING: "Väntar på bekräftelse",
    CONFIRMED: "Bekräftad",
    DECLINED: "Inte bekräftad av klubben"
  } as const,
  confirmedVia: { EVENTOR: "bekräftad via Eventor", MANUAL: "bekräftad av klubben" } as const,
  step: {
    title: "Vilken klubb tillhör du?",
    intro: "Valfritt. Välj din klubb, så kan klubbens ledare bjuda in dig till tävlingar och träningar, och du kan se klubbens arkiv när klubben har bekräftat dig.",
    save: "Spara klubbarna",
    skip: "Hoppa över",
    later: "Du kan ändra det senare under Mitt konto → Mina klubbar.",
    failed: "Klubbarna kunde inte sparas. Försök igen."
  },
  onboarding: {
    member: (club: string) => `Du är med i ${club}`,
    memberHelp: "Din e-postadress finns i klubbens medlemslista i Eventor, så du är bekräftad direkt.",
    open: "Öppna klubbytan",
    pending: (club: string) => `${club}: väntar på bekräftelse`,
    pendingHelp: "Klubbens administratörer bekräftar dig. Det går fortare om din adress i Eventor är densamma som här.",
    noSpace: "Ingen från klubben har startat klubbytan än – är du admin i Eventor? Starta den här",
    start: "Starta klubbytan",
    starting: "Startar …",
    startFailed: "Klubbytan kunde inte startas. Försök igen."
  },
  account: {
    title: "Mina klubbar",
    help: "Klubbarna du tillhör. En klubb bekräftar dig (automatiskt via Eventor eller av klubbens administratörer) innan du ser något i klubbytan.",
    empty: "Du har inte valt någon klubb.",
    add: "Lägg till klubben",
    addOther: "Lägg till",
    remove: "Ta bort",
    removeConfirm: (name: string) => `Ta bort ${name} från dina klubbar? Är du bekräftad försvinner också det du ser i klubbytan.`,
    exists: "Klubben finns redan i listan.",
    saved: "Klubbarna är sparade.",
    failed: "Det gick inte. Försök igen."
  },
  space: {
    tab: "Klubben",
    unlinked: "Inte kopplad till Eventor",
    unlinkedHelp: "Klubbytan är inte bevisad med klubbens Eventor-nyckel. Medlemmarna vet då inte att den är klubbens egen.",
    linkedBadge: (club: string) => `Kopplad till Eventor · ${club}`,
    eventorTitle: "Koppla till Eventor",
    eventorHelp: `Klistra in klubbens API-nyckel. Den finns i Eventor under ${EVENTOR_KEY_PLACE}, och bara klubbens administratörer i Eventor kommer åt den. O-Tid frågar Eventor vilken klubb nyckeln tillhör. Nyckeln sparas krypterad och visas aldrig igen.`,
    key: "Klubbens API-nyckel",
    link: "Koppla till Eventor",
    linking: "Kopplar …",
    linked: (club: string, hint: string) => `Kopplad till Eventor · ${club} · nyckel …${hint}`,
    replace: "Byt nyckel",
    unlink: "Ta bort kopplingen",
    unlinkConfirm: "Ta bort kopplingen till Eventor? Nyckeln och medlemslistan tas bort, och de som bekräftades via Eventor väntar på bekräftelse igen.",
    sync: "Hämta medlemmar nu",
    syncing: "Hämtar …",
    counts: (members: number, confirmed: number) => `${members} medlemmar i Eventor, ${confirmed} har O-Tid och är bekräftade`,
    syncedAt: (at: string) => `Senast hämtad ${at}. Listan hämtas automatiskt en gång per dygn.`,
    neverSynced: "Medlemslistan är inte hämtad än.",
    problems: {
      NOT_CONFIGURED: "Servern har inte Eventor påslaget (masternyckeln saknas). Kontakta den som driver O-Tid.",
      INVALID_KEY: "Det ser inte ut som en API-nyckel från Eventor (16–128 tecken).",
      REJECTED: "Eventor godtog inte nyckeln. Kontrollera att den är klubbens nyckel och inte återkallad.",
      UNAVAILABLE: "Eventor svarade inte. Försök igen om en stund.",
      ALREADY_LINKED: "Klubben är redan kopplad till en annan klubbyta i O-Tid. Kontakta ägaren av den klubbytan.",
      TOO_SOON: "Medlemmarna hämtades nyss. Försök igen om en timme.",
      NOT_LINKED: "Klubbytan är inte kopplad till Eventor."
    } as Record<string, string>,
    accessTitle: "Vem ser vad",
    accessHelp: "Klubben bestämmer. Ägare och administratörer ser och använder alltid allt; kartornas egna rättigheter gäller ovanpå för medlemmar och ledare.",
    archive: "Träningsarkivet (träningar, småbilder, banfiler) syns för",
    mapBank: "Kartbanken (kartfiler, Använd igen, nedladdning) får användas av",
    mapBankHint: "Välj Ledare och admin om kartorna inte ska delas med alla medlemmar.",
    MEMBERS: "Alla medlemmar",
    LEADERS: "Ledare och admin",
    saveAccess: "Spara",
    accessSaved: "Vem ser vad är sparat.",
    pending: (count: number) => `Väntar på bekräftelse (${count})`,
    pendingHelp: "De har valt klubben men deras adress fanns inte i Eventors medlemslista (eller klubbytan är inte kopplad). Bekräfta bara den du vet är med i klubben.",
    pendingNone: "Ingen väntar.",
    freeText: (text: string) => `skrev ”${text}”`,
    confirm: "Bekräfta",
    decline: "Avböj",
    confirmed: (count: number) => `Bekräftade medlemmar (${count})`,
    confirmedNone: "Inga bekräftade medlemmar än.",
    removeMember: "Ta bort",
    removeConfirm: (name: string) => `Ta bort ${name} som bekräftad medlem?`,
    failed: "Det gick inte. Försök igen.",
    archiveClosed: "Träningsarkivet är för klubbens ledare och administratörer (klubbens val under Vem ser vad)."
  },
  fromClub: {
    title: "Från klubben",
    help: "Bekräftade medlemmar i dina klubbar som har O-Tid. Du ser bara namnen; inbjudan skickas till deras adress.",
    search: "Sök namn",
    none: "Inga bekräftade medlemmar att bjuda in.",
    already: "redan med",
    invite: (count: number) => count === 1 ? "Bjud in 1 person" : `Bjud in ${count} personer`,
    invited: (count: number, already: number) => `${plural(count, "inbjudan", "inbjudningar")} sparade.${already > 0 ? ` ${already} var redan med.` : ""}`,
    failed: "Inbjudningarna kunde inte sparas. Försök igen.",
    open: "Från klubben",
    fromClubNote: "från klubben"
  },
  race: {
    title: "Klubben och klubbarkivet",
    help: "Arrangörsklubben syns bara för tävlingens behöriga. Före tävlingen visas ingenting om den för klubben.",
    organiser: "Arrangörsklubb",
    noOrganiser: "Ingen vald",
    suggestion: (club: string) => `Förslag: ${club} (din klubb)`,
    useSuggestion: "Använd förslaget",
    saveOrganiser: "Spara arrangörsklubben",
    clearOrganiser: "Ingen arrangörsklubb",
    saved: "Arrangörsklubben är sparad.",
    noSpace: "Arrangörsklubben har ingen klubbyta kopplad till Eventor där du är administratör.",
    space: (club: string) => `Klubbytan: ${club}`,
    contents: "Det som läggs i klubbarkivet: kartfilen (som kartversion), banläggningen (.ppen) och banorna (IOF XML), och en länk hit. Inga startlistor, resultat eller deltagare.",
    noContents: "Tävlingen har ingen kartfil eller banor att lägga i arkivet än.",
    lift: "Lägg i klubbarkivet",
    lifting: "Lägger i arkivet …",
    lifted: "Tävlingen ligger i klubbarkivet.",
    openEntry: "Öppna i klubbarkivet",
    unlift: "Ta ur klubbarkivet",
    unliftConfirm: "Ta ur klubbarkivet? Träningen i arkivet tas bort. Tävlingen ändras inte.",
    secrecyTitle: "Banorna är hemliga",
    secrecy: "Tävlingen har inte varit än (eller alla har inte gått i mål). Lägger du den i klubbarkivet nu ser klubbens medlemmar banorna innan de springer.",
    secrecyConfirm: "Jag förstår att banorna syns för klubben före tävlingen",
    reminder: "Tävlingen är klar – lägga banorna i klubbarkivet?",
    reminderOpen: "Till Klubben och klubbarkivet",
    errors: {
      NO_CLUB_ARCHIVE: "Arrangörsklubben har ingen klubbyta kopplad till Eventor där du är administratör.",
      COURSES_SECRET: "Bekräfta banhemligheten först.",
      ALREADY_IN_ARCHIVE: "Tävlingen ligger redan i klubbarkivet."
    } as Record<string, string>,
    failed: "Det gick inte. Försök igen."
  }
} as const;
