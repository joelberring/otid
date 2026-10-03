# ADR-0045: Reproducerbar enkel startlottning för en FIXED-klass

- Status: Accepterad
- Datum: 2026-09-04

## Avgränsning

TASK 006U realiserar CODEX_BRIEF:s enkla startlottning. Arrangören väljer en
befintlig individuell FIXED-klass, första starttid med explicit offset och
startintervall 1–3 600 hela sekunder. Alla aktuella entries i klassen ingår,
även de som redan har en planerad tid. Förhandsgranskningen visar gamla och
nya tider och kräver separat bekräftelse före atomärt sparande. Ingen avancerad
seedning, klubbseparering, reserverade luckor, PUNCH eller lottning över klasser.

Lottning sker inom befintliga domängränser. `packages/domain` får en ren
deterministisk planeringsfunktion, utan slumpkälla, klocka, databas eller UI.
Applikationen läser underlag, tillhandahåller seed och sparar ett explicit
beslut. Inga nya dependencies införs. Ingen extern AGPL-kod används.

## Reproducerbar ordning

Version `xorshift32-fisher-yates-v1` tar ett icke-noll uint32-seed, en unik
uppsättning canonical UUID:n, första startinstant i millisekunder och ett
heltalsintervall i sekunder. IDs sorteras lexikografiskt före Fisher–Yates,
så databasens radordning inte påverkar utfallet. Xorshift32 använder skift
13/17/5 med explicita uint32-operationer. Rejection sampling över generatorns
icke-noll-värden undviker extra modulo-bias i indexvalet. Detta är enkel
reproducerbar pseudoslump, inte kryptografisk eller certifierad tävlingslottning.

En kryptografisk seedkälla hör till applikationslagret, inte domänen.
Algoritmversion och seed visas/sparas med intentet och ändras aldrig tyst vid
retry. Samma seed, deltagaruppsättning och parametrar ger samma plan. Nytt seed
kan ge samma permutation, särskilt för små klasser; unik ordning lovas inte.
Gräns: 1–10 000 deltagare; tidsintervall och sista tid måste ligga inom
ISO-år 0001–9999. Första tidens millisekunder bevaras. Dygnsgräns tillåts.

## Skrivning och säkerhet

Separat racebunden `DRAW_CLASS_START_TIMES` får granska och spara, med eget
credentialprefix/cookies, åtta timmars access/en timmes session. Befintlig
Origin/CSRF och 4 KiB-mutationsgräns används; requesten bär parametrar och
underlagshash, inte klientens fulla deltagarlista. Servern räknar fram planen
igen under lås. Ingen behörighet till resultatmutation följer med.

Intent binder klass, racesnapshot, hash över hela valda roster/entryversioner/
tidigare tider samt algoritm/seed/första tid/intervall. Session → credential →
race UPDATE → request advisory → entries i ID-ordning låses. Exakt retry för
samma actor/request/normaliserade intent returnerar ursprunglig kvittens före
ny underlagskontroll. Ändrad actor, intent, roster, klassregel eller version
konflikterar. Okänt commitsvar ger explicit samma-id-retry i UI.

Ändrade entries får version +1; oförändrade tider/versioner lämnas orörda.
Minst en verklig ändring krävs. Racesnapshot ökar exakt en gång för hela
beslutet. Versionsoverflow, tom/överskriden roster, PUNCH eller stale grund
ger inga writes. Alla utfall (även oförändrade medlemmar) fryses i immutable
beslut/header och items med gamla/nya tider och versioner; audit är atomär.

## Resultat, publicering och offline

Ingen omräkning eller publicering sker automatiskt. Befintliga resultat och
manuella beslut är oförändrade; separat explicit omräkning enligt ADR-0039
krävs där det behövs. Ny snapshot gör gammal finaliseringsgrund stale men
ändrar aldrig fryst XML. TASK 006S/T:s publicerade startlista/XML förblir frysta
tills arrangören publicerar på nytt. Nästa signerade stationspaket bär nya
tider; rådata, gamla paket och kvittenser bevaras.

UI är serverberoende och ingen offlinekö. Granskning visar klass, rosterstorlek,
gamla/nya tider i tävlingens tidszon samt tydlig varning om befintliga tider och
oförändrade resultat/publiceringar. Nätfel före beslut ger ingen implicit write.

## Migration och återställning

Additiv migration 0030 inför capability, auditaktör och immutable header/items.
Ingen bulk-UPDATE får kringgå versionskontroll eller skriva om historik. Vid
incident stängs writer/credential; rättning görs med nya versionsbundna beslut
eller verifierad backuprestore. Ingen destruktiv rollback av journaler/enum.

## Alternativ

Sekventiella anrop till individuell tidsändring avvisas: de skulle kunna lämna
en halv klass sparad. Slump i React eller SQL avvisas eftersom preview och
retry då inte är samma verifierbara domänplan. Avancerade tävlingsregler kräver
ett senare separat snitt; denna funktion marknadsförs inte som sådan lottning.
