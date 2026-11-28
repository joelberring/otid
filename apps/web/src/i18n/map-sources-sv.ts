/** ADR-0219 (K4c): kontots egna uppgifter till Lantmäteriet och ortofoton i kartprojektet. */
export const mapSourcesSv = {
  account: {
    title: "Lantmäteriet",
    help: "Dina egna uppgifter till Lantmäteriet, för att hämta ortofoton och laserdata till kartprojekten. O-Tid har inget eget konto hos Lantmäteriet. "
      + "Uppgifterna sparas krypterade, används bara när du hämtar och visas aldrig igen. Produkterna måste vara beställda på Geotorget; vilka som behövs står nedanför.",
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
    help: "Sök flygbilder för hela kartan eller ett delområde med dina egna uppgifter till Lantmäteriet; de valda läggs till som underlag (en per bildruta). © Lantmäteriet.",
    where: "Område",
    whole: "Hela kartan",
    search: "Sök ortofoton",
    searching: "Söker …",
    none: "Inga ortofoton hittades för området.",
    item: (when: string | null, collection: string | null, id: string) => [when?.slice(0, 10), collection, id].filter(Boolean).join(" · "),
    add: (count: number) => count === 1 ? "Lägg till 1 bild som underlag" : `Lägg till ${count} bilder som underlag`,
    adding: (done: number, total: number) => `Hämtar bild ${done} av ${total} …`,
    added: (count: number) => count === 1 ? "1 underlag tillagt. Det ligger under Lager › Underlag, där det tänds, släcks och görs genomskinligt."
      : `${count} underlag tillagda. De ligger under Lager › Underlag, där de tänds, släcks och görs genomskinliga.`,
    failed: (count: number) => count === 1 ? "1 bild kunde inte läggas till. Orsaken står här nedanför och under Lager › Underlag."
      : `${count} bilder kunde inte läggas till. Orsaken står här nedanför och under Lager › Underlag.`,
    name: (collection: string | null, id: string) => `Ortofoto ${collection ?? ""} ${id}`.replace(/\s+/g, " ").trim().slice(0, 80),
    problems: {
      SOURCE_NO_CREDENTIAL: "Lägg in dina uppgifter till Lantmäteriet under Mitt konto först.",
      SOURCE_REJECTED: "Lantmäteriet godtog inte uppgifterna, eller produkten är inte beställd på Geotorget.",
      SOURCE_AREA_TOO_LARGE: "Området är för stort för en sökning. Välj ett delområde.",
      SOURCE_THROTTLED: "För många sökningar den senaste timmen. Försök igen senare.",
      SOURCE_UNAVAILABLE: "Lantmäteriet svarade inte just nu. Försök igen om en stund.",
      OUTSIDE: "Bilden täcker inte området.",
      generic: (status: number | string) => `Det gick inte (${status}).`
    }
  },
  /** K5c: SLU:s markfuktighetskarta som underlag. */
  photo: {
    heading: "Tolka flygbild (berg i dagen, gläntor)",
    help: "Laserkörningen ger formen och kanten: öppet är där vegetationen är lägre än 1,5 m. Ortofotot säger vad ytan är, jämfört med resten av samma bild: "
      + "en lucka med levande trädkronor i bilden blir ingen glänta, och den torra öppna marken med minst grönska blir berg i dagen (214), resten öppen mark (403). "
      + "Tolkningen kräver en klar laserkörning och fungerar bäst med ortofotots falskfärgsbild (underlaget som slutar på «– IR»). Gå igenom förslagen innan du lägger in dem.",
    none: "Inget synligt underlag. Hämta ett ortofoto ovan och låt det vara tänt.",
    allTiles: (count: number) => `Alla tända ortofoton (${count} bildrutor, som en bild)`,
    allName: (count: number) => `Ortofoton (${count} bildrutor)`,
    layer: "Underlag",
    run: "Tolka flygbilden",
    loading: "Läser laserkörningen …",
    rockShare: (percent: number) => percent === 0 ? "Berg i dagen: inget (allt öppet blir glänta)" : `Berg i dagen: den torra öppna mark som har minst grönska (${percent} % av bilden)`,
    rockShareHelp: "Gränsen mellan häll och glänta är ofta flytande. Lågt ger mer gult, högt mer grått. Förvalet 10 % är mätt mot Tyresta.",
    name: (layer: string) => `${layer} – flygbildstolkning`.slice(0, 120),
    done: (rock: number, open: number) => `${String(rock).replace(".", ",")} ha berg i dagen och ${String(open).replace(".", ",")} ha öppen mark visas som utkast på kartan. Lägg in det i raden under kartan.`,
    noInfrared: "Bilden saknar nära infrarött, så bara laserns öppna mark visas och inget berg. Välj underlaget som slutar på «– IR».",
    noLaser: "Tolkningen behöver en klar laserkörning med vegetationshöjden (geo-arbetarens version 12 eller senare). Kör lasern först.",
    notSweref: "Tolkningen med lasern kräver att kartan ligger i SWEREF 99 TM.",
    nothing: "Inga öppna ytor hittades i bildrutan.",
    failed: "Flygbilden kunde inte tolkas."
  },

  depth: {
    heading: "Fukt med reglage (blött och fuktigt)",
    help: "Laserkörningens fuktdjup (höjden över närmaste fuktstråk) läses här. Dra i gränserna: ytorna visas direkt som utkast på kartan, "
      + "utan en ny körning. Blött blir sankmark (308) och fuktigt otydlig sankmark (310).",
    none: "Inget fuktdjup bland underlagen. Kör laserjobbet med fuktigheten först.",
    layer: "Underlag",
    wet: (meters: string) => `Blött: upp till ${meters} m över fuktstråket`,
    moist: (meters: string) => `Fuktigt: upp till ${meters} m`,
    openGround: (percent: number) => percent >= 100 ? "Öppen mark: ingen gräns" : `Inte på öppen mark: där minst ${percent} % av lasern når marken`,
    slope: (degrees: string) => `Flack mark: blött högst ${degrees}° lutning, fuktigt dubbelt så brant`,
    minArea: (square: number) => `Minsta yta: ${square} m²`,
    run: "Visa som utkast",
    name: (layer: string) => `${layer} – blött och fuktigt`.slice(0, 120),
    done: (wet: string, moist: string, removed?: string) => `${wet} ha blött och ${moist} ha fuktigt${removed ? `, varav ${removed} ha borttaget på torr mark` : ""}. Ändra gränserna så räknas det om.`,
    noDrySoil: "Ingen sankmark på sand och grus (SGU:s jordartskarta)",
    noDrySoilHelp: "Jordartskartan har 25–200 m lägesnoggrannhet; en liten myr i ett sandområde kan försvinna. Strandkärr inom 30 m från vatten blir kvar.",
    soilAttribution: "Jordarter 1:25 000–1:100 000 © SGU.",
    soilFailed: "Jordartskartan gick inte att hämta nu, så reglaget räknar som förut.",
    nothing: "Inga ytor med de här gränserna.",
    failed: "Fuktdjupet kunde inte läsas."
  },
  green: {
    heading: "Grönt med reglage (406, 408, 410)",
    help: "Laserkörningens vegetationsklasser läses här. Ett högre steg ger mindre grönt; ytorna visas direkt som utkast på kartan, utan en ny körning.",
    none: "Inga vegetationsklasser bland underlagen. Kör laserjobbet med vegetationen först.",
    layer: "Underlag",
    step: (key: "slow" | "difficult" | "fight", value: number) => `${{ slow: "Löphindrande (406)", difficult: "Svårlöpt (408)", fight: "Mycket svårlöpt (410)" }[key]} från steg ${value}`,
    dense: (percent: number) => `Tätt buskskikt blir grönt från ${percent} % av laserträffarna 1–3 m över marken (nya körningar)`,
    minArea: (square: number) => `Minsta yta: ${square} m²`,
    undergrowth: "Undervegetation (407, 409)",
    simplify: (level: number) => `Generalisering: ${level === 0 ? "av (lager för lager)" : level}`,
    clearings: (level: number) => `Gläntor: ${level}`,
    clearingsHelp: "Öppen mark (401) i skogen. Högre tar med mindre gläntor och gör dem större; lägre tar bara de stora. 5 är som laserkörningen. Kanten rundas.",
    simplifyHelp: "Öppet, halvöppet och grönt formas tillsammans, som en kartritare: smala mellanzoner och strimlor försvinner, små fläckar går till grannen och kanterna blir lugna kurvor. Högre ger enklare former. 4 är förvalet; 0 jämnar bara varje lager för sig, som förut.",
    run: "Visa som utkast",
    name: (layer: string) => `${layer} – grönt`.slice(0, 120),
    done: (slow: string, difficult: string, fight: string) => `${slow} ha löphindrande, ${difficult} ha svårlöpt, ${fight} ha mycket svårlöpt. Ändra stegen så räknas det om.`,
    nothing: "Inga ytor med de här stegen.",
    failed: "Vegetationsklasserna kunde inte läsas."
  },
  moisture: {
    heading: "Markfuktighet (SLU)",
    help: "SLU:s markfuktighetskarta (2 m, öppen data från Skogsstyrelsen) för hela kartan eller ett delområde, som underlag. Blått är blött: "
      + "använd den för att hitta våtmarker, fuktstråk och diken att rekognosera.",
    fetch: "Hämta markfuktighet",
    fetching: "Hämtar markfuktighet …",
    name: (area?: string) => `Markfuktighet SLU ${area ?? "hela kartan"}`.slice(0, 80),
    added: "Markfuktigheten är tillagd som underlag.",
    attribution: "Markfuktighetskarta SLU, Skogsstyrelsen."
  },
  /** K5 + G4B: laserdata med O-Tids egen motor (`otidgeo`) eller bildmotorfri Karttapullautin på geo-servern. */
  laser: {
    heading: "Laserkörningar (avancerat)",
    help: "Sök laserrutor (2,5 × 2,5 km) för hela kartan eller ett delområde med dina egna uppgifter till Lantmäteriet. Geo-servern bearbetar "
      + "lasern med O-Tids egen motor (förval) eller bildmotorfri Karttapullautin: skuggning, relief, fukt och valfri översiktsbild blir underlag, och kurvor, formlinjer, branter, knollar och vegetation kan läsas in som utkast. "
      + "Laserdatan klipps till kartans område (eller delområdet) med 50 m marginal innan den bearbetas.",
    attribution: "Laserdata Nedladdning, skog © Lantmäteriet, CC BY 4.0 (bearbetad med O-Tid eller Karttapullautin, GPL-3).",
    search: "Sök laserrutor",
    searching: "Söker …",
    none: "Inga laserrutor hittades för området.",
    item: (when: string | null, id: string, bytes: number | null) =>
      [when?.slice(0, 10), id, bytes ? `${Math.round(bytes / 1_000_000)} MB` : null].filter(Boolean).join(" · "),
    name: "Namn på resultatet",
    defaultName: (area?: string) => `Karttapullautin ${area ?? "hela kartan"}`.slice(0, 80),
    engine: "Motor",
    engineOptions: {
      otidgeo: "O-Tid (egen motor — snabb, skarvfri, styrbar)",
      pullautin: "Karttapullautin (utan bildmotor — klassiska kurvor)"
    } as Record<string, string>,
    engineShort: { otidgeo: "O-Tid", pullautin: "Karttapullautin" } as Record<string, string>,
    pullautinNoOverview: "Karttapullautins bildmotor hoppas över — du får terrängskuggning, relief och alla vektorer snabbare utan översiktsbilden.",
    interval: "Ekvidistans",
    intervalOption: (meters: number) => `${String(meters).replace(".", ",")} m`,
    formlines: "Stödkurvor",
    formlineOptions: { 0: "Av", 1: "Sparsam", 2: "Normal", 3: "Riklig" } as Record<number, string>,
    contours: "Kurvprofil",
    contourStyles: {
      veryDetailed: "Mycket detaljerad", detailed: "Detaljerad", normal: "Normal", generalized: "Generaliserad", veryGeneralized: "Mycket generaliserad"
    } as Record<string, string>,
    choicesHeading: "Inställningar",
    cliffStyle: "Opasserbara branter",
    cliffStyles: { few: "Bara höga stup (från 4,5 m, minst 20 m)", most: "De flesta branter (från 3,5 m, minst 10 m)" } as Record<string, string>,
    cliffTags: "Föreslå passerbara branter med taggar",
    overview: "Skapa 2 m översiktsbild (karta.webp)",
    overviewHelp: "Förval på i O-Tids motor. Ger en snabb översiktsbild som underlag; stäng av om du bara vill ha skuggning, relief och vektorer.",
    rawTicks: "Spara Karttapullautins råa brantstreck (branter.dxf, stup.dxf)",
    rawTicksHelp: "Behövs sällan: grundkartan använder brantlinjerna. De råa strecken blir stora filer, ofta flera tiotals MB.",
    /** PLAN.md M6 (ägaren 2026-11-22): rå laserdata sparas aldrig, utom i en zip med hämtningslänk när man kryssar i det. */
    rawLaser: "Spara även rå laserdata åt mig",
    rawLaserHelp: "Laserfilerna som körningen använder (klippta till området) läggs i en zip med en hämtningslänk som gäller i 7 dygn. Länken visas här och skickas med e-post; sedan tas filen bort. Den räknas inte mot din lagring.",
    rawLaserTerms: "Lantmäteriets villkor för laserdata gäller den som hämtar (CC BY 4.0, källan ©Lantmäteriet; laserdata kan innehålla personuppgifter).",
    rawLaserOff: "Rå laserdata kan inte sparas här: förrådet (objektlagringen) är inte påslaget på den här servern. Laserfilerna tas alltid bort efter körningen.",
    rawLaserStatus: { PENDING: "Rå laserdata packas …", READY: "Rå laserdata", FAILED: "Rå laserdata kunde inte sparas" } as Record<string, string>,
    rawLaserLink: (megabytes: number) => `Hämta zip (${megabytes} MB)`,
    rawLaserUntil: (date: string) => `gäller till ${date}`,
    rawLaserOthers: "bara den som startade körningen kan hämta",
    rawLaserMissing: "Rå laserdata begärdes, men ingen zip-fil finns (geo-servern packade den inte, eller filen är redan borttagen).",
    choiceLabels: { cliffs: "Branter", knolls: "Knollar", green: "Grönt", undergrowth: "Undervegetation", open: "Gult", rock: "Berg i dagen" } as Record<string, string>,
    choiceLevels: {
      cliffs: { less: "Färre", default: "Som förval", more: "Fler" },
      knolls: { less: "Färre", default: "Som förval", more: "Fler" }, green: { less: "Mindre", default: "Som förval", more: "Mer" },
      undergrowth: { less: "Mindre", default: "Som förval", more: "Mer" },
      open: { less: "Mindre", default: "Som förval", more: "Mer" }, rock: { less: "Ta inte med", default: "Utan förslag", more: "Föreslå som berg i dagen" }
    } as Record<string, Record<"less" | "default" | "more", string>>,
    choicesHelp: "Grönt mäts ur andelen laserträffar i buskskiktet (1–3 m) och trädkronornas täthet. Prova på ett delområde först, eller kör om ett klart jobb och jämför.",
    rerun: "Kör om med andra inställningar",
    rerunHeading: (name: string) => `Kör om ${name} med samma rutor och område:`,
    rerunName: (name: string) => `${name} (ny)`.slice(0, 80),
    rerunStart: "Kör om",
    sample: "Område",
    sampleWhole: "Hela jobbets område",
    sampleMiddle: "Provruta 250 × 250 m i mitten",
    sampleArea: (name: string) => `Provruta 250 × 250 m i ${name}`,
    sampleSuffix: " (provruta)",
    more: { otidgeo: "Avancerat: finjustering för O-Tid-motorn", pullautin: "Avancerat: värden i Karttapullautin" } as Record<string, string>,
    moreHelp: {
      otidgeo: "Fysikaliska parametrar för O-Tids egen motor (flaggans nyckel står inom parentes). Lämna tomt för kurvprofilens förval.",
      pullautin: "Värdena skrivs i Karttapullautins pullauta.ini (namnet står inom parentes). Lämna ett fält tomt för Karttapullautins förval. Prova på ett litet delområde först och jämför."
    } as Record<string, string>,
    settingLabels: {
      smooth_m: "Höjdutjämning (meter)", taubin: "Kurvutjämning (Taubin-pass)", min_loop_area: "Minsta kurvring (m²)", min_clearance: "Minsta avstånd mellan kurvor (m)",
      formline_gap: "Minsta lucka för stödkurva (m)", formline_max_slope: "Maxlutning för stödkurva (°)", veg_smooth: "Vegetationsutjämning",
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
    otidgeoSettingHints: {
      smooth_m: "Förval 0,92 m (0,68 m sprint). Lägre behåller småformer, högre slätar ut markmodellen.",
      taubin: "Förval 2 pass (0–6). 0 behåller rå kurvgeometri, fler pass ger rundare kurvor utan krympning.",
      min_loop_area: "Förval 30 m² (14 m² sprint). Mindre slutna ringar filtreras bort eller blir punkthöjder.",
      min_clearance: "Förval 1,45 m (0,85 m sprint). Minsta avstånd mellan grannkurvor i trånga partier.",
      curviness: "Förval 0,24 (0–0,8 i motorn). Högre förstärker små ryggar och sänkor.",
      formline_gap: "Förval 4,0 m (3,1 m sprint). Minsta avstånd mellan huvudkurvor för att en stödkurva ska ritas.",
      formline_max_slope: "Förval 17,5° (17,0° sprint). Brantare slänter hålls rena från inklämda stödkurvor.",
      veg_smooth: "Förval 1,05 (0,65 detaljerad, 1,6 lugna ytor). Styr hur mycket grönt och öppet jämnas ihop.",
      greenscale: "Förval 1. Större värde ger mindre grönt, lägre värde ger mer grönt.",
      topweight: "Förval 0,34. Hur mycket täta trädkronor väger in i grönt.",
      undergrowth: "Förval 0,058. Lägre värde ger mer undervegetation i skog."
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
    skippedSteps: (steps: string) => `Kunde inte räknas för det här området: ${steps}. Resten är klart; prova ett mindre delområde för det som saknas.`,
    stepNames: { ditches: "diken", stones: "stenar", rock: "berg i dagen", knolls: "små kullar" } as Record<string, string>,
    vegetation: "Gör också ytor av vegetationen (öppen mark, grönt och undervegetation ur laserns returer)",
    minArea: "Minsta yta",
    minAreaOption: (m2: number) => `${m2} m²`,
    vegSmooth: "Vegetationsutjämning",
    vegSmoothOptions: { detailed: "Detaljerad (0,65)", normal: "Normal (1,05)", calm: "Lugna ytor (1,6)" } as Record<string, string>,
    tooManyTiles: (count: number, most: number) => `${count} rutor är valda; ett jobb tar högst ${most}. Välj ett delområde eller bocka ur rutor.`,
    start: (count: number, engine: string) => {
      const label = engine === "otidgeo" ? "O-Tid" : "Karttapullautin";
      return count === 1 ? `Kör ${label} på 1 ruta` : `Kör ${label} på ${count} rutor`;
    },
    started: "Jobbet ligger i kön.",
    startedSplit: (parts: number) => `Området är för stort för en körning och har delats i ${parts} etapper. De ligger i kön och körs efter varandra.`,
    jobs: "Jobben",
    status: {
      QUEUED: "Väntar på geo-servern", RUNNING: "Pågår", DONE: "Klart", FAILED: "Misslyckades", CANCELLED: "Avbrutet"
    } as Record<string, string>,
    progress: (step: string, done: number, total: number) => total > 1 ? `${step} (${done} av ${total})` : step,
    queue: (running: number, waiting: number, users: number) => `Just nu: ${running} ${running === 1 ? "körning pågår" : "körningar pågår"}, ${waiting} väntar (${users} användare). Körningarna tas en i taget.`,
    ahead: (count: number) => count === 0 ? "näst på tur" : `${count} före i kön`,
    dwgJob: "DWG-ritning",
    tiles: (count: number) => count === 1 ? "1 ruta" : `${count} rutor`,
    layerAdded: "Bilden är tillagd som underlag.",
    outputs: {
      "kurvor.dxf": "Kurvor", "formlinjer.dxf": "Formlinjer", "branter.dxf": "Branter", "stup.dxf": "Stup", "knollar.dxf": "Knollar",
      "fukt.dxf": "Våtmarker och fuktstråk", "diken.dxf": "Diken ur terrängformen", "spar.dxf": "Släpstigar och spår ur terrängformen", "berg.dxf": "Stenar och berg i dagen", "belagt.dxf": "Belagd yta ur lasern", "vegetation.dxf": "Vegetationsytor", "vatten.geojson": "Sjöar och vatten", "brantlinjer.dxf": "Branter som linjer", "marktacke.geojson": "Lantmäteriets marktäcke", "byggnader.geojson": "Lantmäteriets byggnader", "ritning.geojson": "Ritningen"
    } as Record<string, string>,
    loadBaseMap: "Läs in grundkartan",
    /** Ägaren 2026-11-17: körningens filer som en zip. */
    download: (size: string) => `Ladda ner filerna (zip, ${size} MB)`,
    downloading: (done: number, total: number) => `Hämtar fil ${Math.min(done + 1, total)} av ${total} …`,
    downloadFailed: (name: string) => `${name} gick inte att hämta. Försök igen.`,
    loadStages: (count: number) => `Läs in alla ${count} etapper som en grundkarta`,
    allStages: "alla etapper",
    /** Ägaren 2026-11-14: etapperna läggs ihop till en körning på geo-servern. */
    mergeStages: "Lägg ihop etapperna på servern",
    mergeQueued: "Etapperna läggs ihop på geo-servern. Det tar några minuter; sedan finns en körning i stället för etapperna.",
    mergeBusy: "Etapperna läggs redan ihop, eller är redan ihoplagda.",
    mergedFrom: (count: number) => `Ihoplagd av ${count} etapper`,
    mergingFrom: (count: number) => `Lägger ihop ${count} etapper`,
    /** Statusraden medan kandidater läses in (ägaren 2026-11-12: «nu vet man inte om datorn hängt sig»). */
    steps: {
      fetching: (done: number, total: number) => `Hämtar filer ${done} av ${total} …`,
      reading: (done: number, total: number) => `Läser filer ${done} av ${total} …`,
      merging: "Sätter ihop grundkartan …",
      candidates: "Räknar fram utkastet …"
    },
    osmMissing: "OpenStreetMap gick inte att hämta nu, så stigar, vägar och hus saknas. Hämta dem under Läs in vektorfil eller OpenStreetMap.",
    soilRemoved: (hectares: string) => `Jordartskartan (SGU): ${hectares} ha sankmark togs bort på sand och grus. Det kan stängas av under Fukt med reglage.`,
    clearCuts: (fresh: number, scrub: number, young: number, scanned: string | null) => fresh + scrub + young === 0 ? "Skogsstyrelsen har inga hyggen under 15 år i rutan."
      : `Hyggen från Skogsstyrelsen: ${fresh} färska, ${scrub} med sly och ${young} med ungskog${scanned ? ` (lasern skannades ${scanned}; laserns grönt tas bort i hyggen som är nyare)` : ""}.`,
    extras: { LAND_COVER: "Läs också Lantmäteriets marktäcke (vatten, öppen mark, åker, sankmark)", BUILDINGS: "Läs också Lantmäteriets byggnader", PARCELS: "Läs också Lantmäteriets fastighetsindelning (små fastigheter med hus blir tomter)" } as Record<string, string>,
    baseMap: "Grundkartan",
    load: (label: string) => `Läs in ${label.toLowerCase()} som utkast`,
    loaded: (label: string) => `${label} visas som utkast på kartan. Lägg in det i raden under kartan.`,
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
      SOURCE_REJECTED: "Lantmäteriet godtog inte uppgifterna, eller Laserdata Nedladdning, skog inte är beställd på Geotorget.",
      SOURCE_AREA_TOO_LARGE: "Området är för stort för en sökning. Välj ett delområde.",
      SOURCE_THROTTLED: "För många sökningar den senaste timmen. Försök igen senare.",
      SOURCE_UNAVAILABLE: "Lantmäteriet svarade inte just nu. Försök igen om en stund.",
      GEO_JOB_BUSY: "Du har redan två jobb som väntar eller pågår. Vänta tills något är klart.",
      GEO_JOB_QUOTA: "Månadens kvot av laserrutor är slut för ditt konto.",
      generic: (status: number | string) => `Det gick inte (${status}).`
    }
  }
} as const;
