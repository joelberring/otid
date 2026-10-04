/** Gafflingar (ADR-0169 beslut 2): banvarianter, löparens variant och fördelning. */
type LegPoint = "START" | "FINISH" | number;

const point = (value: LegPoint) => value === "START" ? "Start" : value === "FINISH" ? "Mål" : String(value);

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
  unevenLegs: (legs: readonly { from: LegPoint; to: LegPoint; variantCodes: readonly string[] }[]) =>
    `Varianterna täcker inte samma sträckor: ${legs.slice(0, 6).map(leg =>
      `${point(leg.from)}–${point(leg.to)} (${[...new Set(leg.variantCodes)].join(", ")})`).join("; ")}${legs.length > 6 ? " …" : ""}`,
  evenLegs: "Alla varianter täcker samma sträckor.",
  // Klasser
  distribute: "Fördela gafflingar",
  distributeLabel: (className: string) => `Fördela gafflingar i ${className}`,
  missingVariants: (count: number) => count === 1 ? "1 saknar variant" : `${count} saknar variant`,
  distributed: (count: number) => count === 1 ? "1 löpare fick en variant." : `${count} löpare fick en variant.`,
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
  // Startlista, avläsning och resultat
  variantShort: (code: string) => `Variant ${code}`,
  variantGuessed: (code: string) => `Variant ${code} (efter stämplingarna)`,
  importVariants: (variants: number, persons: number | undefined) =>
    `${variants} varianter${persons === undefined ? "" : `, ${persons} löpare fick sin variant`}`
} as const;
