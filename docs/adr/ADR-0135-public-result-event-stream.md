# ADR-0135: återanslutningsbar händelseström för levande publikresultat

- Status: Accepterad, implementerad i TASK129
- Datum: 2026-09-22

## Kontext

ADR-0004 valde en femsekunders polling för TASK001:s publika resultatvy och
angav att den inte är dimensionerad för produktionsmålet med många
publikklienter. Arkitekturens och briefens målbild är en nätansluten kanonisk
server, där mobil och dator kan visa resultat när de publiceras, men en
klient måste fortfarande fungera vid tillfällig förbindelseförlust.

En enskild Node-processs minne räcker inte som händelsekälla: en omstart eller
flera webbprocesser skulle då tappa meddelanden. Råa resultatrevisioner och
resultatpayload får inte skickas som pubsub-data, eftersom en publik kanal
inte får bli en andra, mindre kontrollerad resultatläsning eller bära intern
identitet.

## Beslut

TASK129 inför en race-scopad Server-Sent Events-kanal på
`/api/public/races/{raceId}/result-events`. Den är offentlig, skrivfri och
innehåller endast en versionsmärkt uppmaning att uppdatera den befintliga
publika resultatsnapshoten. Resultatdatan hämtas fortfarande enbart från
`/api/public/races/{raceId}/results`, som behåller sin kontrakts- och
integritetsgrind.

När en redan utvärderad publicerad `result_revision` skrivs, skapar en liten
databasteknisk trigger en hållbar race-scopad händelsemarkör och `NOTIFY`:ar
dess sekvens efter samma commit. Triggern utvärderar, publicerar, rankar eller
ändrar aldrig ett resultat; den observerar endast den redan committade raden.
Den hållbara journalen innehåller enbart global monoton `event_sequence`,
`race_id` och tidpunkt. Den är ingen domänjournal och ingen revisionskälla.
En transaktionsscopad advisory lock per race ser till att markörerna för ett
enskilt lopp committas och sänds i stigande ordning även om olika skrivare
försöker publicera samtidigt.

Varje webbprocess `LISTEN`:ar på samma PostgreSQL-kanal. Den läser därefter
händelsemarkören från den hållbara journalen och sänder `refresh` med dess
monotona SSE-id till öppna strömmar för rätt lopp. PostgreSQL-notifieringen är
en väckning, inte sanningskällan. Det gör att flera processer, omstart och ett
temporärt missat notify kan återhämta sig från journalen.

Klienten skickar automatiskt `Last-Event-ID` vid EventSource-återanslutning.
Servern replayar senare markörer i ordning. Om klientens id är äldre än den
begränsade tekniska retentionen, saknas, eller är ogiltigt, sänder servern
`reset`; klienten laddar då en ny snapshot. Dubblett-`refresh` är avsiktligt
ofarlig. En femsekunders polling behålls som reserv om EventSource, proxy,
databaslyssnare eller nät inte fungerar.

SSE-svaret har `text/event-stream`, `no-store` och keep-alive-kommentarer.
Det tar ingen cookie-baserad administratörsbehörighet i anspråk och får inte
cacha personuppgifter. Endpointen validerar canonical UUID för loppet och
`Last-Event-ID` som ett positivt decimal-id inom PostgreSQL `bigint`-området.
En okänd eller icke-kanonisk race-id öppnar inte en ström.

Teknisk retention begränsas till de senaste 1 000 markörerna per lopp. När
gränsen överskrids tas endast äldre tekniska markörer bort; `result_revision`,
audit, rådata och finaliseringar berörs inte. En klient som har hamnat före
denna gräns får alltid `reset`, aldrig en fabricerad historik.

## Konsekvenser

- Mobil- och desktopwebbläsare får normalt uppdateringssignal direkt efter
  den committade publiceringen, medan femsekunders polling fortsätter vara en
  tydlig offline-/proxyreserv.
- Skalan är per aktiv ström, inte per klients kontinuerliga resultatfråga.
  Varje process kan hantera sina egna anslutningar utan Redis eller ny tjänst.
- En publik händelse avslöjar inte deltagare, status, tid, klass, intern UUID,
  rådata eller revisionsinnehåll.
- Markörjournalen och dess trigger är additiva. Vid incident stoppas streamen
  eller webben och klienterna faller tillbaka till polling; rollback är att
  återställa en verifierad databasbackup eller köra en senare explicit
  kontraktionsmigration efter att alla processer slutat använda funktionen.
- En verklig driftacceptans behöver fortfarande verifiera reverse proxy,
  HTTPS, timeout och samtidiga klienter. TASK129 bevisar inte en fysisk mobil
  eller en publik internetdriftsättning.

## Avvisade alternativ

- Bara `NOTIFY` och processminne: saknar replay efter omstart, skalning och
  missad notifiering.
- Att sända publicerade resultatrader i strömmen: duplicerar den publika
  resultatsgrinden och ökar integritets- och cacheytan.
- Att ersätta polling helt: EventSource kan blockeras av nät eller proxy och
  är inte en offlinegaranti.
- Redis eller separat realtime-tjänst: ny driftkomponent för ett enda
  race-scopat wake-up-flöde är oproportionerligt.
