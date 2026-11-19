# ADR-0228: Mastermind med kontroller sparas på servern

- Status: Beslutad och byggd 2026-11-19 (ägaren godkände samma dag). Migration 0131.
- Bygger på: PR #2 (Mastermind med kontroller i ett statiskt skal), ADR-0225 (bingons kö mot servern och topplistan),
  ADR-0172 (publika sidor), ADR-0189 (gallring), ADR-0187 (säkerhetskopian).

## Kontext

Mastermind med kontroller sparade spelen och resultaten bara i webbläsaren (localStorage per träning). En annan dator vid
samma träning såg dem inte, ingen kunde se ställningen, och en tömd webbläsare eller en trasig dator mitt i träningen tog
resultaten med sig.

## Beslut

1. **Webbläsaren först, servern sedan** (som bingon). Datorn spelar och sparar i webbläsaren vid varje ändring med en
   version; en kö skickar hela läget för träningen (inställningarna, alla spel och lagens namn) tills servern har tagit emot
   den senaste versionen. Utan något att skicka hämtar datorn serverns läge var tionde sekund. Spelet fungerar som förut utan
   nät och utan inloggning; sidan säger var resultaten finns.
2. **Skrivningen kräver en roll på tävlingen**: arrangören och funktionären (samma som får öppna spelet), med CSRF som
   avläsningen. Bara en träning (`race_type = 'TRAINING'`). Inga spärrar för publika skrivningar behövs.
3. **Sammanslagning per spel.** Varje spel har ett id från datorn; servern lagrar en rad per tävling + id
   (`mastermind_game`). Det som inte ändras under ett spel (bricka, mönster, inställningar, start) tas från den första
   versionen servern fick. Gissningarna är unionen (samma tid och färger är samma gissning), svaren räknas om ur mönstret,
   gissningar efter den avgörande tas bort och målgången är den avgörande gissningens tid. Den senaste markören (vilka
   stämplingar som är utlästa) gäller. Inställningarna och lagnamnen: det senast ändrade gäller (`mastermind_race`). Reglerna
   är rena funktioner i `@o-tid/domain/mastermind` och körs likadant i webbläsaren och på servern.
4. **Avgjorda spel ligger kvar.** Datorn behåller alla spel i stället för en separat resultatlista; brickans spel just nu är
   det senast startade som inte är avbrutet. Nytt spel markerar ett pågående spel som avbrutet (räknas inte i statistiken);
   ett avgjort spel står kvar. Inloggad kan arrangören och funktionären också avbryta ett pågående spel utan att starta ett
   nytt (Avbryt i resultaten och på spelplanen), också ett från en annan dator; det når den datorn vid nästa sändning. Från en träning finns inte längre "Glöm resultaten" (spelen finns på servern, också andra
   datorers); fristående (`/mastermind/` utan träning) finns den kvar.
5. **Den publika ställningen** på tävlingssidan (`/t/<kod>`) och i `/api/public/races/<id>/mastermind`: bara en publicerad
   träning, bara träningsdagen i tävlingens tidszon (arrangören och funktionären alla dagar) och bara när något spel finns.
   Den visar lagets namn eller brickans tre sista siffror (aldrig hela bricknumret), status, antal gissningar och tid; inga
   mönster och inga gissningar. Uppdateras var 15:e sekund.
6. **Spela på egen dator** (ägaren 2026-11-19). Administratören slår på det i Mastermind (`mastermind_race.open_stations_at`,
   auditpost; av som förval, funktionären ser bara läget). Då visar tävlingssidan under träningsdagen reglerna och knappen
   «Spela på den här datorn», som öppnar spelplanen (`/mastermind/index.html#spela:<id>`) utan inloggning; datorn behöver
   en avläsningsstation. Datorn får en slumpad nyckel (sparad i webbläsaren; servern lagrar bara SHA-256,
   `mastermind_game.station_key_hash`) och skickar till `POST /api/public/races/<id>/mastermind`: bara publicerad träning,
   påslaget och träningsdagen (arrangören och funktionären alla dagar), exakt Origin, spärr per IP (3 000 per 10 minuter) och
   per träning (1 000 nya spel per dygn), fälla mot robotar. Nya spel måste ha träningens inställningar (sidan visar inga
   inställningar), datorn ändrar bara sina egna spel, sätter namn bara på sina egna brickor och får tillbaka bara sina egna
   spel – aldrig andras mönster. Spelen står i samma ställning.
7. **Integritet.** Lagens namn (det enda som skrivs in, högst 40 tecken, samma rensning som självregistreringens namn) och
   bricknumren är personuppgifter för en dag: gallringen tar bort spelen och namnen, och de följer inte med i
   säkerhetskopian.

## Följder

- Högst 1 000 spel per träning och 2 MB per sändning.
- Mönstret finns på datorn som spelar (den bedömer gissningarna utan nät). Den som spelar på egen dator kan alltså läsa sitt
  eget mönster ur webbläsaren och fuska; det är en lek på en träning, och därför är "Spela på egen dator" av som förval.
- Övningsstationens brickor (7000001–7000003) är desamma på alla datorer; ställningen visar ett pågående spel per bricka.
- Den första versionens lagring läses: spelen får id och skickas; den gamla listan över avslutade spel saknar mönster och
  gissningar och tas inte med (Mastermind var inte i drift före ändringen).
- Två datorer som spelar samma bricka samtidigt utan nät kan starta var sitt spel; båda syns, och brickans spel just nu är
  det senast startade.
