# ADR-0142: racebunden återanvändning av registrerat återlämnad hyrbricka

- Status: Accepterad för TASK143
- Datum: 2026-09-22

## Kontext

TASK073 och TASK076 kan märka en aktiv brickkoppling som hyrd respektive
återlämnad. De behåller avsiktligt samma `card_assignment` aktiv, eftersom den
behövs för den deltagarens resultat- och läshistorik. Därmed kan en administratör
se att en hyrbricka är återlämnad, men kan inte ge den till nästa deltagare:
`card_assignment` har en racebunden unikhet för bricknumret och dess `entry_id`
är en immutable del av kopplingens identitet.

Att skriva över den gamla assignmentens deltagare, nummer eller returstatus
skulle förvanska dess journaler och de komposita främmande nycklar som bevisar
historiska hyr-/returbeslut. En klubbglobal inventariemodell är däremot varken
nödvändig eller lämplig för det praktiska behovet under en enskild tävling:
ge en fysiskt återlämnad hyrbricka till nästa redan skapade deltagare.

## Beslut

1. En återanvändning är en explicit, racebunden `MANAGE_RACE`-åtgärd mellan en
   käll- och en måldeltagare i samma lopp. Den sker endast i den privata
   administratörsvyn med CSRF, canonical idempotency-nyckel och granskning före
   commit; den är inte en automatisk bieffekt av en returmarkering.
2. Källan måste i den transaktionella, aktuella grunden vara en enda aktiv
   assignment med `is_rental = true` och `rental_returned = true`. Målet måste
   vara en annan Entry utan aktiv assignment. Requesten binder båda Entry- och
   klassidentiteterna, båda entryversionerna, källassignmentens id/nummer/
   hyr-/returstatus samt aktuellt race-snapshot. Stale, dubbelt, felriktat eller
   redan använt underlag avvisas utan skrivning.
3. Commit gör endast följande atomiskt: källassignmenten blir inaktiv; en **ny**
   immutable assignment skapas för målet med samma nummer, `is_rental = true`
   och `rental_returned = false`; källa och mål får varsin ny entryversion; race
   får exakt nästa snapshotversion; en immutable återanvändningsjournal och ett
   audit-event sparas. Källassignmentens identitet, hyrstatus och returstatus
   skrivs aldrig om.
4. Databasregeln ändras från unikhet över alla historiska `(race, card number)`
   till högst en **aktiv** koppling per sådant par. Det tillåter bevarad
   historik för samma fysiska bricka, men tillåter aldrig två samtidiga
   deltagare. Det befintliga immutabilitetsskyddet för assignmentidentitet
   behålls.
5. Den vanliga direktanmälan fortsätter att avvisa varje redan historiskt känt
   bricknummer. Det vanliga brickbytesflödet får inte ta över en tidigare
   assignment från en annan Entry när flera historiska rader nu kan finnas.
   Återanvändning över deltagargränsen går enbart genom denna journalförda väg.
6. Åtgärden skapar ingen CardReadout, ingen ResultRevision, ingen automatisk
   omräkning, ingen ändring av råbytes, tidigare export/finalisering eller
   betalstatus. Nästa signerade stationspaket kan däremot bära den nya aktiva
   brickkopplingen genom det vanliga ökade race-snapshotet.
7. Det finns ingen klubbglobal brickpool, reservation, deposition, betalning,
   fysisk skanning eller hårdvarupåstående. "Tillgänglig" betyder endast att
   denna tävling just nu har en uttryckligt återlämnad hyrassignment enligt
   ovan; det är inte ett inventeringsbevis.

## Databas och återställning

Migrationen är additiv ur dataperspektiv: den behåller alla assignmenter och
journaler, ersätter den gamla fulla unikheten med ett partiellt unikt index för
aktiva kopplingar och lägger en ny immutable, racebunden reuse-journal med
scope-, actor-, assignment- och versions-FK. Före migrationen kan inga
historiska dubletter finnas, så den partiella unikheten kan införas utan
datatolkning eller automatisk rättning.

Vid incident stängs reuse-routen och kontrollen i administratörsvyn. Droppa
inte index, journal eller gamla assignmenter i en databas med data. Rätta
framåt med en ny explicit operation/additiv migration eller återställ en
verifierad full PostgreSQL-backup.

## Konsekvenser

- Målpersonalen kan först registrera en deltagare utan bricka och därefter ge
  personen en synligt återlämnad hyrbricka utan att förstöra den förra
  deltagarens historik.
- En ny användning börjar alltid som ej återlämnad och hamnar därför åter i den
  befintliga listan över hyrbrickor att få tillbaka.
- Källans och målets rosterunderlag blir versionsstyrt och stationen behöver
  hämta ett nytt paket innan ändringen används lokalt.
- Lagerstatus över flera lopp, avgift/deposition, automatisk kortidentifiering,
  start-/målhårdvara, Eventor och stafett kräver separata framtida beslut.

## Avvisade alternativ

- Flytta den gamla assignmentens `entry_id`: bryter immutable identitet och
  historiska FK-bevis.
- Nollställa `rental_returned` på den gamla raden: gör ett verkligt
  retur-/utlåningsförlopp otydligt och ändrar historik.
- Göra varje inaktiv bricka fritt återanvändbar: låter personliga brickor och
  gamla deltagarkopplingar övergå till en annan deltagare utan uttryckligt
  uthyrningsbeslut.
- Införa central klubb-inventering: betydligt bredare än en säker återanvändning
  inom ett lopp.
