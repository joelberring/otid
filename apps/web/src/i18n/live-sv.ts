/** Live för publiken (PLAN.md steg 30): senast i mål, ledare per klass, radiopassager och de som besökaren följer. */

/** Placering som svensk ordning: 1:a, 2:a, 3:e … 11:e, 12:e, 21:a, 22:a. */
export function ordinal(place: number): string {
  const lastTwo = place % 100, last = place % 10;
  return `${place}:${(last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12 ? "a" : "e"}`;
}

export const liveSv = {
  title: "Live",
  metaTitle: (event: string) => `Live – ${event}`,
  heading: (race: string) => `${race} · Live`,
  results: "Resultat",
  updated: (time: string) => `Uppdaterad ${time}`,
  offline: (time: string) => `Ingen anslutning just nu – visar läget från ${time}. Sidan försöker igen av sig själv.`,
  empty: "Inga målgångar än – sidan uppdateras av sig själv.",
  emptyHelp: "Här syns de senaste i mål, ledaren i varje klass och passager vid radiokontrollerna.",
  latestTitle: "Senast i mål",
  leadersTitle: "Ledare per klass",
  leadersEmpty: "Ingen godkänd i mål än.",
  newLeader: "Ny ledare",
  radioTitle: "Vid radiokontrollerna",
  radioEmpty: "Ingen har passerat en radiokontroll än.",
  passed: (control: string, time: string | null, place: number | null) =>
    `passerade ${control}${time ? ` ${time}` : ""}${place !== null ? `, ${ordinal(place)}` : ""}`,
  followingTitle: "Följer",
  followingHelp: "Tryck på ☆ vid en löpare för att följa den. Valet sparas bara i den här webbläsaren.",
  notFinished: "Inte i mål än",
  clubNone: (club: string) => `Ingen från ${club} i mål än.`,
  followClub: "Följ en klubb",
  chooseClub: "Välj klubb",
  followClubButton: "Följ",
  clubRegion: (club: string) => `Klubb ${club}`,
  noClub: "Utan klubb",
  arrived: (time: string) => `i mål ${time}`,
  statuses: { OK: "Godkänd", OVERTIME: "Maxtid", MP: "Felstämplad", DSQ: "Disk.", OOC: "Utom tävlan", NT: "Deltog" },
  hubTitle: "Live",
  hubHelp: "Senast i mål, ledare per klass och löpare du följer. Uppdateras av sig själv."
} as const;
