/** ADR-0211 beslut 7: översikten och "Skriv ut" på utskriftssidan. */
export const printOverviewSv = {
  heading: (count: number) => `Översikt: ${count} ${count === 1 ? "ark" : "ark"}`,
  help: "Klicka på ett kort för att redigera arket nedanför, eller markera kort för att skriva ut dem eller ge dem en mall.",
  tools: "Markerade ark",
  markAll: "Markera alla",
  marked: (count: number) => count === 0 ? "Inga markerade" : `${count} markerade`,
  printMarked: "Skriv ut markerade",
  template: "Mall för papperet",
  applyMarked: (count: number) => count === 0 ? "Använd mallen på markerade banor" : `Använd mallen på ${count} ${count === 1 ? "bana" : "banor"}`,
  applyAll: "Använd på alla banor",
  open: (label: string) => `Redigera ${label}`,
  mark: (label: string) => `Markera ${label}`,
  layout: (name: string) => `layout ${name}`,
  follows: (name: string) => `Följer mallen ”${name}”`,
  changed: "Ändrad för banan",
  back: "Baksida",
  warnings: { DESCRIPTION_COVERS_MAP: "Beskrivningen täcker kartan", COURSE_OUTSIDE_FRAME: "Banan går utanför ramen" } as Record<string, string>,
  applied: (count: number, name: string) => `Mallen ”${name}” används nu på ${count} ${count === 1 ? "bana" : "banor"}.`
} as const;

export const printOutputSv = {
  heading: "Skriv ut",
  what: "Vad som skrivs ut",
  printer: "Skriv ut på skrivare",
  printerHelp: "Ett snabbt utkast på din egen skrivare; färgerna är inte tryckkvalitet.",
  pdf: "Skapa PDF för tryckeriet",
  pdfHelp: "Servern skriver en PDF med kartan som vektorer, dekorfärger och övertryck.",
  editor: "Redigera arket",
  /** ADR-0217 fas 3: arken som skrivs ut (papperet redigeras i Layout). */
  preview: "Arken som skrivs ut",
  editorHelp: "Markera, dra och ändra direkt på arket; fälten står bredvid (under arket i telefonen)."
} as const;

/** ADR-0211 tillägg: papperet och kartramen för arket som redigeras (förut i editorns flik Utskrift). */
export const sheetPaperSv = {
  heading: "Papper och kartram",
  help: "Gäller arket som är öppet; ramen visar vad av kartan som kommer med.",
  readOnly: "Du kan se papperet men inte ändra det.",
  paper: "Papper",
  orientation: "Riktning",
  portrait: "Stående",
  landscape: "Liggande",
  margins: "Marginal (mm)",
  scale: (scale: string) => `Skala för banan 1:${scale}.`,
  scaleChange: "Ändra i banans egenskaper",
  /** ADR-0217: ett ark i en annan layout än huvudlayouten har layoutens skala. */
  layoutScale: (scale: string, layout: string) => `Skala för layouten ${layout} 1:${scale}.`,
  layoutScaleChange: "Ändra i layouten",
  area: "Tryckyta",
  automatic: "Automatisk (som Purple Pen)",
  manual: "Fast ram",
  frameEdit: "Flytta ramen på arket",
  reset: "Automatisk igen",
  partReset: "Som banans igen",
  partInherits: "Delen har banans tryckyta tills du ändrar den här.",
  partOwn: "Delen har en egen tryckyta.",
  overlap: "Visa överlapp",
  overlapNone: "Ingen",
  overlapLastLeg: "Sista sträckan",
  overlapPrevious: "Hela föregående del",
  failed: "Det gick inte att spara. Försök igen."
} as const;
