# TASK168: återställ filtrerad publik resultatlista

Status: syntetiskt verifierad 2026-09-23. Ingen fysisk mobil- eller
tävlingsacceptans.

## Användarutfall

När en offentlig resultatlista har publicerade rader men aktiv sökning,
klassval eller favorit-/följningsfilter ger noll träffar ska besökaren se ett
begripligt tomläge och kunna återgå till hela listan med ett tryck. Publik
åtkomst kräver fortfarande inget konto.

## Gräns

Ändringen är endast lokalt UI-tillstånd i den befintliga resultatvyn och
svenska texter. Knappen rensar söktext, klass och `favoritesOnly` samtidigt.
Utan aktiva filter visas ingen återställningsknapp. Om serverns publicerade
underlag är tomt behålls dess separata vänteläge. Inga följningar eller
anonyma sparade favoriter raderas.

Ingen ny API-, domän-, data-, behörighets- eller publiceringsregel införs;
ingen ADR behövs. Förändringen får inte användas som bevis för att live-
uppdatering eller publik resultatkedja fungerar i en riktig tävling.

## Riktad acceptans

- Söktext, klass och endast-favoriter räknas som aktiva var för sig;
  blanksteg utan sökterm gör det inte.
- En filtrerad tomlista erbjuder återställning av samtliga tre lokala filter.
- En helt opublicerad lista erbjuder ingen återställning.
- Befintligt resultat- och uppdateringsbeteende består.

## Verifiering

Luna-agenten rapporterade efter sista ändringen: web-Vitest 11/11,
`pnpm --filter @o-tid/web lint` exit 0,
`pnpm --filter @o-tid/web typecheck` exit 0 och
`pnpm --filter @o-tid/web build` exit 0. Riktat prov täcker filterlogik,
tomt publicerat underlag och att samtliga tre återställningar finns i
komponenten; ingen interaktiv fysisk mobilkontroll utfördes.
