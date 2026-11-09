/** ADR-0219 (K3b): kartstatistiken och de frivilliga topplistorna. */
const number = (value: number, digits = 0) => value.toLocaleString("sv-SE", { maximumFractionDigits: digits });
const count = (value: number, one: string, many: string) => `${number(value)} ${value === 1 ? one : many}`;

export const mapStatsSv = {
  title: "Statistik",
  badgesLabel: "Märken",
  mine: "Din kartstatistik",
  myHelp: "Räknas ur det du gjort i kartprojekten. Det Claude föreslog räknas inte som ditt.",
  season: "Säsong",
  allTime: "Allt",
  optIn: "Visa mig i topplistorna",
  optInHelp: "Av från början. Du syns bara i projekt där ägarna slagit på topplistan, och bara för projektets medlemmar.",
  none: "Inget än.",
  numbers: {
    hectares: (value: number) => `${number(value, 1)} ha rekat`,
    km: (value: number, hours: number) => `${number(value, 1)} km i skogen, ${number(hours, 1)} h`,
    checked: (value: number) => count(value, "kollat objekt", "kollade objekt"),
    notesResolved: (value: number) => count(value, "åtgärdad notis", "åtgärdade notiser"),
    deleted: (value: number) => `${count(value, "borttaget", "borttagna")} (generalisering)`,
    added: (value: number) => count(value, "nytt objekt", "nya objekt"),
    changed: (value: number) => count(value, "ändrat objekt", "ändrade objekt"),
    proposalsAccepted: (value: number) => count(value, "godkänt förslag", "godkända förslag"),
    areasDone: (value: number) => count(value, "klart delområde", "klara delområden")
  },
  badges: {
    FIRST_TRACK: "Första rundan", TEN_KM: "En mil i skogen", HUNDRED_KM: "Tio mil", TEN_HECTARES: "Tio hektar", NIGHT: "Nattrekning",
    HUNDRED_CHECKED: "Hundra kollade", TEN_NOTES_RESOLVED: "Kartfelsjägare", AREA_DONE: "Delområde klart", GENERALIZER: "Generaliserare"
  } as Record<string, string>,
  leaderboard: "Topplista",
  leaderboardOff: "Topplistan är av i det här projektet.",
  leaderboardEmpty: "Ingen har valt att synas än.",
  leaderboardSetting: "Topplista i projektet",
  settings: { off: "Av", FIRST: "På, med förnamn", FULL: "På, med hela namnet", NONE: "På, utan namn" },
  sortBy: "Sortera efter",
  sorts: { hectares: "Rekad yta", checked: "Kollade", notesResolved: "Åtgärdade notiser", km: "Km", deleted: "Borttagna", added: "Nya",
    changed: "Ändrade", proposalsAccepted: "Godkända förslag" },
  you: "Du",
  anonymous: (index: number) => `Kartritare ${index}`
} as const;
