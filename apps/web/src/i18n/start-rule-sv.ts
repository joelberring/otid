/**
 * Ett ordval för startsätt (PLAN.md steg 24). Formulär, tabeller, lottning, listor och deltagarkortet hämtar
 * orden härifrån så att samma sak alltid heter samma sak.
 *
 * - Fri start: löparen stämplar start (startstämpling).
 * - Minutstart: fast starttid, lottad eller satt för hand.
 * - Masstart: alla i klassen startar samtidigt.
 * - Stafett: Masstart, Växling och Omstart per sträcka.
 */
export const startRuleSv = {
  /** Rubrik för fält och kolumner. */
  label: "Startsätt",
  /** Klassens startsätt som det lagras (PUNCH = fri start, FIXED = fast starttid). */
  rules: { PUNCH: "Fri start", FIXED: "Minutstart" },
  /** En förklaring i en rad, för hjälptexter och väljare. */
  details: {
    PUNCH: "Löparen stämplar start",
    FIXED: "Fast starttid, lottad eller satt",
    MASS: "Alla i klassen startar samtidigt"
  },
  /** Lottningens val. */
  methods: { FREE: "Fri start", MINUTE: "Minutstart", MASS: "Masstart" },
  /** Stafettens startsätt per sträcka. */
  relay: { MASS_START: "Masstart", CHANGEOVER: "Växling", RESTART: "Omstart" },
  startTime: "Starttid",
  noStartTime: "Ingen starttid",
  noStartTimeYet: "Lottas senare"
} as const;

export type ClassStartRule = keyof typeof startRuleSv.rules;
export type DrawMethod = keyof typeof startRuleSv.methods;
export type RelayLegMethod = keyof typeof startRuleSv.relay;
