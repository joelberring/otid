# TASK 006T – IOF StartList från explicit publicerad kopia

Status: Klar 2026-09-04; standardgranskning och accepterad ADR-0044 före implementation.

Berör packages/iof-xml, application, contracts, database/migration, web och
fokuserade tester. Ingen startlottning, Eventoruppladdning, ny publiceringstyp,
resultat-, stations-, hårdvaru-, GPS- eller stafettfunktion.

Acceptans: deterministisk officiell struktur, escaping/strikta gränser,
FIXED/PUNCH utan fabricerad tid; identiska exportbytes efter senare ändringar;
404 före publicering/efter withdrawal; legacy utan XML kräver ompublicering;
public download utan cookies/cache/privata fält. Migration, PostgreSQL,
routetest och sammanhängande mobil nedladdning ska verifieras. Kör lint,
typecheck, enhetstester och build vid delmålsgränsen.

Verifierat: lint/typecheck/test/build exit 0; 177 filer/1 067 enhetstester,
3 PostgreSQL-scenarier, mobil E2E 1/1 på 16,7 s och två xmllint-valideringar
mot pinnad officiell XSD. Migration 0029 är additiv och lämnar legacy orörd.
Exakta kommandon, avgränsningar och nästa minsta uppgift finns i docs/status.md.
