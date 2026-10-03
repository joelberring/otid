# ADR-0108: racebunden offentlig identitet för resultatdetalj

- Status: Accepterad för TASK089
- Datum: 2026-09-19

## Kontext

Den publika resultatlistan visar namn, klubb, klass och publicerade
resultatfakta, men saknar medvetet `entryId`, resultatrevisionens UUID,
bricknummer, rådata och audit. Namn kan kollidera och rättas, och interna UUID:n
är inte en offentlig URL- eller kontraktsyta. Därför kan en deltagarspecifik
resultatrapport inte adresseras säkert med befintliga fält.

## Beslut

TASK089 inför en additiv, racebunden och slumpmässigt genererad offentlig
resultatidentitet per Entry. Den är en opaque UUID, separat från interna
primärnycklar och extern Eventor-/IOF-identitet. Identiteten är stabil över
resultatrevisioner samt namn-/klubbrättningar och kan ingå i det publika
listkontraktet som `publicResultId`.

En separat offentlig, race-scopad detaljväg slår upp identiteten och returnerar
endast den befintliga validerade publika resultatraden. Uppslag returnerar inte
data om Entry saknar ett aktuellt publicerat resultat i loppet. Det faller stängt
för fel race, okänd identitet, opublicerad revision och korrupt underlag.
List- och detaljsvar innehåller aldrig intern Entry-/revision-/course-UUID,
bricknummer, readout, råstämpling, audit eller full evaluation.

Detaljvägen utgör ingen behörighetsmekanism: samma resultatfakta syns redan i
den öppna listan. Den stabila opaque identiteten skapar en hållbar länk och
förhindrar att namn eller interna databaskopplingar blir URL-nycklar.

## Gränser

Ingen deltagarinloggning, självbetjänt profil, kontaktuppgift, privat karta,
GPS-rutt, abonnemang, spåranalys eller publicering av opublicerade data ingår.
Den nya identiteten får inte återanvändas som extern importnyckel, auth-token,
stationsidentifierare eller IOF-ID. Den skapar inte en ny resultatrevision.

## Återställning

Migrationen är additiv. En återgång stänger nya listfältet/detaljvägen; den
unika identitetsraden lämnas kvar för att inte felaktigt återanvända gamla
publika länkar. Återställning av produktion följer ordinarie verifierad backup;
det finns ingen destruktiv per-entry-rollback.
