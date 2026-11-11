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
    added: (count: number) => count === 1 ? "1 underlag tillagt. Det ligger under Underlag här ovanför, där det tänds, släcks och görs genomskinligt."
      : `${count} underlag tillagda. De ligger under Underlag här ovanför, där de tänds, släcks och görs genomskinliga.`,
    failed: (count: number) => count === 1 ? "1 bild kunde inte läggas till. Orsaken står under Underlag här ovanför."
      : `${count} bilder kunde inte läggas till. Orsaken står under Underlag här ovanför.`,
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
  photo: {
    heading: "Tolka flygbild (berg i dagen, öppen mark)",
    help: "Ett första försök: ett ortofoto som ligger som underlag tolkas här i webbläsaren. Grå och ljusa ytor blir berg i dagen (214), ljusgröna och jämna ytor öppen mark (401). "
      + "Bara breda ytor räknas. Torrt gräs, grus och tak kan bli berg i dagen, så gå igenom förslagen innan du lägger in dem.",
    none: "Inget synligt underlag. Hämta ett ortofoto ovan och låt det vara tänt.",
    layer: "Underlag",
    run: "Tolka flygbilden",
    name: (layer: string) => `${layer} – flygbildstolkning`.slice(0, 120),
    done: (rock: number, open: number) => `${String(rock).replace(".", ",")} ha berg i dagen och ${String(open).replace(".", ",")} ha öppen mark visas som kandidater nedan under Vektorfil.`,
    nothing: "Inga breda grå eller ljusgröna ytor hittades i bilden.",
    failed: "Flygbilden kunde inte tolkas."
  },
  depth: {
    heading: "Fukt med reglage (blött och fuktigt)",
    help: "Laserkörningens fuktdjup (höjden över närmaste fuktstråk) läses här. Dra i gränserna: ytorna visas direkt som kandidater på kartan, "
      + "utan en ny körning. Blött blir sankmark (308) och fuktigt otydlig sankmark (310).",
    none: "Inget fuktdjup tänt. Kör Karttapullautin med fuktigheten och låt underlaget som slutar på ”fuktdjup” vara tänt.",
    layer: "Underlag",
    wet: (meters: string) => `Blött: upp till ${meters} m över fuktstråket`,
    moist: (meters: string) => `Fuktigt: upp till ${meters} m`,
    minArea: (square: number) => `Minsta yta: ${square} m²`,
    run: "Visa som kandidater",
    name: (layer: string) => `${layer} – blött och fuktigt`.slice(0, 120),
    done: (wet: string, moist: string) => `${wet} ha blött och ${moist} ha fuktigt. Ändra gränserna så räknas det om.`,
    nothing: "Inga ytor med de här gränserna.",
    failed: "Fuktdjupet kunde inte läsas."
  },
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
      + "Karttapullautin: bilden läggs till som underlag, och kurvor, formlinjer, branter och knollar kan läsas in som kandidater. "
      + "Laserdatan klipps till kartans område (eller etappen) med 50 m marginal innan den bearbetas.",
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
    formlines: "Stödkurvor",
    formlineOptions: { 0: "Inga stödkurvor", 1: "Kurvor på halva ekvidistansen", 2: "Stödkurvor där de behövs" } as Record<number, string>,
    choicesHeading: "Inställningar",
    choiceLabels: { cliffs: "Branter", contours: "Kurvor", knolls: "Knollar", green: "Grönt", undergrowth: "Undervegetation" } as Record<string, string>,
    choiceLevels: {
      cliffs: { less: "Färre", default: "Som förval", more: "Fler" }, contours: { less: "Slätare", default: "Som förval", more: "Detaljrikare" },
      knolls: { less: "Färre", default: "Som förval", more: "Fler" }, green: { less: "Mindre", default: "Som förval", more: "Mer" },
      undergrowth: { less: "Mindre", default: "Som förval", more: "Mer" }
    } as Record<string, Record<"less" | "default" | "more", string>>,
    choicesHelp: "Grönt mäts av Karttapullautin som andelen laserträffar 1–2,65 m över marken (buskskiktet) mot träffarna på marken, och väger in trädkronorna. Prova på en etapp först, eller kör om ett klart jobb och jämför.",
    rerun: "Kör om med andra inställningar",
    rerunHeading: (name: string) => `Kör om ${name} med samma rutor och område:`,
    rerunName: (name: string) => `${name} (ny)`.slice(0, 80),
    rerunStart: "Kör om",
    more: "Avancerat: värden i Karttapullautin",
    moreHelp: "Värdena skrivs i Karttapullautins pullauta.ini (namnet står inom parentes). Lämna ett fält tomt för Karttapullautins förval. "
      + "Prova på en liten etapp först och jämför bilderna.",
    settingLabels: {
      smoothing: "Kurvornas utjämning", curviness: "Kurvornas formrikedom", knolls: "Knollar", formlinesteepness: "Formlinjer efter lutning",
      cliff1: "Branter, tröskel 1", cliff2: "Branter, tröskel 2", cliffsteepfactor: "Branter, lutningsfaktor",
      yellowheight: "Öppen mark, högsta höjd", greenground: "Grönt, markskiktets höjd", greenhigh: "Grönt, högsta höjd", undergrowth: "Undervegetation",
      topweight: "Grönt, hur mycket kronorna väger", greenscale: "Grönt, faktor på gränserna"
    } as Record<string, string>,
    // Förvalen och riktningarna ur Karttapullautins pullauta.default.ini (2.15.4).
    settingHints: {
      smoothing: "Förval 0,7. Högre värde ger slätare kurvor.", curviness: "Förval 1,1. Högre värde överdriver kurvornas böjar.",
      knolls: "Förval 0,6. Högre värde ger färre men tydligare knollar.", formlinesteepness: "Förval 0,37. Högre värde ger fler stödkurvor.",
      cliff1: "Förval 1,15: fallhöjd i meter per meter i sidled för att en passerbar brant ska ritas. Lägre värde ger fler branter.",
      cliff2: "Förval 2,0: samma mått för opasserbar brant.", cliffsteepfactor: "Förval 0,38.",
      yellowheight: "Förval 0,9 m.", greenground: "Förval 0,9 m.", greenhigh: "Förval 2 m.",
      undergrowth: "Förval 0,35. Lägre värde ger mer undervegetation.",
      topweight: "Förval 0,8. Lägre värde gör att grönt under täta kronor inte räknas upp.", greenscale: "Förval 1. Större värde ger mindre grönt."
    } as Record<string, string>,
    settingField: (label: string, key: string, low: number, high: number) => `${label} (${key}, ${String(low).replace(".", ",")}–${String(high).replace(".", ",")})`,
    settingDefault: "förval",
    settingsUsed: (list: string) => `Inställningar: ${list}`,
    clipped: (width: number, height: number) => `Klippt till området, ${width} × ${height} m`,
    unclipped: "Hela laserrutorna",
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
    dwgJob: "DWG-ritning",
    tiles: (count: number) => count === 1 ? "1 ruta" : `${count} rutor`,
    layerAdded: "Bilden är tillagd som underlag.",
    outputs: {
      "kurvor.dxf": "Kurvor", "formlinjer.dxf": "Formlinjer", "branter.dxf": "Branter", "stup.dxf": "Stup", "knollar.dxf": "Knollar",
      "fukt.dxf": "Våtmarker och fuktstråk", "diken.dxf": "Diken ur terrängformen", "berg.dxf": "Stenar och berg i dagen", "vegetation.dxf": "Vegetationsytor", "vatten.geojson": "Sjöar och vatten", "brantlinjer.dxf": "Branter som linjer", "marktacke.geojson": "Lantmäteriets marktäcke", "byggnader.geojson": "Lantmäteriets byggnader", "ritning.geojson": "Ritningen"
    } as Record<string, string>,
    loadBaseMap: "Läs in grundkartan",
    osmMissing: "OpenStreetMap gick inte att hämta nu, så stigar, vägar och hus saknas. Hämta dem under Importera vektorer.",
    extras: { LAND_COVER: "Läs också Lantmäteriets marktäcke (vatten, öppen mark, åker, sankmark)", BUILDINGS: "Läs också Lantmäteriets byggnader" } as Record<string, string>,
    baseMap: "Grundkartan",
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
