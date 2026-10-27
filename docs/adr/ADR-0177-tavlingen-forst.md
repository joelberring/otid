# ADR-0177: Tävlingen först

Status: beslutad 2026-10-26 (PLAN.md steg 54, ägarens önskemål samma dag), beslut 10 2026-10-27 (steg 57). Bygger på steg 51 (`docs/lasttest.md`).

## Bakgrund

Steg 51 visade att en CX23 (2 vCPU, 4 GB) klarar 3 000 löpare och 300 samtidiga besökare, men att publiken och
tävlingen delar samma processer: när många tittar blir avläsningens kvitto segt (p95 1,3–1,7 s) och en 25-mannastafett
hinner bara ungefär en utläsning per sekund. Ägaren (2026-10-26): "det är ju ett problem om själva tävlingsservern börjar
strula för att det är för många som ska kolla på tävlingen. det vore bra om tävlingsdata alltid prioriterades om det
gick?" och "bra om du fixar så att tävlingsadmin alltid fungerar bra även om resultatredovisningen blir långsammare. jag
tänker att vi inte skalar upp än".

## Beslut

1. **Två slags webbinstanser** (`OTID_INSTANCE_ROLE`, `apps/web/src/lib/instance-role.ts`): `web` (`competition`:
   arbetsytan, avläsningen, funktionärerna, inloggningen, admin-API:t; migrerar och hämtar radiostämplingar) och
   `web-public` och `web-public2` (`public`: publika sidor och API:er, Live, resultatströmmen). Utan värde (`all`) gör en
   instans allt, som lokalt och med `pnpm dev`. Steg 51:s `web2` ersätts av två publika instanser: med bara en fick
   publiken högst en kärna och fick tidsgränser vid 1 000 besökare (mätt, `docs/lasttest.md`).
2. **Caddy delar upp per sökväg och inloggning** (`deploy/Caddyfile`): publika sökvägar utan sessionskaka till
   `web-public`/`web-public2` (färst pågående anrop), allt annat till `web`. Den som är inloggad (arrangör, funktionär,
   speakern) går alltid till `web`, även på publika sidor, och berörs därför aldrig av publikens lastavlastning.
3. **Processortid och minne:** `cpu_shares` 1024 för `postgres`, `web` och Caddy, 256 för var publik instans, 128 för backupen;
   minnestak per tjänst så att summan ryms i 4 GB (`docker-compose.prod.yml`, `docs/drift.md`). Vikterna gäller bara när
   processorn inte räcker, så publiken får all ledig tid annars. En hård gräns (`cpus`) för publiken provades och gav
   tidsgränser för publiken utan att avläsningen blev snabbare, så den används inte.
4. **Separata databaspooler** (`lib/db.ts`, `createDatabase(…, { max, statementTimeoutMs, … })`): tävlingens pool i `web`
   (10, utan tidsgränser) och publikens pool (3 i `web`, 8 i var publik instans) med `statement_timeout` 5 s, `lock_timeout`
   2 s och `idle_in_transaction_session_timeout` 10 s. Publikens frågor kan inte ta tävlingens anslutningar eller hålla
   lås länge. De publika listorna räknas alltid i publikens pool.
5. **Lastavlastning för publiken** (`lib/public-load.ts`): tryck = händelseloopen ligger mer än 150 ms efter (p99 per
   sekund) eller publika anrop köar; ett tryck varar minst 10 s. Under tryck ger cachen den senast färdiga listan i upp
   till 10 s (bara när enbart nya resultat kommit in; allt annat väntar in den nya listan som förut), räknar om högst var
   tredje sekund, resultatströmmen väcker högst var tredje sekund och svaret ber sidan vänta 5 s (`x-otid-stale-retry`).
   Högst 24 publika anrop åt gången, kö på högst 600 i högst 8 s, sedan 503 med Retry-After (2–5 s); sidan visar det den
   har och försöker igen tyst (`PublicBusyError`). Högst 3 000 öppna resultatströmmar per instans; en stängd ström öppnas
   igen efter 10–30 s. Inloggade räknas inte.
6. **Tävlingens instans räknar inte publikt i förväg:** i `web` väcker resultatströmmen bara (ingen uppvärmning), och en
   uträkning av en publik lista får högst en sjättedel av processen (förut en tredjedel). Lastavlastningen (beslut 5)
   gäller inte i `web`: där ges en lista direkt bara om den är högst 3 s gammal och bara nya avläsningar kommit in sedan
   dess (märkt, sidan hämtar igen); efter en ändring i arbetsytan aldrig (beslut 7).
7. **Arrangörens och funktionärernas resultatlista cachas per tävlingsversion** (egen post, privat svar; grinden
   kontrollerar varje anrop). Steg 52 räknade om den vid varje anrop från speakern och arbetsytan. **Kvar i skogen** (1,7 MB
   för 3 000 löpare, 0,3 s) delas av speakerskärmarna och arbetsytan i 2 s efter varje anropares behörighetskontroll.
   **En ändring syns direkt** (rättat efter CI:s driftjobb): varje lyckad skrivning i arbetsytan utom avläsningar räknar
   upp tävlingens ändringsgeneration i `web` (`lib/race-change-generation.ts`), och både Kvar i skogen och listornas
   version har generationen i nyckeln, så nästa läsning räknas om och ingen äldre lista ges. Det räcker med en process,
   eftersom Caddy skickar allt för inloggade till `web`. Tillträdet till en tävling (publicerad, inte dold) cachas inte:
   avpublicering och superadmins döljande syns direkt på alla instanser. Äldre listor under tryck gäller bara publikens
   resultatlistor, och avläsningar (nya resultat) räknar inte upp generationen.
8. **Avläsningen läser bara löparens eller lagets del** (`loadRaceSnapshot(db, raceId, { cardNumber })`): alla klasser,
   banor och rättningar, men bara deltagarna som har brickan (även en inaktiv koppling), deras lagkamrater och deras
   kopplingar. Stafettens omräkning efter nya starter läser bara de berörda lagen (`{ entryIds }`). Bedömningen ser samma
   sak som med hela paketet (integrationstestet `steg-54-tavlingen-forst` jämför). Utan flygande omstart låses klassen
   delat och laget ensamt (förut hela klassen), så avläsningar för olika lag görs samtidigt; med flygande omstart, och
   för det som räknar hela klassen, låses klassen ensam som förut. Resultatreglerna är oförändrade.
9. **Ingen uppskalning:** CX23 kvar. Gränserna står med uppmätta siffror på `/om` ("Hur stora tävlingar klarar O-Tid?")
   och i `docs/lasttest.md`.
10. **Placering i kvittot (steg 57, ägaren 2026-10-26: "det borde stå placering av de som är i mål här och hur långt man är
   efter"):** svaret på en avläsningssats har per godkänd avläsning en preliminär placering (`placement`, se
   docs/domain-rules.md). Den räknas i `web` ur den senast räknade listan i cachen (arrangörens resultatlista respektive
   stafettlistan, samma post som speakern och arbetsytan läser) med de avläsningsresultat som sparats sedan listan började
   räknas (`startedAt`) inlagda (`lib/readout-placement.ts`). Alla avläsningar går till `web`, så processen känner dem. Kvittot
   väntar aldrig på en ny uträkning när bara nya resultat kommit in; den startas i bakgrunden i cachens vanliga takt. Finns
   ingen lista, eller har något annat ändrats (generationen, en ny paketversion …), väntar kvittot högst 0,75 s och saknar
   annars placering – hellre ingen siffra än en från före ändringen. En extra fråga per sats (resultaten bakom kvittot).
   Ett fel i placeringen loggas och ger kvittot utan placering.

## Följder

- Med en publik instans nere tar den andra all publik; med båda nere svarar Caddy 502 för publiken men tävlingen
  påverkas inte. Med `web` nere fungerar publiken men inte arbetsytan, och avläsningsdatorerna köar lokalt tills `web` är
  uppe igen.
- Uppdateringen till publiken blir glesare under tryck (mätt p50 5 s i stället för 2,6 s vid 1 000 besökare); det
  är priset för att tävlingen går före. Kvitto p95 0,68 s och arbetsytan p95 0,69 s (före 6,8 och 4,0 s).
- En besökare som har en sessionskaka från O-Tid räknas som inloggad av Caddy. Det ger ingen behörighet (tjänsterna
  kontrollerar sessionen), bara att anropet går till `web`.
- Docker-läget (cpu_shares, mem_limit) provas första gången i CI:s driftjobb; lasttestet efterliknar det med cgroups.
