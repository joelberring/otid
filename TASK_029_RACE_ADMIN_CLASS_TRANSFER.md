# TASK029: Tävlingsadministratör och sammanhängande klassbyte

## Användarbehov

En utsedd administratör ska arbeta i sin tävling med en enda inloggning,
inte separata nycklar för deltagarlista, klassbyte och andra vardagsåtgärder.
Det ska gå att flytta mellan tävlingsklass och öppen klass när plats finns,
med rätt starttid och tydlig resultatpåverkan. Se ADR-0069.

## Avgränsad leverans

1. Explicit racebunden administratör, egen gemensam session och sann aktör i
   journalen. Gamla stations-/start-/begränsade credentials ändrar inte rätt.
2. Samma session för översikt, deltagarlista och klassbyte. Användaren får
   ingen ny funktionsnyckel vid navigation. Detta är första integrationen,
   inte slutlig full funktionsparitet för administratören.
3. Målklass visar startregel och eventuell administrerad platsgräns. Byte
   till FIXED kräver uttryckligt granskad tid; till PUNCH används startstämpel.
   Klass/starttid sparas atomiskt, med historik och exakt retry.
4. Platsgräns gäller registrerade entries i klassen, inte fabricerade lediga
   startluckor. Obegränsad/ej konfigurerad gräns ska framgå. Samtidiga
   anmälningar/klassbyten får inte överboka en satt gräns.
5. Kompakt formulär, resultatpåverkan nära sparknappen, mobilanpassning.
   Befintliga resultat och publicerade dokument skrivs inte över.

Berörda paket: contracts, database (additiva migrationer), application och
web; domain om start-/platsplanering behöver gemensam ren regel.
Ingen ny tjänst, extern authleverantör, AGPL-kod eller dependency.

## Verifiering

- Rollens tillåtna åtgärder och nekad eskalering från befintliga roller.
- Riktig PostgreSQL: issue/login, race-scope, session/CSRF, revocation,
  klassbyte/audit, samma request efter tappat svar och annan aktör nekad.
- Klassbyte i båda riktningar, startregel/tid, full klass och konkurrens om
  sista platsen; rollback lämnar klass, start och historik oförändrade.
- Browser: en inloggning, lista → klassbyte → kvittens, inga extra nycklar;
  fel/logout/expiry och smal/bred layout.
- Riktad lint, typecheck, tester och build. Ingen riktig API-nyckel, privat
  tävling eller manuell demo i automatiska tester.

## Status

Det avgränsade klass-/starttids-/kapacitetsflödet är implementerat och verifierat
2026-09-12 med riktig HTTP/PostgreSQL och browser1366/390. ADR-0070 och
migration0044 tillför deltagartak som även äldre rosterwriters följer.
Gemensam roll och serverläsrätt för översikt/startlista är tidigare verifierade;
äldre funktionssidor har ännu inte anslutits till den gemensamma webbsessionen.
Full administratörsparitet, webbhantering av administratörer, startluckeplanering
och produktions-/fysisk mobilacceptans ingår inte i denna leverans. Exakta
kontroller och kvarvarande antaganden finns i docs/status.md.
