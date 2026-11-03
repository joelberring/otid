import type { ClubMapVersionYearSource } from "@o-tid/contracts";

/** ADR-0210: dubbletter och versioner av klubbarkivets kartor, och "Välj karta från klubbarkivet". */
const percent = (value: number) => `${Math.round(value * 100)} %`;
const versionsText = (count: number) => count === 1 ? "1 version" : `${count} versioner`;

export const clubMapDuplicatesSv = {
  duplicates: {
    title: "Möjliga dubbletter",
    heading: (count: number) => `Möjliga dubbletter (${count})`,
    help: "Kartor som troligen är samma karta under olika namn. Slå ihop dem till en karta med versionerna i årsordning. Inget slås ihop av sig självt.",
    level: { HIGH: "Troligen samma karta", MEDIUM: "Kanske samma" } as const,
    reasons: {
      area: (overlap: number, contained: number) => overlap >= 0.5 || contained < overlap ? `Samma område (${percent(overlap)} överlapp)`
        : `Täcker samma område (${percent(contained)} av den mindre kartan)`,
      SAME_NAME: "Samma namn",
      SIMILAR_NAME: "Liknande namn",
      SAME_EXTENT: "Samma kartyta",
      SAME_SYMBOLS: "Samma symboler",
      SIMILAR_SYMBOLS: "Liknande symboler",
      SAME_SCALE: "Samma skala",
      trainings: (count: number) => count === 1 ? "Används i samma träning" : `Används i samma träningar (${count})`
    },
    unchecked: "Inte kontrollerad än: jämförd på namnet och träningarna.",
    keep: "Behåll namn och uppgifter från",
    include: (name: string) => `Ta med ${name}`,
    merge: "Slå ihop till en karta",
    notSame: "Inte samma karta",
    mergeHelp: "Versionerna flyttas under kartan du behåller och ordnas efter år. Kartfilerna och träningarna ändras inte, och sammanslagningen går att ångra under ”Historik”.",
    merged: (name: string, count: number) => `Kartorna är sammanslagna till ${name} (${versionsText(count)} flyttade).`,
    dismissed: "Kartorna föreslås inte igen.",
    loadFailed: "Förslagen kunde inte hämtas.",
    selection: {
      select: (name: string) => `Markera ${name}`,
      merge: "Slå ihop markerade",
      count: (count: number) => count === 1 ? "1 karta markerad" : `${count} kartor markerade`,
      clear: "Avmarkera",
      title: "Slå ihop markerade kartor"
    },
    extent: {
      ground: (widthM: number, heightM: number) => `${km(widthM)} × ${km(heightM)} km`,
      paper: (widthMm: number, heightMm: number, scale: number) => `${Math.round(widthMm)} × ${Math.round(heightMm)} mm i 1:${scale.toLocaleString("sv-SE")}`,
      none: "Ingen yta än"
    },
    years: (from: number, to: number) => from === to ? String(from) : `${from}–${to}`
  },
  versions: {
    summary: (count: number, years: { from: number; to: number } | null) => years
      ? `${versionsText(count)}, ${years.from === years.to ? years.from : `${years.from}–${years.to}`}` : versionsText(count),
    yearSource: {
      MANUAL: "inskrivet", FILE_NAME: "gissat ur filnamnet", FOLDER: "gissat ur mappens namn", YEAR_FOLDER: "gissat ur årsmappen",
      DATE: "gissat ur versionens datum", UPLOAD: "gissat ur uppladdningen"
    } satisfies Record<ClubMapVersionYearSource, string>,
    edit: "Ändra år och uppgifter",
    editTitle: (fileName: string) => `År och uppgifter: ${fileName}`,
    year: "År",
    yearHelp: "Lämna tomt för att gissa året igen.",
    maker: "Kartritare",
    note: "Anteckning",
    save: "Spara",
    cancel: "Avbryt",
    saved: "Versionen är sparad.",
    copyAll: "Kopiera till alla versioner",
    copyAllTitle: (fileName: string) => `Kopiera från ${fileName} till alla versioner`,
    fromMap: "Från kartan",
    fromMapTitle: (fileName: string) => `Kartritaren från kartan till ${fileName}`,
    fields: { maker: "Kartritare", note: "Anteckning" } as const,
    preview: "Det här ändras:",
    previewLine: (fileName: string, field: string, before: string | null, after: string | null) =>
      `${fileName}: ${field} ${before ?? "–"} → ${after ?? "–"}`,
    nothing: "Inget ändras: versionerna har redan samma uppgifter.",
    confirm: "Kopiera",
    copied: (count: number) => count === 1 ? "1 version är ändrad." : `${count} versioner är ändrade.`,
    makerLabel: (maker: string) => `Kartritare: ${maker}`
  },
  mapInfo: {
    title: "Namn och beskrivning",
    description: "Beskrivning",
    maker: "Kartritare",
    makerHelp: "Gäller kartan. ”Kopiera till alla versioner” sätter den på versionerna.",
    scale: (scale: number) => `1:${scale.toLocaleString("sv-SE")}`
  },
  history: {
    title: "Historik",
    merged: (date: string, names: readonly string[], count: number) => `${date}: ${names.join(", ")} slogs ihop hit (${versionsText(count)}).`,
    undo: "Ångra sammanslagning",
    undone: (date: string) => `Ångrad ${date}.`,
    locked: "Kartan har ändrats sedan dess. Flytta versionerna en och en med ”Flytta versionen till …”.",
    undoDone: "Sammanslagningen är ångrad.",
    conflict: "Kartan har ändrats sedan sammanslagningen och kan inte delas här."
  },
  picker: {
    open: "Välj karta från klubbarkivet",
    close: "Stäng klubbarkivet",
    help: "Kartorna i dina klubbars arkiv. Senaste versionen är förvald; kartans rättigheter följer med till tävlingen.",
    none: "Det finns inga kartor i dina klubbars arkiv.",
    loading: "Hämtar klubbarnas kartor …",
    loadFailed: "Klubbarnas kartor kunde inte hämtas.",
    search: "Sök karta",
    version: "Version",
    versionLabel: (year: number, fileName: string, latest: boolean) => `${year} · ${fileName}${latest ? " (senaste)" : ""}`,
    club: (name: string) => `Klubb: ${name}`,
    use: "Använd kartan",
    useMap: (name: string) => `Använd kartan ${name}`,
    chosen: (name: string, year: number) => `Vald karta: ${name} (${year})`,
    remove: "Ingen karta",
    issues: { EXPIRED: "Avtalet har gått ut", TRAINING_ONLY: "Bara träning", FEE_PER_PRINT: "Avgift per utskrift" } as const,
    trainingOnlyRace: "Kartan får bara användas till träning.",
    working: { reading: "Läser kartan …", drawing: "Ritar kartan …", saving: "Sparar kartan i tävlingen …" } as const,
    saved: (name: string) => `${name} är tävlingens karta.`,
    failed: "Kartan kunde inte sparas i tävlingen. Försök igen eller ladda upp kartfilen.",
    tooLarge: "Kartfilen är större än tävlingens gräns och kan inte bli tävlingens karta än.",
    createLabel: "Karta (valfritt)",
    createHelp: "Välj en karta ur klubbarkivet så öppnas banläggningen med kartan när tävlingen är skapad."
  }
} as const;

function km(meters: number): string {
  return (Math.round(meters / 100) / 10).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
