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
  openFar: (windowM: number) => `Ytan är inte sluten inom ${windowM} m från klicket: en kant saknas eller är släckt, eller så är ytan större än så. Rita kanten som saknas, eller rita ytan för hand.`
};
