/** Karta och vägval i arbetsytan (PLAN.md steg 16, ADR-0171). */
export const raceMapSv = {
  title: "Karta och vägval",
  help: "Ladda upp kartan, ange var tre punkter ligger och ladda upp löparnas GPS-rutter (GPX). Vägvalen syns i den publika " +
    "sträcktidsanalysen så fort kartan är georefererad. Rutterna kopplas till sträckorna med stämplingstiderna; bara delen mellan " +
    "start och mål visas.",
  analysisLink: "Visa sträcktidsanalysen",
  loading: "Hämtar karta och rutter…",
  loadFailed: "Karta och rutter kunde inte hämtas.",
  retry: "Försök igen",
  map: {
    heading: "1. Kartbild",
    file: "Kartbild (PNG eller JPEG, högst 30 MB)",
    fileHelp: "Exportera kartan med banorna från OCAD, Purple Pen eller Condes, eller skanna den.",
    upload: "Ladda upp karta", replace: "Byt karta", remove: "Ta bort kartan",
    current: (fileName: string, width: number, height: number) => `${fileName} · ${width} × ${height} px`,
    georeferenced: "Georefererad", notGeoreferenced: "Inte georefererad än",
    saved: "Kartan är uppladdad. Ange de tre punkterna nedan.",
    removed: "Kartan är borttagen. Rutterna finns kvar men visas inte förrän en ny karta är georefererad.",
    chooseFile: "Välj en bild först.",
    tooLarge: "Bilden är större än 30 MB.",
    invalid: "Filen är inte en PNG- eller JPEG-bild.",
    failed: "Kartan kunde inte sparas."
  },
  georeference: {
    heading: "2. Georeferens",
    help: "Välj en punkt, klicka på kartan där du vet var den ligger (t.ex. en vägkorsning eller ett hörn på kartan) och skriv in " +
      "koordinaten. Koordinaten kan kopieras från en webbkarta, t.ex. genom att högerklicka i Google Maps. Välj punkter långt " +
      "ifrån varandra och inte på en rak linje.",
    point: (index: number) => `Punkt ${index + 1}`,
    choose: (index: number) => `Placera punkt ${index + 1} på kartan`,
    pixelX: "x (px)", pixelY: "y (px)",
    coordinate: "Koordinat (lat, lon)",
    coordinatePlaceholder: "59.33012, 18.06021",
    mapImage: "Kartan. Klicka för att placera den valda punkten.",
    save: "Spara georeferens",
    saved: "Georeferensen är sparad. Vägvalen syns nu i sträcktidsanalysen.",
    incomplete: "Placera alla tre punkterna och skriv in koordinaterna (latitud, longitud).",
    invalid: "Punkterna går inte att använda. Välj tre punkter som inte ligger på en rak linje och kontrollera koordinaterna.",
    failed: "Georeferensen kunde inte sparas.",
    imageFailed: "Kartbilden kunde inte visas."
  },
  routes: {
    heading: "3. Rutter",
    help: "Välj löparen och GPX-filen från klockan eller appen (Garmin, Strava, Suunto m.fl.). En ny fil ersätter den förra.",
    runner: "Löpare", chooseRunner: "Välj löpare",
    file: "GPX-fil",
    upload: "Ladda upp rutt",
    saved: (name: string, covered: number, legs: number) => legs === 0
      ? `Rutten för ${name} är sparad. Den kopplas till sträckorna när löparen har ett resultat.`
      : `Rutten för ${name} är sparad och täcker ${covered} av ${legs} sträckor.`,
    chooseBoth: "Välj löpare och GPX-fil.",
    invalid: "Filen är ingen GPX-rutt som går att läsa.",
    noTimes: "Rutten saknar tider. Ladda upp GPX-filen från klockan eller appen, inte en ritad rutt.",
    notIndividual: "Rutter går bara att ladda upp för individuella löpare, inte stafettlöpare.",
    failed: "Rutten kunde inte sparas.",
    removed: "Rutten är borttagen.",
    none: "Inga rutter uppladdade än.",
    table: "Uppladdade rutter",
    columns: { runner: "Löpare", className: "Klass", file: "Fil", covered: "Täcker", actions: "Åtgärd" },
    covered: (covered: number, legs: number) => legs === 0 ? "Inget resultat än" : `${covered} av ${legs} sträckor`,
    remove: "Ta bort",
    removeLabel: (name: string) => `Ta bort rutten för ${name}`,
    noMapYet: "Rutterna visas när kartan är uppladdad och georefererad."
  }
} as const;
