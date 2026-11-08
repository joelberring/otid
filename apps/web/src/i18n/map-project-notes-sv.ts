import { plural } from "./plural";

/** ADR-0219 (K3): notiserna i kartprojektets editor. */
export const mapProjectNotesSv = {
  heading: "Notiser",
  tool: "Notis",
  toolHint: "Tryck på kartan där notisen ska sitta.",
  here: "Notis här",
  new: "Ny notis",
  text: "Vad såg du?",
  placeholder: "T.ex. stigen saknas, stenen är mindre, nytt hygge",
  photo: "Foto",
  photoAdded: "Foto bifogat",
  removePhoto: "Ta bort fotot",
  save: "Spara notisen",
  cancel: "Avbryt",
  close: "Stäng",
  done: "Klar",
  reopen: "Öppna igen",
  remove: "Ta bort",
  removeConfirm: "Ta bort notisen?",
  show: "Visa",
  waiting: "väntar på nät",
  failed: (status: number) => `skickades inte (${status})`,
  by: (name: string | null, date: string) => `${name ?? "Okänd"}, ${date}`,
  open: (count: number) => count === 0 ? "Inga öppna notiser." : `${plural(count, "öppen notis", "öppna notiser")}.`,
  showDone: "Visa klara",
  empty: "Skriv något eller ta ett foto.",
  problem: (status: number) => status === 413 ? "Fotot är för stort." : `Det gick inte (${status}).`
} as const;
