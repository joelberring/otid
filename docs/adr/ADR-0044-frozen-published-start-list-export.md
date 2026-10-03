# ADR-0044: Fryst IOF StartList vid explicit publicering

- Status: Accepterad
- Datum: 2026-09-04

## Problem

TASK 006S sparar displayName, inte separata för-/efternamn. Att dela strängen
eller återläsa dagens entry vid export skulle fabricera namn eller ändra en
redan publicerad kopia. Export ska heller inte exponera bricknummer eller
interna/external person-id:n som inte ingick i publiceringsbeslutet.

## Beslut

TASK 006T fryser IOF StartList-bytes i en separat nullable textkolumn på den
immutable start_list_publication-raden vid nya PUBLISH. XML bygger på samma
race-låsta underlag och strukturerade namn som webbprojektionen. SourceHash
binder även exportprojektionen och formatversionen, inte bara displayName.
Ingen ny beslutstyp, capability, domänmotor eller dependency införs.

Public export läser endast senaste beslutets frysta bytes. Opublicerad eller
avpublicerad lista ger 404 utan persondata. Äldre publicering utan XML ger
409; ingen backfill eller namnheuristik. Ny explicit publicering krävs.
Withdrawal och replay förblir oberoende av dagens underlag. Public GET är
read-only, no-store och cookie-fri; inga historiska export-URL:er införs.

Pinnad XSD granskad: StartList har ingen status. Root får namnrymd, iofVersion
och creator; Event/Name följs av ClassStart/Class/Name och individuella
PersonStart. Person/Name kräver Family före Given. Valfri Organisation/Name
skrivs endast när den finns i publicerat underlag. Varje PersonStart får ett
obligatoriskt Start, även när StartTime saknas. FIXED med känd tid skriver
UTC-normaliserad StartTime; annars tomt Start. PUNCH har aldrig fabricerad tid.
Inget Event/Status, Event/StartTime, Race, raceNumber, kurs, bricka eller id.

Exporten avser exakt det publicerade loppet; dess namn/datum finns i webblistan
och nedladdningskontexten, men gissas inte in som externa IOF-identiteter.
Det är ett individuellt single-race-dokument, aldrig en sammanfogad etapptävling.
Ingen resultatslutstatus påstås. Totalt 1–10 000 starter och högst 1 000 klasser.
Ordningen är samma deterministiska klass-/tid-/namn-/id-ordning som webbkopian;
sorterings-id:n strippas före exportprojektionen.

Publik JSON får iofExportAvailable (false för äldre rader), så webben kan visa
nedladdningslänk eller förklara att ny publicering behövs. Inga strukturerade
personfält läggs till i publik JSON. Hashformat 2 binder `{formatVersion:2,
snapshotVersion,content,iofProjection}`. Gamla intents kan fortfarande replayas
exakt före ny projektion; gammal historik och dess hash ändras aldrig.

## Migration och återställning

Additiv migration 0029 lägger till nullable exportkolumn; gamla rader lämnas
oförändrade. Befintlig immutable-trigger skyddar även kolumnen. Vid rollback
stängs export/writer och kompatibel tidigare läsning behålls; ingen radering
av publiceringshistorik eller backfill. Backuprestore måste separat verifieras
inför produktion.
