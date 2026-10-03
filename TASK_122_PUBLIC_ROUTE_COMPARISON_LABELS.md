# TASK122: namn i publik jämförelse av två exakta rutter

Status: implementerad och riktat verifierad enligt ADR-0132.

## Användarvärde

Besökaren ser vem som har den röda respektive blå rutten även när
jämförelselänken öppnas direkt.

## Avgränsning

- Endast redan publika för- och efternamn för de två resultatsidor som
  TASK121 redan har godkänt.
- Ingen ny queryparameter, migration, writer, profil, organisation, resultat-
  eller tidsdata.
- Befintligt svenskt 390px-läge behåller två rutter och gemensamma kontroller.

## Acceptans

1. En godkänd TASK121-jämförelse visar två färgkopplade deltagarnamn från
   samma publika resultathuvuden som ruttgrinden använder.
2. Samma id, saknad release/samtycke, olika historiskt underlag eller felaktig
   request visar inget enskilt namn.
3. Svaret och HTML saknar organisation, interna id:n, hash, WGS84,
   resultat-/start-/tidsdata och nya beständiga val.

## Genomförande

- Den gemensamma publicerade resultathuvudsläsningen lämnar endast aktuellt
  publikt för- och efternamn till TASK121:s redan godkända serverprojektion.
- Jämförelsekontraktets två routeobjekt får vardera ett strikt
  `participant`-objekt med just dessa två fält; organisation och all övrig
  identifierande eller resultatrelaterad data avvisas vid kontraktsgränsen.
- Den kompakta röda/blå SVG-förklaringen använder namnen; den gör inga extra
  läsningar och sparar inga val.
