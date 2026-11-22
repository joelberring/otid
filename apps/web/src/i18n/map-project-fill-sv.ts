/** Ägaren 2026-11-13: verktyget Fyll yta (rutan mellan kartans linjer fylls med den valda ytsymbolen). */
export const mapProjectFillSv = {
  hint: (code: string, baseM: number, gapM: number) => `Fyll yta: klicka i en ruta som är omgiven av linjer eller ytkanter, så fylls den med ${code}. Glapp upp till ${baseM} m sluts${gapM > baseM ? `, och hörn som inte möts och öppningar upp till ${gapM} m (orange streckade); Alt+klick fyller bara exakt` : ""}. Släckta lager, höjdkurvor och nordlinjer räknas inte som gräns.`,
  needsArea: "Välj en ytsymbol i listan först: Fyll yta lägger in en yta med den valda symbolen.",
  done: (code: string, squareMeters: string, closed: number, bridged: string) =>
    `Fylld med ${code}: ${squareMeters} m²${closed === 0 ? "" : closed === 1 ? ", ett glapp slöts" : `, ${closed} glapp slöts`}${bridged ? `, ${bridged}` : ""}. Ångra tar bort ytan.`,
  /** Glappen som slöts utöver grundtoleransen: slaget, antalet och längderna («3,1 m + 2,2 m»). */
  bridged: (kind: "corner" | "extend" | "bridge", count: number, lengths: string) =>
    `${count} ${kind === "corner" ? (count === 1 ? "hörn slutet" : "hörn slutna") : kind === "extend" ? (count === 1 ? "ände förlängd" : "ändar förlängda")
      : (count === 1 ? "öppning överbryggad" : "öppningar överbryggade")} (${lengths})`,
  notSaved: "Ytan kunde inte läggas in.",
  /** K8b V4: dra över flera rutor, reserven, telefonens två tryck och dubblettskyddet. */
  dragHint: "Dra över flera rutor (eller ⇧+klick) för en yta; Esc tömmer.",
  approx: (touch: boolean) => `Ungefärlig yta – ${touch ? "tryck" : "klicka"} igen för att lägga in.`,
  confirm: (code: string, squareMeters: string) => `${code}: ${squareMeters} m² – tryck igen i rutan för att lägga in.`,
  coveredAs: (code: string, key: string) => `Ytan finns redan som ${code} – tryck ${key} för att byta symbol.`,
  alreadyFilled: (code: string) => `Rutan är redan fylld med ${code}.`,
  collecting: (count: number, squareMeters: string, touch: boolean) =>
    `${count} ${count === 1 ? "ruta" : "rutor"} samlade (${squareMeters} m²) – ${touch ? "tryck Lägg in" : "klicka utan Skift för att lägga in"}, Esc tömmer.`,
  merged: (code: string, count: number, squareMeters: string) => `Fylld med ${code}: ${count} ${count === 1 ? "ruta" : "rutor"} som en yta, ${squareMeters} m². Ångra tar bort ytan.`,
  skipped: (open: number, covered: number) => [open ? `${open} ${open === 1 ? "ruta var inte sluten" : "rutor var inte slutna"}` : "",
    covered ? `${covered} redan ${covered === 1 ? "fylld" : "fyllda"}` : ""].filter(Boolean).join(", ") + (open || covered ? " och hoppades över." : ""),
  noCells: "Ingen sluten ruta att lägga in.",
  cellsMode: "+ ruta",
  cellsHelp: "Varje tryck lägger till en ruta (och ett finger som drar samlar rutor); Lägg in fyller dem som en yta.",
  cellsCommit: (count: number) => `Lägg in (${count})`,
  openGap: (gapM: number, count: number) => count === 1
    ? `Ytan är inte sluten – det finns en öppning större än ${gapM} m (röd på kartan). Rita kanten där och försök igen.`
    : `Ytan är inte sluten – det finns ${count} öppningar större än ${gapM} m (röda på kartan). Rita kanterna där och försök igen.`,
  clearedUnder: (count: number) => `${count === 1 ? "Ett objekt" : `${count} objekt`} under ytan (berg, grönt, kärr, stenar eller små landformer) togs bort eller klipptes, som på tomtmark. Ångra tar tillbaka allt.`,
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
