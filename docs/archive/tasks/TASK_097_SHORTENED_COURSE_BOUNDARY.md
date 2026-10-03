# TASK097: spärr för avkortad bana i resultatbärande banrättning

Genomförd 2026-09-19. ADR-0113 är skriven före kod.

## Användarvärde

Tävlingsadministratören hindras från att oavsiktligt använda den vanliga
banrättningen som en avkortad bana och därmed skapa en missvisande ranking.
Vyn förklarar kort att avkortning behöver ett separat flöde.

## Avgränsning

- Endast TASK084:s resultatbärande manuella banomlänkning.
- En strikt, icke-tom kortare prefixföljd av aktuell kontrollföljd avvisas
  före write både i klient och server.
- Ingen ny CourseVersion, journal, snapshot, resultatrevision, ranking,
  export, finalisering, migration eller endpoint.
- Ingen faktisk avkortad bana, individuell variant, tidsrättning, GPS,
  karta/rutt, stafett eller riktig USB.

## Acceptans

1. En prefixförkortning på en klass med resultathistorik avvisas och skapar
   ingen ny CourseVersion eller requestjournal.
2. En icke-prefixmässig explicit banrättning behåller TASK084:s befintliga
   funktion och idempotens.
3. Svensk adminvy visar begripligt varför den valda förkortningen inte kan
   sparas.
4. Riktad application- och webbkontroll passerar; ingen bred regression
   ersätts eller påstås körd.

## Verifiering

- Applicationens isolerade PostgreSQL-test för TASK084/TASK097 passerar 3/3.
- Webbens lint och typecheck passerar; prefixpredikatets enhetstest passerar
  1/1.
- Riktat browserprov passerar 1/1 vid 390 px. Det visar den svenska
  förklaringen och verifierar att ingen skrivbegäran, ny CourseVersion eller
  journalpost skapas.
- Webbens produktionsbygge passerar; checkin-skalets hash är
  `54ab19c3278a` och 7/7 statiska sidor genereras.

Ingen bred workspace-regression, fysisk avläsning eller produktionsdatabas har
körts. Det behövs inte för denna rena klient-/transaktionsspärr men återstår
som generell produktionsacceptans.
