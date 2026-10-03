# ADR-0056: Explicit granskning av motstridiga avprickningsrapporter

- Status: Accepterad; TASK 006W under implementation
- Datum: 2026-09-05
- Kompletterar ADR-0049/0050/0055. Ingen ny teknik, resultatstatus eller domängräns.

## Problem

Mottagna CONFLICT-operationer bevaras i journal och lokal kö. Nuvarande roster
klassar en deltagare med någon sådan historisk rapport som konflikt för alltid,
även efter en korrekt målrättning. Att radera rapporten, ändra kvittensen eller
låta en ny markering tyst avskriva konflikten skulle förstöra spårbarheten.

## Minsta granskningsbeslut

Målpersonal med FINISH_FOREST_WATCH får göra ett separat, explicit onlinebeslut:
KEEP_CURRENT_STATE för ett exakt granskat set av ännu ogranskade konflikter
för en deltagare. Beslutet säger att rapporterna har utretts och att aktuellt
registrerat tillstånd behålls. Det fabricerar inte start, återkomst, DNS eller
resultat och ändrar ingen start-/resultatrevision. Orsak är obligatorisk.

Behöver start/återkomst rättas görs det med befintlig spårbar målkorrektion;
resultatfrågor använder befintliga resultatbeslut. Granskningen får inte dölja
en aktuell motsägelse mellan återkomst, startmarkering och aktiv DNS. Ren
domänplanering kontrollerar detta med samma forest-watch-regel, utan flaggan
för de rapporter som nu granskas. Ett aktuellt CONFLICT-tillstånd avvisas.
STARTED_NO_RETURN och UNCONFIRMED får granskas men ligger fortsatt kvar för
uppföljning. Ett granskningsbeslut är aldrig en garanti att alla är i mål.

## Underlag och samtidighet

Privat läsning visar aktuella fakta samt originaloperation, avsikt, källa,
observation/mottagning och konfliktorsak. Ett canonical sourceHash binder
race-snapshot, entryversion, senaste startrevision, aktuell resultatgrund,
återkomstfakta och exakt set av ogranskade konfliktoperationers id/hash.
Underlaget har max 1 000 konflikter per beslut; överstort underlag avvisas,
inte trunkeras. Inga dolda poster räknas som granskade.

Request binder requestId, entryId, sourceHash, sorterade unika conflictRequestIds,
decision=KEEP_CURRENT_STATE och orsak. FINISH-session/CSRF kontrolleras före
body och under befintliga authlås. Skrivning låser race SHARE, review-request
advisory och entry UPDATE, räknar aktuell grund igen och kräver exakt match.
Ingest och vanliga checkin-skrivningar använder samma entrylås. Ny konflikt
eller ändrat tillstånd under granskningen ger konflikt och ingen journalpost.
Exakt same-request/intent-retry ger samma beslut före ny grundkontroll; ändrat
intent med samma request-id avvisas. Detta är en onlineåtgärd, inte en ny
offlineoperationstyp eller en utökning av recovery-grantets rättigheter.

Gransknings-POST har JSON-gräns 64 KiB för att rymma det uttryckliga setet med
upp till 1 000 UUID. Detta ändrar inte vanliga synkens eller recoverys 4 KiB-
gräns. Privata läs-/skrivsvar är no-store. sourceHash beräknas över ett strikt
canonical källobjekt utan generatedAt/sourceHash; lästid får inte göra ett
i övrigt oförändrat underlag stale vid nästa läsning.

## Journal och projektion

Additiv migration inför immutable review-header och items med scopebundna
FK till exakt originaloperation. Header binder aktör, request, orsak,
sourceHash, beslut och servertid. Items binder varje granskat request-id/hash.
En konfliktoperation kan granskas en gång. Header/items/audit är atomiska.
Audit fryser även det fulla privata source-objekt vars canonical hash granskades,
så att beslutets aktuella fakta och visade identitet kan återskapas även efter
senare namn-/klassändring. Det är historik i privat databas, inte debuglogg.
Rollback är avstängd granskningsväg och bevarade tabeller/rapporter, inte delete.

Roster och kvar-i-skogen-lista använder endast ännu ogranskade rapporter för
conflictingReports. Aktuella motsägelsefulla fakta kan fortfarande ge CONFLICT.
Nya sena rapporter efter ett beslut får ny konflikt och täcks aldrig av ett
tidigare beslut. Historisk kvittens är fortsatt CONFLICT; UI skiljer granskad
historik från olöst konflikt och får inte märka gamla rapporten APPLIED.

För lokal kompatibilitet får nya klienter begära reviewDetails=1 vid roster-
läsning och få optional reviewedConflictRequestIds per entry. Standardroster
utelämnar fältet så äldre strikta klienter kan fortsätta läsa. Nya klienter kan
läsa äldre krypterade roster utan fältet och behandlar då lokal konflikt som
ogranskad. Endast en ny autentiserad rosterhämtning kan uppdatera denna kunskap;
recovery och lokal reset ger ingen rätt att avskriva konflikt. Lokal historik
bevaras och pending-intents ombaseras aldrig automatiskt.

## Acceptans

- Ren planering avvisar stale hash/set och aktuella motsägelser, utan I/O.
- START_CHECKIN och read-only-listbehörighet får inte granska; auth före body.
- Riktig PostgreSQL visar atomiska header/items/audit, immutable original,
  exact retry, ändrat intent-konflikt och kapplöpning med ny rapport/ingest.
- Kvar-i-skogen-listan ändrar bara olöst rapportflagga; omarkerad eller startad
  utan återkomst kräver fortfarande uppföljning. Ny rapport öppnar ny konflikt.
- Browser visar original och aktuell grund, kräver explicit bekräftelse/orsak,
  och döljer persondata vid authfel. Fryst retry hålls endast i minnet.
- Ny mobilroster skiljer granskad historik från olöst konflikt efter reload;
  gammal klient/vault fungerar fortsatt och ingen lokal kvittens ändras.
- Verifiera browser → HTTP → PostgreSQL inklusive privat rapport/utskrift.

ADR är beslut före implementation, inte bevis på genomförd konfliktgranskning.
