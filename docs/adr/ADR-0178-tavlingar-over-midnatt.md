# ADR-0178: Tävlingar över midnatt

Status: beslutad 2026-10-27 (steg 58, PLAN.md).

## Bakgrund

Två e2e-test föll i CI bara på kvällen och natten (listor: OK Ek visade "2 löpare · 1 godkända"; stafett-steg47: båda
lagen såg ut att delta i omstarten). Riktiga tävlingar går också över midnatt: nattstafetter, Tiomila och Jukola (start
kl 23, omstarter på morgonen) och natt-KM som slutar efter 24. Appen räknade "tävlingsdagen" som ett datum från midnatt
till midnatt, och ett klockslag (HH:MM) som skrevs in hamnade alltid på tävlingsdatumet.

## Vad som var fel

- **Testerna.** Underlaget i CI (annoteringarna) visar att resultat saknades för de sista avläsningarna innan testet lämnade
  avläsningssidan. I stafetten stämmer lag 1:s tid (5:53) med en omstart som låg rätt mellan lagens växlingar; lag 1 stod
  först för att lag 2:s sista sträcka saknade resultat. I listorna saknades Eva, den sista av fem avläsningar.
  Avläsningsskalet visade beskedet ("GODKÄND") innan kön hade lästs om, så "0 väntar" kunde vara gammalt en stund, och
  testerna väntade bara på "0 väntar". Det är den troligaste förklaringen för stafetten (avläsningssidan öppnas inte igen,
  så avläsningen skickas aldrig). För listorna förklarar det inte allt: sidan öppnas igen för Filip, och en osänd avläsning
  skickas då (provat). Lokalt föll inget av testerna, varken med falsk klocka för server, databas och webbläsare (driftbygget,
  21:59, 23:30, 00:10 och 13:00 i Stockholm, TZ=UTC) eller med strypt processor i webbläsaren, så orsaken i CI är inte
  bevisad. Testerna väntar därför nu på serverns kvitto för varje avläsning, så att ett fel i CI syns där det uppstår.
- **Appen.** Samma fel fanns i appen: den som läser av kunde se "0 väntar" bredvid beskedet och lämna sidan. Dessutom:
  - ett klockslag efter midnatt (omstart 00:30 i en stafett med masstart 22:00, en start 00:20 i en nattklass) blev
    morgonen *före* tävlingen;
  - radiokontrollerna slutade hämta stämplingar vid midnatt (pollern frågade bara på tävlingsdatumet);
  - övningsstationen flyttade "nu" ett dygn bakåt efter midnatt;
  - stämplingslistan varnade "annan dag" för stämplingar efter midnatt.
  Resultatmotorn, SPORTident-tiderna (12-timmarsklocka och veckodag mot avläsningens tid) och starterna räknar med
  ögonblick och hade inget datumfel.

## Beslut

1. **Tävlingsdygnet** är från 00:00 på tävlingsdagen till kl 12 dagen efter, i tävlingens tidszon
   (`RACE_DAY_END_HOUR_NEXT_DAY`, `inRaceDay`). Stämplingar, avläsningar och klockslag i det fönstret hör till tävlingen.
   Det används för "annan dag" i stämplingslistan, radiopollern ("hämtar idag"), övningsstationens "nu" och varningen för
   övningsstation på tävlingsdagen. Kl 12 räcker för Jukola och natt-KM; en stämpling från en träning kvällen före är
   fortfarande "annan dag".
2. **Klockslag nära en referens** (`parseRaceClockNear`): ett klockslag som skrivs in för tävlingen blir det av
   tävlingsdagen och dagen efter som ligger inom tolv timmar från en känd tid i tävlingen: stafettens masstart (omstarter),
   första start (lottningens sista start och senare starter), klassens tidigaste start (en löpares starttid) eller den
   avlästa tiden (rättning av tid). Utan referens gäller tävlingsdagen som förut. Dagtävlingar påverkas inte. Alternativet
   en fast gräns (t.ex. "före kl 06 = dagen efter") valdes bort: det gör en tidig morgonstart fel och säger inget om en
   Jukola-omstart kl 09.
3. **Kön före beskedet**: avläsningsskalet läser om kön innan beskedet visas, så att "väntar" räknar den nya
   avläsningen när beskedet syns. Beskedet bedöms som förut mot de tidigare avläsningarna.
4. **E2E-testerna är oberoende av klockslaget**: tävlingen ligger alltid i Stockholm och tävlingsdagen är startens datum
   (`raceStartedAgo`), så på natten går testet över midnatt på riktigt i stället för att flyttas till New York eller hoppas
   över. Efter varje avläsning väntar testerna på serverns kvitto ("Sparad.", `expectSaved`) innan de går vidare; en
   avvisad avläsning syns och testet faller med det beskedet. `E2E_FAKE_CLOCK=1` ger webbläsaren testkörningens klocka
   (Playwright) när server och databas körs med libfaketime.

Ägarens beslut att en stämpling efter mål eller före start inte har betydelse är oförändrat.

## Följder

- Ett klockslag långt från referensen (mer än tolv timmar) hamnar på tävlingsdagen, som förut.
- Den publika startsidan visar en nattävling under "senaste" efter midnatt; länkarna till resultaten finns kvar.
- Specarna live, radio, sträckanalys, tävlingsdag-rättningar och tävlingsfunktioner flyttar fortfarande tävlingen till en
  annan tidszon nära midnatt (`ongoingRaceTimeZone`); de kan göras om på samma sätt.
