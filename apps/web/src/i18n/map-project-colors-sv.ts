/** Ägaren 2026-11-10: kartans färgtabell i ritläget. */
export const mapProjectColorsSv = {
  open: "Kartans färger",
  title: "Kartans färger",
  help: "Färgtabellen ur kartfilen, i ritordning med den översta först. Ändra en färgs CMYK i procent: kartan ritas om direkt, och färgerna skrivs i nästa kartversion. Kartfilen i arkivet ändras inte.",
  readOnly: "Bara projektets ägare kan ändra färgerna.",
  color: "Färg", c: "C", m: "M", y: "Y", k: "K",
  field: (name: string, part: string) => `${name}, ${part} i procent`,
  changed: "Ändrad",
  spot: "Dekorfärg (ändras i kartprogrammet)",
  reset: (name: string) => `Återställ ${name}`,
  resetAll: "Återställ filens färger",
  save: "Spara",
  cancel: "Avbryt",
  close: "Stäng",
  saved: (count: number) => count === 0 ? "Kartan har filens egna färger." : count === 1 ? "1 färg är ändrad." : `${count} färger är ändrade.`,
  failed: "Färgerna kunde inte sparas. Försök igen.",
  ocad: "Kartan är en OCAD-fil: färgerna visas här, men kan inte skrivas i en ny kartversion än.",
  summary: (count: number) => count === 0 ? "Filens egna färger" : count === 1 ? "1 ändrad färg" : `${count} ändrade färger`
};
