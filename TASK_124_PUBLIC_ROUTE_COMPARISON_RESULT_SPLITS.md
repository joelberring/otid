# TASK124: publicerade resultatsplits i jämförelse av två rutter

Status: genomförd enligt ADR-0133.

## Användarvärde

Efter tävlingen kan besökaren se de två deltagarnas redan publicerade
sträcktider vid den gemensamma banans kontrollförekomster direkt under
ruttjämförelsen.

## Avgränsning

- Endast TASK121:s två fullt godkända rutter.
- Endast `OK` med komplett befintligt publicerat resultat och splits.
- Kontrollkod, förekomst, sträcktid och ackumulerad tid; kompakt vid 390 px.
- Ingen migration, writer, GPS-passagetid, interpolation, uppspelning,
  massstart, tempo eller analys.

## Acceptans

1. Två OK-rutter med publicerade splits visar samma kontroll-/förekomstordning
   som resultatet med respektive sträck- och ackumulerad tid.
2. MP, DNS, DNF, DSQ, OOC, NT, saknade eller felaktiga splits visar bara ett
   uttryckligt otillgängligt besked; inga fabricerade värden.
3. Kontrakt och DOM läcker inte status, position, tid efter, klass,
   organisation, starttid, interna id:n, hash eller WGS84, och 390 px saknar
   horisontell sidscroll.

## Genomförande

`resultSplits` är en strikt, diskriminerad publik projektion. Application
bygger den endast från ett effektivt `OK`-resultat med befintliga splits och
gör båda sidor otillgängliga om kontroll-/förekomstordningen inte är identisk.
Webbvyn visar då ett tydligt besked i stället för delvis eller fabricerad tid.
Ingen migration eller skrivväg tillkom.
