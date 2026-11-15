/** Papperets QR-kod (ägaren 2026-11-16): vart den leder, storleken, texten under och varningarna. */
export const paperQrSv = {
  target: "Leder till",
  targets: {
    RACE: "Tävlingens sida",
    BINGO: "Bingo/Sänka skepp: anmäl dig",
    OTID: "O-Tid",
    CUSTOM: "Egen adress"
  } as Record<string, string>,
  url: "Adress (https://…)",
  urlInvalid: "Adressen måste börja med https:// och får inte innehålla mellanslag.",
  size: "Storlek (mm)",
  caption: "Text under koden",
  captions: { AUTO: "Adressen", OWN: "Egen text", NONE: "Ingen text" } as Record<string, string>,
  captionText: "Texten",
  address: (address: string) => `Koden leder till ${address}.`,
  help: "Koden ritas som svarta rutor på vit botten och blir skarp i tryck. Skanna gärna en provutskrift med telefonen.",
  notPublished: "Tävlingen är inte publicerad – länken fungerar först när den är det.",
  bingoOff: "Bingon med telefonen är inte på för tävlingen. Koden visas som en ruta tills den är det.",
  unknown: "Tävlingens adress är inte känd här. Koden visas som en ruta."
};
