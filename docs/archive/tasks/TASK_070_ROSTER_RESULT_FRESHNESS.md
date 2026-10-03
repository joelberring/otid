# TASK070: äldre resultat i administratörens deltagarlista

Implementerad och riktat verifierad 2026-09-18 som nästa minsta vertikala
snitt efter TASK069. Ingen produktionsdriftsättning ingår. Se ADR-0099.

## Användarvärde

Administratören ska kunna se vilka deltagare som har ett gällande resultat
från en äldre tävlingsversion direkt i den kompakta deltagarlistan, utan att
öppna varje deltagare.

## Avgränsning

- Servern härleder fyra explicita freshness-lägen enligt ADR-0099.
- Endast `OLDER_SNAPSHOT` visas med texten "Äldre resultat"; färg används inte
  ensam.
- Markeringen påverkar inte sortering, sökning, resultat eller skrivflöden.
- Ingen automatisk omräkning och ingen ny genväg tillkommer i detta snitt.
- Ingen migration, ny route, behörighet, offlinekö eller dependency.

## Berörda paket

- `packages/contracts`
- `packages/application`
- `apps/web`
- befintligt riktat TASK065–069-browserfall

## Acceptans

1. Ingen publicerad revision ger `NO_PUBLISHED_RESULT` och ingen badge.
2. Återtaget resultat utan aktivt utfall ger `NO_ACTIVE_RESULT` och ingen
   badge.
3. Aktivt resolverat resultat på aktuell snapshot ger `CURRENT_SNAPSHOT` och
   ingen badge.
4. Aktivt resolverat resultat på äldre snapshot ger `OLDER_SNAPSHOT` och en
   textbunden badge på rätt deltagarrad.
5. Aktivt manuellt beslut resolveras centralt; senaste tekniska/publicerade
   revision får inte ensam styra markeringen.
6. Rosterläsningen gör bulkprojektion i samma snapshot utan HTTP-N+1 och utan
   skrivning.

## Verifieringsplan

Kör riktat kontraktsprov, en namngiven PostgreSQL-integrationsgrupp för de
fyra lägena, web routeprov bara om DTO-genomsläppet behöver ny gren, statisk
kontroll för berörda paket, samma enda TASK070-browserfall och build. Ingen
bred regression.

## Utfall

Kontraktet exponerar de fyra freshness-lägena. Application väljer publicerade
huvuden i bulk och använder den centrala resultathuvudresolvern, så manuella
beslut och återtaganden räknas in innan aktualiteten bestäms. Webbens kompakta
deltagarrad visar endast `OLDER_SNAPSHOT` som textmärket "Äldre resultat".
Ingen ny route, migration, skrivning eller automatisk omräkning tillkom.

Riktade kontrakts-, PostgreSQL-, browser- och statiska prov samt build är
gröna. Exakta kommandon och resultat finns i `docs/status.md`.
