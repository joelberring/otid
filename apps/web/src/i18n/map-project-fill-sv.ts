/** Ägaren 2026-11-13: verktyget Fyll yta (rutan mellan kartans linjer fylls med den valda ytsymbolen). */
export const mapProjectFillSv = {
  hint: (code: string, gapM: number) => `Fyll yta: klicka i en ruta som är omgiven av linjer eller ytkanter, så fylls den med ${code}. Glapp upp till ${gapM} m sluts. Släckta lager, höjdkurvor och nordlinjer räknas inte som gräns.`,
  needsArea: "Välj en ytsymbol i listan först: Fyll yta lägger in en yta med den valda symbolen.",
  done: (code: string, squareMeters: string, closed: number) =>
    `Fylld med ${code}: ${squareMeters} m²${closed === 0 ? "" : closed === 1 ? ", ett glapp slöts" : `, ${closed} glapp slöts`}. Ångra tar bort ytan.`,
  notSaved: "Ytan kunde inte läggas in.",
  openGap: (gapM: number, count: number) => count === 1
    ? `Ytan är inte sluten – det finns en öppning större än ${gapM} m (röd på kartan). Rita kanten där och försök igen.`
    : `Ytan är inte sluten – det finns ${count} öppningar större än ${gapM} m (röda på kartan). Rita kanterna där och försök igen.`,
  openFar: (windowM: number) => `Ytan är inte sluten inom ${windowM} m från klicket: en kant saknas eller är släckt, eller så är ytan större än så. Rita kanten som saknas, eller rita ytan för hand.`,
  /** Föreslå ytor (sprintkartor): kandidatytorna i det som syns på skärmen. */
  propose: {
    barLabel: "Föreslå ytor",
    run: "Föreslå ytor",
    runAgain: "Föreslå igen",
    runHelp: (minM2: number, gapM: number) => `Tar fram alla slutna rutor mellan kartans linjer i det som syns på skärmen som ännu inte är fyllda (minst ${minM2} m², glapp upp till ${gapM} m sluts) och föreslår symbol där reglerna vågar: belagd yta för smala rutor mellan kanter, tomtmark för inhägnade rutor med hus. Inget läggs in förrän du klickar.`,
    busy: "Letar efter rutor …",
    summary: (count: number, suggested: number, uncertain: number) =>
      `${count} ${count === 1 ? "ruta" : "rutor"}: ${suggested} med förslag, ${uncertain} ${uncertain === 1 ? "osäker" : "osäkra"}`,
    truncated: (shown: number, found: number) => `Visar de ${shown} närmast mitten av ${found} – zooma in för resten.`,
    none: (filled: number) => filled > 0 ? `Inga ofyllda slutna rutor här (${filled} är redan fyllda).` : "Inga slutna rutor här: linjerna sluter sig inte. Rita kanterna som saknas, eller zooma ut.",
    tooLarge: "För mycket karta på skärmen för att räkna rutorna. Zooma in och försök igen.",
    notSprint: "Föreslå ytor finns bara på sprintkartor.",
    legend: "Fylld ruta = förslag (numret står i rutan), streckad blå = inget förslag, streckad orange = osäker (stor eller med slutet glapp). Klicka på en ruta för att lägga in den.",
    override: (code: string) => `Använd vald symbol (${code}) i stället för förslaget`,
    acceptAll: (count: number) => `Lägg in alla med förslag (${count})`,
    clear: "Rensa",
    added: (code: string, squareMeters: string) => `Inlagd som ${code}: ${squareMeters} m². Ångra tar bort ytan.`,
    addedAll: (count: number) => `${count} ${count === 1 ? "yta" : "ytor"} inlagda med föreslagen symbol. Ångra tar bort alla på en gång.`,
    needsSymbol: "Rutan har inget förslag: välj en ytsymbol i listan och klicka på rutan igen."
  }
};
