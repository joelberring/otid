export const checkinHistorySv = {
  title: "Start- och återkomsthistorik",
  timeZone: "Tidszon",
  help: "Serverlagrad journal, senast mottaget först. Osynkade mobiluppgifter kan saknas. Tider visar observation respektive mottagning, inte startstämpling. Högst 25 rader per sida.",
  latest: "Visa senaste journalen", older: "Visa äldre journalrader", empty: "Inga journalförda avprickningar.",
  error: "Journalen kunde inte hämtas. Försök igen.", choose: "Välj deltagare i deltagarlistan.",
  observed: "Observerat", received: "Mottaget", source: "Källa", action: "Uppgift", effect: "Effekt", revision: "Revision",
  roles: { MANAGE_RACE: "Administratör", START_CHECKIN: "Startpersonal", FINISH_FOREST_WATCH: "Målpersonal" },
  states: { UNMARKED: "Okänd start", STARTED: "Startad", REPORTED_NOT_STARTED: "Rapporterad ej startande" },
  returned: "Manuell återkomst: ja", notReturned: "Manuell återkomst: nej",
  effects: { APPLIED: "Tillämpad", UNCHANGED: "Oförändrad", CONFLICT: "Konflikt – inte tillämpad" }, reviewed: "Granskad", reviewReason: "Orsak", reviewedAt: "Granskad",
  reasons: { STALE_ENTRY: "Deltagaren ändrad", STALE_PACKAGE: "Underlaget ändrat", STALE_REVISION: "Nyare avprickning finns",
    DEPENDENCY_CONFLICT: "Tidigare begäran i konflikt", RETURN_ALREADY_REGISTERED: "Återkomst finns", RESULT_CONFLICT: "Motstridigt resultat" }
} as const;
