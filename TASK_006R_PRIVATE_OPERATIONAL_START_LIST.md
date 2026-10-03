# TASK 006R – privat operativ startlista

Status: Genomförd och verifierad 2026-09-04. ADR-0042 beslutad före implementation.

Startpersonal kan logga in med separat läsbehörighet, välja klass och se
planerad start, namn, klubb och aktiv bricka. FIXED utan tid, PUNCH och
saknad/dubbelaktiv bricka visas uttryckligt. Det är inte faktisk startstatus.

## Omfattning

Contracts, capability/migration 0027, application-läsare, webbsida/API och
credential-CLI. Inga resultat-/stations-/importändringar eller ny dependency.

## Acceptans

1. Separat racebunden VIEW_START_LIST; privata cookies/no-store och skrivfri GET.
2. Sammanhängande bounded projektion utan rawdata/resultat eller extern identitet.
3. FIXED/PUNCH/saknad tid och aktiv/saknad/dubbelaktiv bricka är sanningsenliga.
4. Tävlingens tidszon, datum, UTC-offset och eventuell millisekund bevaras i UI.
5. Mobilkontroller minst 52 px, klassfilter, uppdatering, tydligt gammal lista
   vid nätfel, inga personuppgifter efter authfel/logout eller i Web Storage.

Verifiera kontrakt/tidsvisning/routesskydd, ett fåtal PostgreSQL-scenarier och
ett riktat webbläsarflöde. Kör lint, typecheck, test och build vid delmålsgränsen.

Verifierat: lint/typecheck/build exit 0, 1 047 enhetstester, 2 riktade
PostgreSQL-scenarier och 1 Playwrightflöde godkända. Se docs/status.md för
exakta kommandon, rättade kontrollfel och kvarvarande antaganden.
