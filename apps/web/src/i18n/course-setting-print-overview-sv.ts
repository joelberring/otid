/** ADR-0211 beslut 7: översikten och "Skriv ut" på utskriftssidan. */
export const printOverviewSv = {
  heading: (count: number) => `Översikt: ${count} ${count === 1 ? "ark" : "ark"}`,
  help: "Ett kort per ark. Klicka på ett kort för att redigera arket nedanför; markera kort för att använda en mall eller skriva ut bara dem.",
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
  printerHelp: "Ett snabbt utkast på din egen skrivare, med skärmens färger (webbläsarens utskrift).",
  pdf: "Skapa PDF för tryckeriet",
  pdfHelp: "Servern skriver en PDF med kartan som vektorer, dekorfärger och övertryck. Statusen och Ladda ned syns här.",
  editor: "Redigera arket",
  editorHelp: "Markera, dra och ändra direkt på arket. Dubbelklicka på en text för att skriva i den."
} as const;
