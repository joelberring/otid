/** ADR-0219 (K4c): kontots egna uppgifter till Lantmäteriet och ortofoton i kartprojektet. */
export const mapSourcesSv = {
  account: {
    title: "Lantmäteriet",
    help: "Dina egna uppgifter till Lantmäteriet, för att hämta ortofoton och laserdata till kartprojekten. O-Tid har inget eget konto hos Lantmäteriet. "
      + "Uppgifterna sparas krypterade, används bara när du hämtar och visas aldrig igen. Produkterna (Ortofoto Nedladdning, Laserdata Nedladdning skog) måste vara beställda på Geotorget.",
    method: "Sätt att logga in",
    basic: "Geotorgets användarnamn och lösenord (privatperson)",
    oauth: "API-portalens nyckel och hemlighet (organisationens systemkonto)",
    id: (method: "BASIC" | "OAUTH2") => method === "BASIC" ? "Användarnamn" : "Nyckel (consumer key)",
    secret: (method: "BASIC" | "OAUTH2") => method === "BASIC" ? "Lösenord" : "Hemlighet (consumer secret)",
    save: "Spara uppgifterna",
    remove: "Ta bort uppgifterna",
    saved: (method: "BASIC" | "OAUTH2", hint: string, date: string) =>
      `Sparat ${date}: ${method === "BASIC" ? "användarnamn" : "nyckel"} som slutar på …${hint}.`,
    unreadable: "Serverns nyckel har bytts sedan uppgifterna sparades. Spara dem igen.",
    none: "Inga uppgifter sparade.",
    notConfigured: "Servern kan inte spara uppgifter (masternyckeln saknas). Kontakta den som driftar O-Tid.",
    savedDone: "Uppgifterna är sparade.",
    removedDone: "Uppgifterna är borttagna.",
    failed: "Det gick inte. Försök igen.",
    trial: "Provas: hämtningen från Lantmäteriet är byggd efter deras guider men inte provad mot riktiga tjänsten ännu."
  },
  ortho: {
    heading: "Ortofoto från Lantmäteriet",
    help: "Sök flygbilder för hela kartan eller en etapp med dina egna uppgifter till Lantmäteriet; de valda läggs till som underlag (en per bildruta). © Lantmäteriet.",
    noCredential: "Lägg in dina uppgifter till Lantmäteriet under Mitt konto först.",
    account: "Mitt konto",
    where: "Område",
    whole: "Hela kartan",
    search: "Sök ortofoton",
    searching: "Söker …",
    none: "Inga ortofoton hittades för området.",
    item: (when: string | null, collection: string | null, id: string) => [when?.slice(0, 10), collection, id].filter(Boolean).join(" · "),
    add: (count: number) => count === 1 ? "Lägg till 1 bild som underlag" : `Lägg till ${count} bilder som underlag`,
    adding: (done: number, total: number) => `Hämtar bild ${done} av ${total} …`,
    added: (count: number) => count === 1 ? "1 underlag tillagt." : `${count} underlag tillagda.`,
    name: (collection: string | null, id: string) => `Ortofoto ${collection ?? ""} ${id}`.replace(/\s+/g, " ").trim().slice(0, 80),
    problems: {
      SOURCE_NO_CREDENTIAL: "Lägg in dina uppgifter till Lantmäteriet under Mitt konto först.",
      SOURCE_REJECTED: "Lantmäteriet godtog inte uppgifterna, eller produkten är inte beställd på Geotorget.",
      SOURCE_AREA_TOO_LARGE: "Området är för stort för en sökning. Välj en etapp.",
      SOURCE_THROTTLED: "För många sökningar den senaste timmen. Försök igen senare.",
      SOURCE_UNAVAILABLE: "Lantmäteriet svarade inte just nu. Försök igen om en stund.",
      OUTSIDE: "Bilden täcker inte området.",
      generic: (status: number | string) => `Det gick inte (${status}).`
    }
  },
  /** K5c: SLU:s markfuktighetskarta som underlag. */
  moisture: {
    heading: "Markfuktighet (SLU)",
    help: "SLU:s markfuktighetskarta (2 m, öppen data från Skogsstyrelsen) för hela kartan eller en etapp, som underlag. Blått är blött: "
      + "använd den för att hitta våtmarker, fuktstråk och diken att rekognosera.",
    fetch: "Hämta markfuktighet",
    fetching: "Hämtar markfuktighet …",
    name: (area?: string) => `Markfuktighet SLU ${area ?? "hela kartan"}`.slice(0, 80),
    added: "Markfuktigheten är tillagd som underlag.",
    attribution: "Markfuktighetskarta SLU, Skogsstyrelsen."
  },
  /** K5: laserdata och Karttapullautin på geo-servern. */
  laser: {
    heading: "Laserdata och Karttapullautin",
    help: "Sök laserrutor (2,5 × 2,5 km) för hela kartan eller en etapp med dina egna uppgifter till Lantmäteriet. Geo-servern kör "
      + "Karttapullautin: bilden läggs till som underlag, och kurvor, formlinjer, branter och knollar kan läsas in som kandidater.",
    attribution: "Laserdata Nedladdning, skog © Lantmäteriet, CC BY 4.0 (bearbetad med Karttapullautin, GPL-3).",
    search: "Sök laserrutor",
    searching: "Söker …",
    none: "Inga laserrutor hittades för området.",
    item: (when: string | null, id: string, bytes: number | null) =>
      [when?.slice(0, 10), id, bytes ? `${Math.round(bytes / 1_000_000)} MB` : null].filter(Boolean).join(" · "),
    name: "Namn på resultatet",
    defaultName: (area?: string) => `Karttapullautin ${area ?? "hela kartan"}`.slice(0, 80),
    interval: "Ekvidistans",
    intervalOption: (meters: number) => `${String(meters).replace(".", ",")} m`,
    formlines: "Formlinjer",
    formlineOptions: { 0: "Inga", 1: "Några", 2: "Fler" } as Record<number, string>,
    moisture: "Räkna också fuktigheten (våtmarker och fuktstråk ur markmodellen)",
    channel: "Fuktstråk från tillrinning",
    channelOption: (ha: number) => `${String(ha).replace(".", ",")} ha`,
    wet: "Blött under",
    wetOption: (meters: number) => `${String(meters).replace(".", ",")} m över stråket`,
    moistureAdded: "Fuktigheten är tillagd som underlag.",
    vegetation: "Gör också ytor av vegetationen (öppen mark, grönt och undervegetation ur laserns returer)",
    minArea: "Minsta yta",
    minAreaOption: (m2: number) => `${m2} m²`,
    start: (count: number) => count === 1 ? "Kör Karttapullautin på 1 ruta" : `Kör Karttapullautin på ${count} rutor`,
    started: "Jobbet ligger i kön.",
    jobs: "Jobben",
    status: {
      QUEUED: "Väntar på geo-servern", RUNNING: "Pågår", DONE: "Klart", FAILED: "Misslyckades", CANCELLED: "Avbrutet"
    } as Record<string, string>,
    progress: (step: string, done: number, total: number) => total > 1 ? `${step} (${done} av ${total})` : step,
    tiles: (count: number) => count === 1 ? "1 ruta" : `${count} rutor`,
    layerAdded: "Bilden är tillagd som underlag.",
    outputs: {
      "kurvor.dxf": "Kurvor", "formlinjer.dxf": "Formlinjer", "branter.dxf": "Branter", "stup.dxf": "Stup", "knollar.dxf": "Knollar",
      "fukt.dxf": "Våtmarker och fuktstråk", "vegetation.dxf": "Vegetationsytor"
    } as Record<string, string>,
    load: (label: string) => `Läs in ${label.toLowerCase()} som kandidater`,
    loaded: (label: string) => `${label} visas som kandidater nedan under Vektorfil.`,
    cancel: "Avbryt",
    remove: "Ta bort",
    server: {
      READY: "Geo-servern är igång.",
      STARTING: "Geo-servern startar (några minuter).",
      OFF: "Geo-servern startar när ett jobb väntar.",
      UNAVAILABLE: "Geo-servern kan inte startas just nu. Jobben väntar i kön; ägaren av O-Tid har fått besked.",
      BUDGET: "Månadens budget för geo-servern är slut. Jobben väntar i kön till nästa månad eller tills budgeten höjs.",
      NOT_CONFIGURED: "Geo-servern är inte inställd på den här installationen. Jobben väntar i kön."
    } as Record<string, string>,
    problems: {
      SOURCE_NO_CREDENTIAL: "Lägg in dina uppgifter till Lantmäteriet under Mitt konto först.",
      SOURCE_REJECTED: "Lantmäteriet godtog inte uppgifterna, eller Laserdata Nedladdning skog är inte beställd på Geotorget.",
      SOURCE_AREA_TOO_LARGE: "Området är för stort för en sökning. Välj en etapp.",
      SOURCE_THROTTLED: "För många sökningar den senaste timmen. Försök igen senare.",
      SOURCE_UNAVAILABLE: "Lantmäteriet svarade inte just nu. Försök igen om en stund.",
      GEO_JOB_BUSY: "Du har redan två jobb som väntar eller pågår. Vänta tills något är klart.",
      GEO_JOB_QUOTA: "Månadens kvot av laserrutor är slut för ditt konto.",
      generic: (status: number | string) => `Det gick inte (${status}).`
    }
  }
} as const;
