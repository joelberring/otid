/** Ägaren 2026-11-15: hela kartan som PDF från kartläget. */
export const mapProjectPrintSv = {
  button: "Skriv ut PDF",
  help: "Hela kartan med sparade ändringar som PDF i kartans skala, på det minsta A-pappret som rymmer den.",
  working: "Gör PDF …",
  ready: (size: string | undefined, landscape: boolean, widthMm: number, heightMm: number) =>
    `PDF:en är klar (${size ? `${size} ${landscape ? "liggande" : "stående"}` : `${widthMm} × ${heightMm} mm`}).`,
  open: "Öppna PDF:en",
  unsaved: "Ändringar som inte sparats än kommer inte med.",
  busy: "Det pågår redan för många kartjobb. Försök igen om en stund.",
  failed: (error: string) => `PDF:en gick inte att göra: ${error}`,
  slow: "PDF:en tar längre tid än väntat. Försök igen om en stund."
};
