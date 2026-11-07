import { plural } from "./plural";
/** Gafflingar (ADR-0169 beslut 2): banvarianter, löparens variant och fördelning. */
export const courseVariantsSv = {
  forked: (count: number) => count === 1 ? "Gafflad (1 variant)" : `Gafflad (${count} varianter)`,
  showVariants: (count: number) => count === 1 ? "Visa varianten" : `Visa ${count} varianter`,
  variant: "Variant",
  variantColumn: "Variant",
  variantControls: "Kontroller",
  variantRunners: "Anmälda",
  variantReadOut: "Avlästa",
  editVariant: "Redigera",
  editVariantLabel: (course: string, code: string) => `Redigera variant ${code} på ${course}`,
  editingVariant: (code: string) => `Variant ${code}`,
  variantSummaryNote: "Beskedet gäller löparna på varianten. Alla avlästa på banan räknas om när du sparar.",
  // Klasser
  distribute: "Fördela gafflingar",
  distributeLabel: (className: string) => `Fördela gafflingar i ${className}`,
  missingVariants: (count: number) => `${count} saknar variant`,
  distributed: (count: number) => `${count} löpare fick en variant.`,
  distributeError: "Gafflingarna kunde inte fördelas. Försök igen.",
  distributeConflict: "Tävlingen har ändrats under tiden. Klasserna är inlästa igen; försök en gång till.",
  // Deltagarkortet
  noVariant: "Ingen variant – bedöms mot den variant som stämplingarna passar",
  chooseVariant: "Byt variant",
  variantChanged: (code: string) => `Varianten är ändrad till ${code}.`,
  variantChangedRecalculated: (code: string) => `Varianten är ändrad till ${code}. Resultatet räknades om.`,
  variantConfirmTitle: "Resultatet ändras",
  variantConfirm: "Byt variant",
  variantCancel: "Avbryt",
  variantResultChange: (name: string, before: string, after: string) => `${name}: ${before} → ${after}`,
  variantError: "Varianten kunde inte ändras. Försök igen.",
  variantConflict: "Tävlingen har ändrats under tiden. Deltagaren är inläst igen; välj variant en gång till.",
  // Steg 61: kontroll före tävlingen, en rad per bana.
  readinessOk: (variants: number) => `Klar för start: alla ${variants} varianter har löpare och fördelningen är jämn.`,
  readinessOkUnused: (unused: readonly string[]) =>
    `Klar för start. Färre löpare än varianter, så ${unused.join(", ")} används inte.`,
  readinessLabel: "Före start",
  readinessUnused: (unused: readonly string[]) => unused.length === 1 ? `Variant ${unused[0]} har inga löpare`
    : `Varianterna ${unused.slice(0, 8).join(", ")}${unused.length > 8 ? " …" : ""} har inga löpare`,
  readinessMissing: (className: string, count: number) => count === 1 ? `1 löpare i ${className} saknar variant`
    : `${count} löpare i ${className} saknar variant`,
  readinessUneven: (className: string, point: number, counts: readonly { letters: string; count: number }[]) =>
    `${className}, gaffling ${point}: ${counts.map(row => `${row.letters} ${row.count}`).join(", ")}`,
  readinessTooMany: (count: number) => `${count} varianter – högst 100 går`,
  readinessLetters: "Fler än 26 gafflingsbokstäver",
  // Steg 61: fel karta vid starten.
  wrongMap: (assigned: string, fitting: readonly string[]) =>
    `Felstämplad mot ${assigned}, men stämplingarna passar ${fitting.join(" och ")}. Fick löparen fel karta?`,
  wrongMapShort: (fitting: readonly string[]) => `Fel karta? Passar ${fitting.join(", ")}`,
  // ADR-0198: stämplingarna passar en bortvald variant.
  excludedVariant: (codes: readonly string[]) =>
    `Stämplingarna passar ${codes.join(" och ")}, som är bortvald i banläggningen. Fick löparen fel karta? Rätta status eller variant för hand.`,
  excludedVariantShort: (codes: readonly string[]) => `Bortvald variant? Passar ${codes.join(", ")}`,
  readinessExcluded: (count: number) => `${plural(count, "variant", "varianter")} bortvald${count === 1 ? "" : "a"} i banläggningen`,
  approveOn: (code: string) => `Godkänn på ${code}`,
  approveOnHelp: "Byter löparens variant och räknar om resultatet. Orsaken sparas i historiken.",
  // Startlista, avläsning och resultat
  variantShort: (code: string) => `Variant ${code}`,
  variantGuessed: (code: string) => `Variant ${code} (efter stämplingarna)`,
  importVariants: (variants: number, persons: number | undefined) =>
    `${variants} varianter${persons === undefined ? "" : `, ${persons} löpare fick sin variant`}`
} as const;
