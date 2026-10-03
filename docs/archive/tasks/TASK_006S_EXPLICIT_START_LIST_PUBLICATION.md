# TASK 006S – explicit publicerad startlista

Status: Klar 2026-09-04. ADR-0043 beslutad före implementation.

Arrangören granskar en privat lista och publicerar explicit en fryst kopia för
publik/tävlande. Senare ändringar kräver ny publicering. Avpublicering ingår.

## Omfattning och acceptans

- Contracts, database/migration 0028, application, web/API och credential-CLI.
- Separat PUBLISH_START_LIST, Origin/CSRF och versions-/hashbundet intent.
- Append-only atomiskt beslut/audit med safe retry och konflikter.
- Inga publika bricknummer, interna person-id:n, rådata eller resultat.
- Namn/tid förblir frysta efter ändring; ny publicering byter endast aktiv kopia.
- Före publicering och efter withdrawal får publik GET ingen deltagardata.
- Mobil granskning/bekräftelse, nätfel/samma-id-retry, no-store/polling och
  återtagande utan gammal kvarhängande browserlista.
- Inga stations-/resultatmutationer. Inga nya dependencies.

Verifiera kritiska kontrakt, auth och offentlig projektion, PostgreSQL retry/
konkurrens/fryst historik/withdrawal samt ett sammanhängande webbläsarflöde.
Kör lint, typecheck, test och build vid delmålsgränsen.

## Verifierat

Root lint, typecheck, test och build: exit 0 (CI=true).
Enhetstester: 175 filer, 1 053 tester. Riktad PostgreSQL: 1 fil, 2 sammansatta
scenarier, exit 0; slutlig migration även applicerad på ny tom PostgreSQL 17 /
PostGIS-testdatabas. Playwright TASK 006S: 1/1, 13,5 s, exit 0; mobil skärmbild
inspekterad. Exakta kommandon, första fel och begränsningar i docs/status.md.
