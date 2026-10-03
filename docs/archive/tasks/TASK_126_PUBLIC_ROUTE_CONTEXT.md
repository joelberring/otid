# TASK126: deltagar- och tävlingskontext i publik ruttvy

Status: genomförd. Ingen ADR krävs eftersom detta endast
renderar den befintliga publika resultatprojektionen på den redan publika
ruttsidan; ruttens DTO, releasegrind och URL ändras inte.

## Användarvärde

En direkt delad ruttlänk ska tydligt säga vilken deltagare och tävling rutten
hör till. Besökaren ska inte behöva öppna resultatsidan enbart för att få
sammanhang.

## Avgränsning

- Endast redan publikt för- och efternamn, klass samt event-/lopptitel.
- Återanvänd befintlig `publicResultDetail` och `publicRaceSummary` i den
  dynamiska serversidan.
- Behåll ruttkomponentens existerande klienthämtning och fail-closed-besked.
- Ingen ny API-respons, migration, writer, release-/samtyckesregel,
  GPS-analys, jämförelse, tidsuppspelning eller OMAP-funktion.

## Acceptans

1. En giltig publik ruttlänk visar deltagarens namn, klass, event och lopp
   före den befintliga ruttvyn.
2. En ogiltig eller opublicerad resultatreferens ger fortsatt Next `notFound`;
   den existerande ruttkomponenten behåller sitt eget otillgänglighetsbesked
   om en route-release saknas eller återtas efter sidrendering.
3. 390 px saknar horisontell sidscroll. Ingen organisation, placering, status,
   sträcktider, intern identitet, hash eller WGS84 läggs till.

## Genomförande

En liten serverrenderad komponent tar uttryckligen bara event, lopp, datum,
namn och klass. Route-sidan gör den befintliga publika resultatuppslagningen
och svarar `notFound` när resultatet inte längre är offentligt; den existerande
klientkomponenten avgör fortfarande själv om den aktuella rutt-releasen kan
visas. Textfält har brytning för smala skärmar.
