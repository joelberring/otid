# TASK065: klassens fria start/minutstart i gemensam admin

Implementerad och riktat verifierad 2026-09-18 enligt ADR-0098. Inte
produktionsdriftsatt eller provad mot en verklig tävling.

Snitt: förhandsgranskning → regelbyte → versionsuppdaterat paket → tydlig
uppföljning för tidstilldelning/omräkning. Berör domain, contracts, database,
application och web. Befintlig klasslista/lottning återanvänds.

Acceptans: byte åt båda håll med deltagare/resultat tillåts; gamla tider
journalförs och töms, no-op behåller dem; främmande klass avvisas; exakt
retry, ändrat underlag och transaktionell rollback; inga nya resultat eller
markeringar; ny snapshot och entryversioner; ett genomgående browserfall.
Riktade tester samt berörda lint/typecheck/build, inte full regression.

Ren ändringsplan, kontrakt, migration0048, förhandsgranskning, serverjournal,
API och den gemensamma adminvyn är införda. Admin ser deltagarantal, befintliga
fasta tider och deltagare med resultat innan ett bekräftat byte. Samma intent
kan skickas om efter tappat svar. Riktade domän-, route-, PostgreSQL- och
browserprov täcker båda riktningar, no-op, retry, befintligt resultat och
transaktionell rollback. Ingen riktig tävling, Eventor, SPORTident-hårdvara
eller produktionsmigration används.
