# ADR-0058: Privat speakervy över aktuellt resultat för senaste revisionsunderlag

- Status: Accepterad
- Datum: 2026-09-06

Korrigering: ett PostgreSQL-konkurrensprov 2026-09-06 visade att
nedanstående befintliga authlås inte ensamma räcker i repeatable read när
spärren lagras i separat append-only tabell. Se docs/status.md, TASK008:s
säkerhetsavvikelse. Ingen HTTP/UI-aktivering före korrigerande ADR och gröna
spärr-/logoutprov. ADR-0059 inför nu en separat MVCC-guard och narrow auth-
savepoint; dessa regressioner passerar. Övrigt scope/minimeringsbeslut och
kravet på återstående speakeracceptans är oförändrat.

## Kontext och källor

CODEX_BRIEF 5.7, 13.1 och 21 anger speaker som del av individuell V1.
ADR-0020 begränsar VIEW_RACE_OVERVIEW till PII-fria aggregat. Den får inte
breddas för speaker. ADR-0004 tillåter en första pollingvy men uppfyller inte
slutmålet för SSE/last. `publicResults` i application/results.ts väljer
senaste publicerade revision per entry och använder
`resolveStoredResultHeadStates` innan presentation. Den centrala resolvern
bevarar manuella beslut över senare tekniska revisioner.

En ren feed av CARD_READOUT-revisioner skulle kunna visa tekniskt OK medan
aktuell DSQ eller NT gäller. Finish från card_readout skulle dessutom visa tid
trots aktivt NT. Det vore missvisande som aktuell speakervy. Resultatens
createdAt är databasens registreringstid, inte målögonblick, monoton
händelsesekvens eller bevisad commitordning. Inga sådana påståenden görs.

## Beslut

### Smal behörighet och läsning

Ny racebunden `VIEW_SPEAKER_BOARD`, egen prefix/cookiepolicy, credential högst
åtta timmar och session högst en timme. Befintlig trusted CLI och hash-only
sessionsmodell återanvänds. Inga andra capabilities får implicit åtkomst.
Credential issue/revoke auditeras; GET skriver ingenting.

En skrivfri repeatable-read-transaktion håller session SHARE → credential
SHARE med expiry/revocationkontroll → race SHARE. Samma befintliga authmodell
som privata läsvyer används, med integrationstest för revoke-race. Skrivfri
beskriver use casen, inte PostgreSQL accessMode READ ONLY, som förbjuder dessa
radlås. Databasens ordinarie transaktionsläge behålls.

### Urval och sanning

Välj senaste publicerade revision per entry för rätt lopp. Sortera dessa
valda huvuden på createdAt DESC, id DESC och ta högst 25. Därefter resolveras
hela dessa entries med den befintliga centrala manuella livscykelresolven.
Ingen filtrering av manuella orsaker före huvudval, ingen raw-readout-join och
ingen omräkning/publikationsmutation görs. Ett opublicerat tekniskt huvud får
inte automatiskt publiceras för speaker. Inga nya resultatstatusar införs.

Topplistan begränsar inte livscykelhistoriken. Före central resolution läses
endast ID från de sex beslutssamlingarna DSQ/approval/DNF/OOC/NT/checkin-DNS
för valda entries, med limit 1 001 per samling. Fler än totalt 1 000 beslut
avvisar hela läsningen. Under samma repeatable-read-snapshot begränsar detta
även unika withdrawals och deras refererade revisions-/operationskedjor.
Ingen historik trunkeras för att skapa ett skenbart korrekt resultat.
Gränsen testas vid 1 000/1 001 och ändrar inte vad writers får lagra.

Varje rad anger separat selectedRevision/registeredAt (valt underlag) och
effektiv resultatrevision/status/reason eller NO_ACTIVE_RESULT. Aktiv DSQ,
approval, DNF, OOC och NT behålls över senare teknik. Återtaget DNS kan finnas
som NO_ACTIVE_RESULT i listan; det är inte DNS, ny start eller bevisad återkomst.
Resultatval och strikt provenansvalidering återanvänds, inte ny SQL-affärslogik.

Listan kallas "Senaste resultatunderlag", inte "senaste målgångar" eller
fullständig händelselogg. En withdrawal utan ny resultatrevision kan ändra en
redan synlig rad men flyttar inte in en äldre entry i topplistan. Detta syns i
hjälptexten och täcks av test. Nästa händelsebaserade steg behöver eget
beständigt sekvens-/reconnectbeslut. Ingen ranking härleds ur ett urval på 25.

### Minimerad presentation

Svar format 1 innehåller race, rubrik, tidszon, lästid, snapshotversion,
urvalsbeskrivning och högst 25 rader. Rader har endast löpnummer slot 1–25
inom svaret, utan stabil identitet eller behörighet, aktuellt namn/klubb, aktuell
visningstext för resultatets historiska klass, revisionsmetadata och effektiv
status/reason samt endast tillåten effektiv elapsedMs. NO_ACTIVE_RESULT är en
separat presentationsgren utan status/reason/tid. NT/DNS/DNF saknar tid.

Tidsmatris: OK och MP/MISSING_CONTROL|WRONG_ORDER kräver elapsedMs;
MP/MISSING_START|MISSING_FINISH|INVALID_TIME_ORDER förbjuder den. DSQ och OOC
får endast ha den effektiva revisionens valfria elapsedMs. NT, DNS, DNF och
NO_ACTIVE_RESULT förbjuder den.
Ingen finish- eller starttid ingår. Numeric selectedRevision och effective
revision skiljer valt underlag från äldre aktivt manuellt beslut; inga UUID:n
ingår i dessa fält. NO_ACTIVE_RESULT har ingen effektiv revision. raceId
behålls i svaret för explicit klientkontroll mot begärt scope.

Fältet raceSnapshotVersion är endast tävlingskonfigurationens versionskontext.
Det får inte styra poll-suppression eller anses bevisa oförändrade resultat:
beslut/withdrawal kan ändra resultat utan att ändra racesnapshot. generatedAt
är lästid. Ingen publicResults-wrapper används eftersom den avsiktligt tar
bort NO_ACTIVE_RESULT; dess centrala resolver/strikta parsing återanvänds.
Slot måste vara exakt arrayposition + 1. Application kontrollerar unika entries
före minimering; två personer med samma namn får inte slås ihop. Browsern får
inte koppla bevakning, anteckningar eller mutationer till dessa tillfälliga slots.

Namn/klubb/klassnamn är inte ett historiskt fryst snapshot. Inga interna
entry/readout/revision-id:n, bricknummer, raw, punches, splits, full evaluation,
device, auth, audit eller hash exponeras. Servern får läsa nödvändig strikt
resultatprovenans genom den centrala resolvern men returnerar aldrig den.
Korrupt/saknad provenans avvisar hela projektionen utan persondata i felet.

### Browser och offline

Persondatafritt shell före login; privata svar är no-store. Polling var femte
sekund endast i synlig autentiserad vy, högst ett pågående anrop. Timeout och
abort omfattar även bodyparsning. Ny läsning vid åter synlig flik. Nätfel
behåller endast minnesburet gammalt underlag med tydlig lästid och varning.
Authfel, lokal logout och sessionexpiry döljer persondata omedelbart; sena
svar får inte återvisa dem. Ingen lokal beständighet eller service worker-cache.
Detta är inte stationens offlinekö och förändrar aldrig dess ack/paket/data.

## Migration och återställning

Additiv migration 0036 inför capabilityenum och åttatimmarscheck.
Inget nytt index införs i detta steg. Den faktiska frågan väljer senaste
publicerade huvud med DISTINCT ON(entry_id) före yttre tidsordning/limit.
Produktionslast och eventuell indexoptimering återstår att mäta; limit 25 är
ingen garanti för konstant databasarbete. Inga resultat- eller audittabeller
behöver nya verksamhetsrader.
Enumvärde tas inte bort med destruktiv rollback: stäng routes/utfärdning,
spärra credentials och gör korrigerande migration. Full återställning kräver
verifierad backup. Verklig tävlingsdatabas migreras inte utan separat driftsteg.

## Konsekvenser och avvisade alternativ

- Ingen ny teknik, domängräns, dependency eller extern kod.
- Läsvyn är inte komplett speakerläge och inte produktionsverifierad SSE.
- Bred readout-historikcredential ger fler individ-/kortuppgifter än behövligt.
- Senaste råa OK/MP som aktuellt resultat ignorerar manuella beslut och avvisas.
- Att kalla polling eller createdAt en beständig händelseström avvisas.
- Publik vy eller återbruk av PII-fri overview-capability avvisas.

Acceptanstester och kvarvarande speakerkrav finns i TASK_008.
