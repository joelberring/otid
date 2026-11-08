/** ADR-0219 K6 (del 1): generaliseringen som förslag. */
export const mapProjectGeneralizeSv = {
  heading: "Generalisering",
  help: "Förenklar linjer och ytor med täta punkter (t.ex. kurvor från Karttapullautin) och tar bort det som är mindre än normen tillåter. "
    + "Inget ändras direkt: ändringarna lämnas som förslag som ägaren godkänner eller avvisar. Kurvor (bågar) lämnas orörda.",
  where: "Område",
  whole: "Hela kartan",
  simplify: "Förenkla med toleransen",
  tolerance: (mm: number) => mm === 0 ? "Förenkla inte" : `${String(mm).replace(".", ",")} mm`,
  removeSmall: "Ta bort små ytor, korta linjer och små knollar",
  preview: "Räkna fram ändringarna",
  computing: "Räknar …",
  summary: (simplified: number, before: number, after: number) => simplified === 0 ? "Inga linjer eller ytor att förenkla."
    : `${simplified} ${simplified === 1 ? "objekt förenklas" : "objekt förenklas"}: ${before} punkter blir ${after}.`,
  removed: (area: number, line: number, closed: number) => area + line + closed === 0 ? "Inget är mindre än normen."
    : `Tas bort: ${area} små ytor, ${line} korta linjer, ${closed} små knollar.`,
  skipped: (count: number) => count === 0 ? "" : `${count} objekt har egna ändringar som inte skickats eller en krock och hoppas över.`,
  propose: (count: number) => count === 1 ? "Lämna 1 ändring som förslag" : `Lämna ${count} ändringar som förslag`,
  sending: (done: number, total: number) => `Skickar förslag ${done} av ${total} …`,
  sent: (count: number) => count === 1 ? "Förslaget är skickat. Ägaren ser det under Förslag." : `${count} förslag är skickade. Ägaren ser dem under Förslag.`,
  note: (mm: number, removeSmall: boolean, part: number, total: number) =>
    `Generalisering${mm > 0 ? `: förenkla ${String(mm).replace(".", ",")} mm` : ""}${removeSmall ? `${mm > 0 ? "," : ":"} ta bort det som är mindre än normen` : ""}`
    + (total > 1 ? ` (del ${part} av ${total})` : ""),
  failed: (status: number | string) => `Förslaget kunde inte skickas (${status}).`
} as const;
