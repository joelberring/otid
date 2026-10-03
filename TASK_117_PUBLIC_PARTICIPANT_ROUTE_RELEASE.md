# TASK117: publik deltagarrutt från den publika resultatsidan

Status: implementerad och riktat verifierad.

## Användarvärde

Efter tävlingen kan en publik besökare öppna en deltagares resultatsida och se
en av deltagaren godkänd rutt på den karta och kalibrering som arrangören
uttryckligen har släppt.

## Avgränsning

- En immutable `RELEASE`/`WITHDRAW`-journal för exakt route-, raster- och
  georeferensversion, administrerad av `MANAGE_RACE`.
- Läsbar svensk routevy på befintlig publik deltagarresultatsida vid 390 px.
- Serverhärledda pixelpunkter; exakta kartbytes läses privat via servern.
- Samtyckesåtertagande, kartåtertagande eller felaktig versionsbindning ger
  fail-closed `404` utan publicerings- eller lagringsdetaljer.

## Acceptans

1. Bara en exakt TASK116-godkänd rutt med exakt aktiv TASK106-karta och exakt
   TASK114-georeferens kan släppas.
2. Samma request-id återger samma release/withdraw; ändrad scope eller intent
   konflikterar utan ny journalrad.
3. Publik läsning är skrivfri och lämnar aldrig WGS84, intern identifierare,
   hash eller objektlagerfält till browsern.
4. Återtaget samtycke, återtagen/ersatt karta och withdrawal gör den publika
   participant-ruttvägen otillgänglig för nya läsningar.
5. Browserprovet är kompakt vid 390 px, använder enbart syntetiska data och
   provar både tillgänglig och stängd väg.

## Utanför uppgiften

Flera rutter, jämförelse, uppspelning, kontrollanalys, höjd/tempo, GPS-live,
mobilinspelning, FIT/TCX, OMAP, privata ledargrupper, deltagarinloggning,
stafett och hårdvara.
