# ADR-0040: Versionsbundet individuellt brickbyte

- Status: Accepterad
- Datum: 2026-09-04

## Beslut

TASK 006P låter en befintlig entry få en ny aktiv bricka genom separat
`CHANGE_ENTRY_CARD`. Ingen efteranmälan, hårdvaruavläsning eller automatisk
omräkning ingår. Befintlig racecredential/session/Origin/CSRF används med
eget prefix `otid_org_entry_card_v1`, egna cookies, högst åtta timmars access,
en timmes session och 4 KiB strikt JSON. Inga dependencies tillkommer.

Requesten binder entryversion, klass, racesnapshot och exakt föregående aktiv
assignment (id och bricknummer), eller null när aktiv koppling saknas. Flera
aktiva kopplingar för samma entry ger konflikt, inte godtyckligt urval.
Nytt bricknummer är en kanonisk positiv decimalsträng med högst 32 siffror;
det är en intern inmatningsregel, inte ett påstående om hårdvarustöd.

En faktisk ändring avaktiverar tidigare assignment och skapar eller aktiverar
en assignment för samma entry. Assignmentens id, race, entry, bricknummer och
createdAt är permanent identitet och får aldrig skrivas om eller raderas.
Befintlig unik race+bricknummer behålls. En bricka som någon gång tillhört en
annan entry i samma race avvisas, även om den är inaktiv. Samma entry får byta
tillbaka till en tidigare egen bricka. Denna begränsning hindrar sena
offlineavläsningar från att hamna på en annan deltagare; återanvändning mellan
deltagare kräver ett separat tids-/proveniensbeslut senare.

Låsordning: session → credential → race UPDATE → request advisory → entry.
Entryversion och snapshot ökar med ett; ändring, immutable journal och
actor-audit committar tillsammans. No-op, stale, upptagen/historiskt annans
bricka och overflow skriver inget. Samma request/actor/hela intent ger exakt
historiskt svar; annan avsikt eller actor ger konflikt även efter senare byte.

## Import och historik

EntryList får skapa den första brickkopplingen för en entry utan tidigare
kopplingar. Med befintliga kopplingar måste filens bricka vara samma enda aktiva
koppling. Annat värde ger atomär importkonflikt och hänvisning till explicit
brickbyte; utelämnat brickfält ändrar inget. Import får aldrig flytta ägarskap,
återaktivera en gammal bricka eller lägga till en andra aktiv bricka. En identisk
redan lagrad fil följer fortsatt content-idempotens och gör ingen ny mutation.

Raw/readout, ingestkvitton, resultatrevisioner, manuella beslut och gamla
Complete-bytes ändras inte. Den separata omräkningen väljer enligt befintlig
policy senaste avläsning för den nya aktiva brickan; en tidigare lagrad okänd
avläsning kan alltså räknas om först efter ett nytt uttryckligt operatörsbeslut.
Finns ingen sådan avläsning visas NO_READOUT, utan fallback till gamla brickan.

## Offline och UI

Nästa signerade paket innehåller nya aktiva/inaktiva kopplingar och ny version.
Gamla paket och outboxposter bevaras. Sen avläsning från avaktiverad bricka
lagras som UNKNOWN_CARD enligt aktuell snapshot, inte som en annan deltagares
resultat. Retry av redan kvitterad råpost behåller ursprungligt ingestutfall.
UI förklarar detta före bekräftelse och håller bara ett minnesburet same-id-
retryintent. Ingen nätbegäran får beskrivas som färdig ändring utan giltigt svar.

## Migration och begränsning

Migration 0025 lägger till capability, actor, immutable brickbytesjournal och
en identitetsskyddande trigger på card_assignment. Den skriver inte om befintliga
kopplingar och försöker inte automatiskt reparera historiskt dubbelaktiva
entries. Vid incident stängs den nya ytan av och en additiv rättning införs,
eller en verifierad backup återställs. Inga journaler/enumvärden droppas.

Ingen ny resultatregel, generell editor, Eventor, stafett, GPS eller riktig USB.
Implementation är självständig utan extern kod eller licensändring.
