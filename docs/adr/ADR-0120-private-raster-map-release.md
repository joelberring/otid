# ADR-0120: privat rasterkarta och explicit kartsläpp

- Status: Implementerad i TASK106
- Datum: 2026-09-20

## Kontext

Produktbriefen kräver kartsläpp i V1 och en egen kart-/ruttmodul i V2. Alla
kartor ska vara privata tills en uttrycklig publiceringsregel tillåter läsning.
Projektet har en färdig PM-PDF-grund, men ADR-0061 begränsar den medvetet till
PDF, `MANAGE_PM_DOCUMENT`, PM-prefix och dokumentnedladdning; den får inte
återanvändas som ett oavsiktligt generellt fil- eller kart-API. Det finns
ingen befintlig karttabell, renderer eller publik maphämtning.

Den bifogade `.omap`-filen visar att arrangörer kan ha källformat som inte
webbläsaren kan visa. Att publicera den som om den vore en kartbild skulle ge
en trasig användarupplevelse och otydlig åtkomst till en privat källfil.

## Beslut

TASK106 introducerar en separat race-scopad kartassetgräns. Första snittet
accepterar endast renderbara rasterbilder, exakt `image/png` eller
`image/jpeg`; SVG, PDF, OMAP, GeoTIFF och godtyckliga filer avvisas. Varje
godkänd asset binds till en immutable manifestrad med servervald privat
objektnyckel, exakt objektversion, SHA-256, byte-längd, mediatyp, race och
uploadförsök. Det finns ingen "latest"-läsning från objektlagret.

Uppladdning och kartsläpp kräver befintlig `MANAGE_RACE` i race-bunden
administratörssession. Detta följer den gemensamma tävlingsadministratörens
uppdrag och inför inte en extra operatörsroll enbart för kartsläpp. Request-id
binds till aktör, race och canonical intent; samma request är exakt retry,
annan aktör eller intent konflikterar. Data- och objektcommit hanteras som två
steg med privat orphan vid okänt utfall, på samma beprövade princip som PM men
med egna tabeller, kvoter och adapterkontrakt.

Publicering och återtagande är append-only, korta PostgreSQL-transaktioner.
En release fryser exakt assetmanifest och responsiv visningsmetadata. En ny
asset ersätter inte en tidigare release utan skapar en senare release. Publika
resultat- och deltagarsidor får endast veta att en aktuell karta finns och
dess säkra visningsväg; de får aldrig resultatlogik, lagringsid eller hemlig
kartmetadata. Servern läser den exakta privata objektversionen och kontrollerar
aktuell release både före och efter bytesläsning. Ny läsning efter withdrawal
får 404. Svaret använder `nosniff`, inga publika bucket-URL:er och en
cachepolicy som inte delar en återtagen karta mellan användare.

Kartbilden är en visningsresurs, inte geodata. Den har ingen CRS,
georeferering, kontrollposition, bana, deltagaridentitet eller ruttkoppling.
En browservisare får enbart zoom/pan; den får inte härleda koordinater eller
visa GPS. OMAP-källan stannar privat tills en separat, säker och testad
import-/renderingsadapter beslutas.

## Konsekvenser

Kartsläpp blir faktiskt möjligt utan att låtsas att V2:s kart- och
ruttanalys redan finns. Det ger deltagare en enkel länk från resultatet och
en arrangör en explicit, återtagbar publicering.

Den första versionen är medvetet mindre än briefens framtida filformat. PDF
och georefererade format behöver egna säkerhets-, renderer- och
åtkomstbeslut. PM-PDF kan fortsatt utvecklas oberoende. GPX, FIT, TCX,
ruttanalys, uppspelning, banpåtryck och Livelox-kompatibilitet förändras inte.

Vid incident stängs nya routes och visaren. Assetmanifest, releasehistorik och
refererade objektversioner tas inte bort. Återställning måste återställa både
PostgreSQL och objektversionerna; enbart en databasbackup är inte tillräcklig.
