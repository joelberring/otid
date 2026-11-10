/** Ägaren 2026-11-10: utskrifternas PDF:er sparade i träningen. */
export const racePrintFilesSv = {
  heading: "Sparade utskrifter",
  help: "PDF:er som ligger kvar i träningen (tryckjobben ovan rensas efter en vecka). Alla som ser banläggningen kan ladda ner dem, också den som har en uppgift i terminsplanen.",
  none: "Inga sparade utskrifter än.",
  upload: "Ladda upp en PDF",
  uploading: "Laddar upp …",
  download: "Ladda ner",
  remove: "Ta bort",
  removeConfirm: (name: string) => `Ta bort ${name} ur träningen?`,
  saveJob: "Spara i träningen",
  savedJob: "Sparad i träningen under Sparade utskrifter.",
  fromJob: "från PDF för tryck",
  size: (megabytes: string) => `${megabytes} MB`,
  by: (name: string) => `av ${name}`,
  failed: "Det gick inte. Försök igen.",
  tooLarge: (megabytes: number) => `PDF:en är för stor (högst ${megabytes} MB).`,
  notPdf: "Filen är inte en PDF.",
  tooMany: "Träningen har redan så många sparade utskrifter som går (30). Ta bort någon först."
};
