/** ADR-0172 beslut 4: startsidan, tävlingssidan, förhandsvisningen, QR-sidan och publiceringen i arbetsytan. */
export const publicRaceSv = {
  home: {
    title: "Tävlingar",
    intro: "Startlistor, resultat och sträcktider från tävlingar och träningar som tar tid med O-Tid.",
    searchLabel: "Sök tävling",
    searchPlaceholder: "Tävlingens namn",
    search: "Sök",
    showAll: "Visa alla",
    searchHeading: (query: string) => `Sökträffar för ”${query}”`,
    ongoing: "Pågår nu",
    upcoming: "Kommande",
    recent: "Senaste",
    showMore: "Visa fler",
    noneOngoing: "Inga tävlingar i dag.",
    noneUpcoming: "Inga kommande tävlingar publicerade.",
    noneRecent: "Inga tidigare tävlingar.",
    noMatch: (query: string) => `Ingen publicerad tävling matchar ”${query}”.`,
    myRaces: "Mina tävlingar",
    organizerLogin: "För arrangörer: logga in",
    accountNavigation: "Konto"
  },
  links: { startList: "Startlista", results: "Resultat", splits: "Sträcktider" },
  hub: {
    navigation: "Tävlingssidan",
    back: "‹ Tävlingssidan",
    startList: "Startlista",
    startListHelp: "Starttider per klass, tid och klubb.",
    startListPending: "Startlistan är inte publicerad ännu.",
    results: "Resultat",
    resultsHelp: "Uppdateras medan löparna läser av.",
    resultsPending: "Resultaten visas här när de första löparna har läst av.",
    splits: "Sträcktidsanalys",
    splitsHelp: "Sträcktider, placering per sträcka och tidsförlust.",
    routes: "Vägval",
    routesHelp: "Löparnas vägval på kartan. Öppna från sträcktidsanalysen.",
    lastUpdate: "Senast uppdaterad",
    address: "Adress till sidan"
  },
  preview: {
    banner: "Förhandsvisning – inte publicerad",
    help: "Bara du och andra med behörighet på tävlingen ser sidan. Publicera tävlingen i arbetsytan när den ska synas för alla."
  },
  notPublished: {
    title: "Tävlingen är inte publicerad",
    help: "Tävlingen finns inte eller är inte publicerad ännu. Arrangören publicerar den när den är klar.",
    organizer: "Arrangör? Logga in för att förhandsvisa din tävling.",
    home: "Till startsidan"
  },
  resultNotFound: {
    title: "Resultatet finns inte",
    help: "Resultatet finns inte längre, eller så är tävlingen inte publicerad."
  },
  qr: {
    title: "QR-kod att skriva ut",
    line: "Resultat och sträcktider",
    scan: "Skanna koden eller gå till",
    print: "Skriv ut",
    size: "Storlek",
    a4: "Hel sida (A4)",
    a5: "Halv sida (A5)",
    image: (name: string) => `QR-kod till tävlingssidan för ${name}`
  },
  publish: {
    title: "Publicera",
    help: "När tävlingen är publicerad syns tävlingssidan för alla och tävlingen finns på startsidan. Resultaten syns när löparna läser av.",
    startListRelation: "Startlistan har en egen publicering under Start och syns först när du publicerar den där.",
    published: (when: string) => `Publicerad ${when}. Tävlingssidan syns för alla.`,
    unpublished: "Inte publicerad. Bara du och andra med behörighet ser tävlingssidan (förhandsvisning).",
    hidden: "Dold av den som driver O-Tid. Tävlingen syns inte publikt även om den är publicerad.",
    status: { published: "Publicerad", unpublished: "Inte publicerad", hidden: "Dold" },
    publish: "Publicera tävlingen",
    unpublish: "Sluta publicera",
    publishedNow: "Tävlingen är publicerad.",
    unpublishedNow: "Tävlingen är inte längre publicerad.",
    failed: "Det gick inte att ändra publiceringen. Försök igen.",
    page: "Tävlingssidan",
    openPage: "Öppna tävlingssidan",
    previewPage: "Förhandsvisa tävlingssidan",
    printQr: "Skriv ut QR-kod",
    newTab: "öppnas i ny flik"
  }
};
