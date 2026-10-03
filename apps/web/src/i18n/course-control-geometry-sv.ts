export const courseControlGeometrySv = {
  title: "Banans kontrollpositioner", intro: "Spara privata pixelpositioner för exakt en banversion och en kalibrerad karta. Detta publicerar inte bana eller rutt.",
  openDetails: "Visa kontrollpositioner och sparade versioner",
  unavailable: "Kontrollpositioner kräver en aktiv tävlingsadministratörssession.", loadError: "Underlaget kunde inte hämtas.", saveError: "Positionerna kunde inte sparas. Kontrollera alla fält och hämta läget igen.",
  noCourse: "Det finns inga banversioner med kontroller ännu.", course: "Bana", map: "Karta", calibration: "Kalibrering", positions: "Kontrollpositioner", pixelX: "Pixel x", pixelY: "Pixel y",
  save: "Spara privat banunderlag", saved: "Privat banunderlag sparat. Ingen bana eller rutt har publicerats.", history: "Sparade banunderlag", none: "Inget banunderlag är sparat ännu.", refresh: "Uppdatera", revision: (value: number) => `Geometri ${value}`
} as const;
