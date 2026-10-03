# ADR-0134: offentlig fryst vy för fastställda loppsresultat

- Status: Accepterad, implementerad i TASK127
- Datum: 2026-09-21

## Kontext

Den publika resultatlistan visar senast effektiva publicerade
resultatrevision per deltagare. Den är avsiktligt levande och kan ändras när
arrangören rättar resultat. ADR-0028 har redan ett append-only,
runtimevaliderat och hashbundet `RACE`-finaliseringsmanifest, men det används
hittills bara för privat IOF `ResultList status="Complete"`-export.

En eftertävlingslänk till ett fastställt resultat får inte tyst ändras när en
senare revision publiceras. Manifestet innehåller däremot också interna
identiteter, beslutsproveniens, hashvärden och IOF-XML som inte är en lämplig
publik API-respons.

## Beslut

TASK127 inför en skrivfri publik resultatvy med URL-parametern
`finalizationId`. Det ogenomskinliga id:t exponeras endast som URL-parametern;
det ingår inte i den publika payloaden. Vyn läser exakt en `result_finalization` med rätt `raceId`
och `scope = RACE` i ett repeatable-read-snapshot. Både race-id och
finaliserings-id ska vara canonical UUID:n. En `CLASS`-finalisering får aldrig
bli en publik slutresultatlista.

Före projektion validerar servern det sparade race-manifestet och dess
metadata-/hashkoppling enligt ADR-0028, inklusive de frysta Complete-XML-
bytesens hash. Saknat, fel-scopat, fel-race, korrupt eller okänt manifest är
`not-found` eller `conflict`; vyn får aldrig falla tillbaka till
`publicResults`, aktuell roster, aktuell klass/bana eller en senare
resultatrevision.

Den publika DTO:n är ny och strikt. Den får endast innehålla fryst eventnamn,
fryst klassnamn, för- och efternamn, organisation, status, totaltid,
placering, tid efter samt publik tidpunkt då loppet fastställdes. Interna
entry-, revisions-, klassfinaliserings-, besluts-, aktörs-, snapshot- och
hashidentiteter, teknisk proveniens, kontroller/splits, start-/måltider och
Complete-XML lämnar aldrig denna läsväg. Resultatrader sorteras som den
sparade klassprojektionen; de rankas inte om mot live-data.

En senare `RACE`-finalisering är en annan immutable representation med en ny
URL. Äldre länkar läser fortfarande sitt ursprungliga manifest. Systemet
har ingen withdrawal/revocation för finaliseringar: rättning sker framåt med
en ny explicit finalisering enligt ADR-0028. Den levande resultatsidan kan
länka till en bestämd fastställd vy, men den får inte påstå att någon sådan
finns utan ett verifierat manifest.

## Konsekvenser

- Deltagare och publik kan dela en stabil eftertävlingsvy utan att dela det
  bredare IOF-dokumentet eller interna spårbarhetsdata.
- Arrangören behåller möjlighet att göra senare rättningar, men måste
  uttryckligen finalisera ett nytt lopp för att skapa en ny officiell vy.
- Korrupt lagring stänger den publika slutresultatvyn i stället för att visa
  potentiellt avvikande live-data.
- Ingen migration, ny write-capability, GPS-, karta-, rutt-, stafett- eller
  hårdvarufunktion krävs.

## Avvisade alternativ

- En länk som väljer "senaste finalisering" vid varje läsning: en delad
  slutresultatlänk skulle kunna ändra innehåll utan ny URL.
- Att återanvända live-listans API med en `final=true`-flagga: den gör
  livejoins och kan därför skriva om historiskt resultat.
- Att skicka fryst JSON eller Complete-XML direkt: båda innehåller mer
  identitet och proveniens än den publika vyn behöver.
- Att visa en klassfinalisering: den bevisar inte ett komplett lopp.
