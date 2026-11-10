import type { KeyCommand } from "../lib/map-project-keys";

/** Ägaren 2026-11-10: ritlägets tangenter och verktygen för punkter. */
export const mapProjectKeysSv = {
  open: "Tangenter",
  title: "Tangenter i ritläget",
  help: "Tangenterna ligger under vänster hand, så att höger hand kan stanna på musen. Klicka på en tangent och tryck sedan den nya. Valet sparas i den här webbläsaren.",
  commands: {
    select: "Redigera", draw: "Rita", circle: "Cirkel", note: "Notis", addPoint: "Lägg till punkt", removePoint: "Ta bort punkt",
    switchSymbol: "Byt symbol på det markerade", simplify: "Förenkla", smooth: "Gör mjuk", checked: "Markera kollad",
    undo: "Ångra", redo: "Gör om", wheel: "Verktygshjulet", bare: "Bara kartan"
  } satisfies Record<KeyCommand, string>,
  change: (command: string) => `Byt tangent för ${command}`,
  press: "Tryck en tangent …",
  none: "Ingen",
  space: "Mellanslag",
  fixed: "Fasta: Esc avbryter, Enter avslutar, Delete tar bort, Backsteg tar bort sista punkten medan du ritar, 1–9 väljer de senaste symbolerna.",
  displaced: (command: string, key: string) => `${command} hade ${key} och har nu ingen tangent.`,
  reserved: (key: string) => `${key} används redan till något fast.`,
  reset: "Återställ förvalet",
  wasReset: "Förvalet gäller igen.",
  done: "Klar",
  addPointHint: "Klicka på en linje eller en ytas kant för en ny punkt där.",
  removePointHint: "Klicka på en punkt för att ta bort den.",
  noPointHere: "Ingen punkt att ta bort där.",
  noSegmentHere: "Ingen linje eller kant där."
};
