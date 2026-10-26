/** Steg 52 (ADR-0176): banhemlighet i arbetsytan (Publicera). */
export const courseSecrecySv = {
  title: "Banorna publikt",
  help: "Publikt syns gafflingarna, kontrollernas lägen och kontrollkartan först när alla har gått i mål (eller fått ej start eller ett annat beslut), när resultaten är klara eller när du väljer att visa dem. Variantens bokstäver och sträcktiderna syns hela tiden. Du och funktionärerna ser alltid allt.",
  secret: (remaining: number) => remaining === 1
    ? "Banorna är hemliga publikt. 1 löpare har inget resultat än."
    : `Banorna är hemliga publikt. ${remaining} löpare har inget resultat än.`,
  secretEmpty: "Banorna är hemliga publikt. Det finns inga anmälda än.",
  reason: {
    ALL_FINISHED: "Banorna syns publikt: alla har ett resultat.",
    FINALIZED: "Banorna syns publikt: resultaten är klara.",
    REVEALED: "Banorna syns publikt: du har valt att visa dem."
  },
  reveal: "Visa banorna publikt nu",
  withdraw: "Dölj banorna igen",
  withdrawNote: "Banorna döljs igen tills alla har gått i mål eller resultaten är klara.",
  revealedNow: "Banorna syns nu publikt.",
  withdrawnNow: "Ditt val är ångrat.",
  failed: "Det gick inte att ändra. Försök igen."
} as const;
