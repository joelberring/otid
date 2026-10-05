/** Rogaining (ADR-0170 beslut 5, PLAN.md steg 15): "Kontroller & poäng" och ny bana med klass i en rogainingtävling. */
const points = (value: number) => `${value} p`;

export const rogainingSv = {
  title: "Kontroller & poäng",
  help: "Löparen stämplar valfria kontroller i valfri ordning inom tidsgränsen. Varje kontroll räknas en gång. " +
    "Poängen är förvald till kontrollkodens tiotal (31 ger 3 p, 45 ger 4 p, 102 ger 10 p) och kan ändras. " +
    "Varje påbörjad minut över tidsgränsen kostar straffpoäng; summan blir aldrig lägre än 0.",
  loading: "Hämtar kontrollerna …",
  noControls: "Inga kontroller ännu",
  noControlsHelp: "Lägg in kontrollkoderna som en bana med klass längre ner på sidan. Ordningen spelar ingen roll.",
  classesTitle: "Tidsgräns och straff per klass",
  className: "Klass",
  timeLimit: "Tidsgräns (min)",
  penalty: "Straff per påbörjad minut",
  timeLimitLabel: (className: string) => `Tidsgräns i minuter för ${className}`,
  penaltyLabel: (className: string) => `Straff per påbörjad minut för ${className}`,
  notRogaining: "Bedöms som vanlig bana tills tidsgränsen är sparad.",
  controlsTitle: "Poäng per kontroll",
  controlLabel: (code: number) => `Poäng för kontroll ${code}`,
  changed: (defaultPoints: number) => `ändrad, förval ${defaultPoints}`,
  preview: "Visa vad som händer",
  save: "Spara poäng och tidsgräns",
  saveConfirmed: "Spara och räkna om",
  reset: "Ångra ändringarna",
  unchanged: "Inget är ändrat.",
  invalid: "Ange hela poäng 0–1000, tidsgräns 1–2880 minuter och straff 0–1000 poäng.",
  missingRules: "Ange både tidsgräns och straff för klassen.",
  nobodyReadOut: "Ingen i de berörda klasserna har läst ut. Ändringen sparas direkt.",
  noResultChange: (count: number) => `${count} ${count === 1 ? "avläst löpare räknas" : "avlästa löpare räknas"} om. Ingen får ändrad status eller summa.`,
  changesTitle: (count: number) => `${count} löpare får ändrat resultat`,
  confirmHelp: "Resultaten räknas om när du sparar. Historiken finns kvar.",
  notRecalculated: (count: number) => `${count} med manuellt rättad tid räknas inte om.`,
  status: { OK: "godkänd", MP: "felstämplad" } as Record<string, string>,
  outcome: (status: string, total: number | undefined) => total === undefined ? status : `${status}, ${points(total)}`,
  saved: (recalculated: number) => recalculated === 0 ? "Poängen och tidsgränsen är sparade."
    : `Poängen och tidsgränsen är sparade. ${recalculated} resultat räknades om.`,
  conflict: "Tävlingen har ändrats under tiden. Kontrollerna är inlästa på nytt; titta på beskedet och spara igen.",
  rejected: "Ändringen kunde inte sparas. Läs in sidan och försök igen.",
  previewError: "Beskedet kunde inte hämtas. Försök igen.",
  unknown: "Svaret kom inte fram. Tryck på Spara igen; samma ändring skickas och sparas bara en gång.",
  savedLoadError: "Ändringen är sparad men kontrollerna kunde inte läsas in igen. Uppdatera sidan.",
  // Ny bana med klass i en rogainingtävling.
  courseTimeLimit: "Tidsgräns (min)",
  coursePenalty: "Straff per påbörjad minut",
  courseControlsHelp: "Kontrollkoderna i valfri ordning, med mellanslag eller komma. Poängen ställs in ovan."
} as const;
