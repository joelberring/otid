/**
 * Förslag B (ägaren 2026-11-18, ADR-0227 tillägg): flikraden nertill för inloggade i telefonbredd. Steg F1: samma fem i datorns
 * vänstermeny och telefonens sidhuvud (bakåtlänken och rubriken).
 */
export const appTabsSv = {
  label: "Huvudmeny",
  tabs: {
    home: "Hem",
    maps: "Kartor",
    courses: "Banor",
    events: "Träningar",
    club: "Klubb"
  },
  /** Rubriken i telefonens sidhuvud där den inte är flikens namn. */
  titles: {
    hub: "Mitt O-Tid",
    account: "Mitt konto",
    superadmin: "Superadmin"
  },
  back: "Tillbaka",
  start: "O-Tid, till startsidan"
} as const;
