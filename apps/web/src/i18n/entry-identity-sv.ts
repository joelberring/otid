export const identitySv = {
  title: "Namn och klubb", back: "Tävlingsöversikt", credential: "Namn- och klubbbehörighet",
  login: "Logga in", logout: "Logga ut", checking: "Kontrollerar behörighet…",
  denied: "Behörighet saknas eller har gått ut. Logga in igen.", error: "Underlaget kunde inte läsas. Försök igen.",
  warning: "Publicerade startlistor och officiella resultatkopior ändras inte. Ingen automatisk omräkning görs.",
  search: "Sök namn, klubb eller klass", clear: "Rensa sökning", entry: "Deltagare", choose: "Välj deltagare",
  given: "Förnamn", family: "Efternamn", organisation: "Klubb", none: "Ingen klubb",
  shown: "Visar", of: "av", version: "Tävlingsversion", noMatches: "Inga deltagare matchar sökningen.",
  help: "Välj deltagaren uttryckligen. Ändrad sökning rensar val och utkast. Tom klubb betyder ingen klubb.",
  linked: "Genväg från deltagarlistan. Kontrollera deltagaren i detta behöriga underlag.", selectLinked: "Välj länkad deltagare",
  inspect: "Granska rättning", confirm: "Bekräfta och spara", cancel: "Avbryt granskning",
  review: "Granska namn och klubb", before: "Före", after: "Efter", invalid: "Ange namn och en faktisk ändring. Klubb får vara högst 200 tecken.",
  retry: "Försök igen med samma begäran", unknown: "Svaret är okänt. Rättningen kan ha sparats. Upprepa samma begäran för säkert besked.",
  saved: "Rättningen är sparad. Publicerade kopior och resultat är oförändrade.",
  conflict: "Underlaget har ändrats eller begäran avvisades. Läs aktuellt underlag och granska på nytt.",
  refresh: "Läs in aktuellt underlag", history: "Rättningshistorik", historyHelp: "Visar endast explicita namn- och klubbrättningar, inte full person- eller resultathistorik.",
  historyEmpty: "Inga explicita rättningar finns för deltagaren.", more: "Läs fler rättningar", historyError: "Historiken kunde inte läsas. Listan kan vara ofullständig.",
  entryVersion: "Deltagarversion", time: "Tid (UTC)", logoutError: "Vyn är låst men serverutloggningen kunde inte bekräftas."
} as const;
