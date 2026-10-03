# TASK034: Namn och klubb i gemensam administratörsvy

Status: avgränsat implementerat och verifierat. 28 riktade testfall godkända;
lint, typecheck och build för berörda paket exit 0. Se docs/status.md för
exakta kommandon och återstående produktions-/fysiska antaganden.

## Vertikalt mål

En inloggad tävlingsadministratör väljer en deltagare och rättar förnamn,
efternamn och klubb i samma kompakta arbetsvy som klass/brick/starttid.
Ingen extra funktionsinloggning behövs. Befintlig versionsbunden tjänst och
immutable historik återanvänds enligt ADR-0075, skriven före implementation.

## Berörda delar

- database: migration0045 och motsvarande capability-check i schema.
- application: explicit adminpolicy, verklig journalcapability och audit i
  befintlig entry-identity-tjänst; fokuserade PostgreSQL-regressioner.
- web: identity-candidates/identity i gemensam router, femte åtgärden,
  externa svenska texter, befintlig klientkvittensvalidering.
- contracts: befintliga TASK026-kontrakt återanvänds, inget nytt format planeras.
- docs och befintlig TASK029-browserkedja uppdateras med exakt verifiering.

## Acceptans och avgränsning

Se ADR-0075 för fulla kontroller. Särskilt: riktiga strukturerade namn från
servern, före/eftergranskning, exakt retry efter tappat svar, rätt aktör i
journal/audit och bibehållen FK. Samma session fungerar även efter andra
vardagsändringar. Frysta exporter/resultat ändras inte av textändring.

Kör lint, typecheck, relevanta tester och build. PostgreSQL/browser använder
endast vald isolerad syntetisk testdatabas och körs sekventiellt med andra
writers. Ingen verklig tävling, privat fil eller Eventornyckel behövs.
Rapportera exakta resultat och återstående fysiska/produktionsantaganden.
