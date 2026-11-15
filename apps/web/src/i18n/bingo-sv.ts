/** Bingoorientering (ägaren 2026-11-15): rutnätet i banläggningen, löparens sida och ledarens tabell. Enkel svenska. */
export const bingoSv = {
  setup: {
    heading: "Bingo",
    help: "Ett rutnät över skogen. Varje grupp är en egen bana med egen rutstorlek; skriv ut gruppens karta under Utskrift som vanligt. Rutorna följer kartans papper och heter A1, B1 … från övre vänstra hörnet.",
    area: "Området",
    noArea: "Rita området först: klicka två hörn på kartan (eller fler punkter; rektangeln runt dem gäller).",
    areaSize: (width: number, height: number) => `${width} × ${height} m`,
    draw: "Rita området",
    redraw: "Rita om området",
    drawing: (count: number) => count === 0 ? "Klicka ett hörn av området på kartan." : count === 1 ? "Klicka det motsatta hörnet." : `${count} punkter. Klicka Klar.`,
    groups: "Grupper",
    noGroups: "Inga grupper än.",
    name: "Gruppens namn",
    cell: "Rutans sida (m)",
    scale: "Skala",
    mapScale: (scale: string) => `Kartans (${scale})`,
    cells: (count: number) => count === 1 ? "1 ruta" : `${count} rutor`,
    tooMany: "För många rutor: välj större rutor eller ett mindre område.",
    add: "Lägg till grupp",
    open: "Visa",
    remove: "Ta bort",
    suggestedName: (cell: number) => `Rutor ${cell} m`,
    print: "Skriv ut: välj gruppen överst och gå till Utskrift (A4 eller A3, skalan ovan). Rubriken har träningens namn, gruppen och rutstorleken."
  }
};
