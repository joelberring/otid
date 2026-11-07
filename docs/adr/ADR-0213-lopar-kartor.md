# ADR-0213: Löparkopplade kartor – variablerna på arket, baksidan i samma PDF, urvalet, stafetten och kontrolltabellen

Status: beslutad 2026-11-04 (grenen `lopar-kartor`, ägarens önskemål samma dag). Ingen migration. Bygger på steg 61 (Kartor
till starten), steg 64 (en karta per löpare), ADR-0197 och ADR-0211 (papperet), ADR-0198 (bortvalda varianter) och ADR-0174
(stafetten och lagens gafflingar).

## Bakgrund

Steg 61 gav tryckantal per variant, kartbuntslistan i startordning, "Baksidor per löpare" som en egen körning med spegling
och "En karta per löpare (i samma ordning som Kartor till starten)" på utskriftssidan. Ägaren vill se kopplingen mellan
deltagare, klass och gafflingsvariant i layouten innan något skrivs ut, kunna skriva ut en enda löpare eller ett lags
sträcka igen, och få baksidan i samma PDF. Stafettklasserna fanns inte alls i Kartor till starten.

## Beslut

1. **Löparens variabler på papperet**: `{namn} {startnummer} {klubb} {klass} {starttid} {variant}` och för stafett `{lag}
   {lagnummer} {sträcka}` (`RUNNER_PAPER_VARIABLES`, `paperTextValues`). En text som "Lag {lagnummer} · Sträcka {sträcka} ·
   {variant}" placeras och formas som andra element och följer med i mallarna. `{startnummer}` är kartans nummer i Kartor till
   starten (samma "Nr" som kartbuntslistan). I utskriften av banor visar förhandsvisningen löparens variabler som
   platshållare (`runnerPlaceholders`, bara webbläsaren) med en rad om var de fylls i; PDF:en av banor lämnar dem tomma.
   `{klass}` och `{variant}` är banans klasser och ramens variant utan löpare, som förut.
2. **Baksidan i samma PDF**: "Baksida med löparens uppgifter": "Ingen baksida", "Dubbelsidigt (baksidan direkt efter varje
   framsida)" eller "Separat körning" (steg 61:s Baksidor, oförändrade). Baksidan är ett ark utan karta med papperets element
   förankrade i arket (`runnerBackSheet`), sparat i `event.runnerBack` med `SET_RUNNER_BACK` (null = förvalet), och redigeras
   på arket som "Baksidan (per löpare)" i papperets fält, utan klippning, vita ytor och mall. Förvalet är steg 61:s innehåll:
   variant och nummer stort, namn, klubb, klass och starttid uppe till höger (bakom kartans övre vänstra hörn när arket vänds
   kring långsidan; stafett får en rad med lag och sträcka). Baksidan har framsidans papper; PDF:en föreslår vändning på
   långsidan, eller kortsidan när alla baksidor är liggande, så att texten står rätt. Den fasta baksidan (`runnerBack` i
   `layout-template.ts`) är borttagen.
3. **Vilka som skrivs ut**: alla, valda klasser (löpare och lediga tider), valda löpare (sök på namn, startnummer eller
   lagnummer) eller valda lag (lagnummer) med alla sträckor eller en sträcka (`selectRunnerItems`). Framsidan och baksidan
   följer urvalet, i förhandsvisningen och i PDF-jobbet. Felen mot Kartor till starten stoppar bara utskriften av alla; i ett
   urval (en omutskrift) står de som varningar i tabellen.
4. **Stafetten i Kartor till starten** (`loadRelayBasis`, `planMapBundles`): en klass per sträcka med sträckans bana (eller
   klassens), dess varianter (eller sträckans fasta variant) och lagens varianter per sträcka (lagens gafflingar, som de
   redan står på deltagarna). Masstartens tid för sträckor med masstart, annars ingen lottad tid. Stafettens kartor står
   efter de individuella, per klass, sträcka, lagnummer och ordning inom sträckan, så att de individuellas nummer inte
   ändras. Kartorna, raderna och "saknar variant" har laget och sträckan (`team`, `leg`, valfria fält i kontraktet).
   Kartbuntslistan visar "lag 12, sträcka 2" vid klassen. Exporten av lagens gafflingar till IOF ingår inte.
   Ändrat 2026-11-07: listan per klass har en grupp per sträcka och variant (rubriken "sträcka 2"), så att sträckor med
   samma variantkoder inte slås ihop; `classes` i kontraktet har `leg`. Rogaining ingår som ogafflade grupper (individuellt
   och stafett), med tryckantal och löparkartor som andra klasser.
5. **Kontrollera kopplingen** i läget En karta per löpare: PDF-sida, Nr, Namn, Klubb, Klass, Lag/Sträcka, Bana, Variant och
   Starttid, sorterbar och filtrerbar (text eller "Bara rader med varning"), med varningarna ingen variant, bortvald variant
   (ADR-0198), antalet stämmer inte med Kartor till starten och samma startnummer två gånger (utom inom ett lag). Löpare
   utan karta (ingen eller bortvald variant) står med utan sida. Ett klick på en rad visar löparens ark; "Spara som CSV"
   (semikolon, UTF-8). Kartor till starten länkar till tabellen.
6. **Integriteten**: mallarna, "Mitt bibliotek" och klubbarkivet får bara variablerna. Löparna finns bara i kartbuntarna
   som läses när sidan visas, och i PDF-jobbets urval som förut (steg 64).

## Följder

- En stafett i en tävling ger nu kartor och tryckantal i Kartor till starten; en lista som skrevs ut före den här versionen
  visar stafettens löpare som nya.
- Dubbelsidigt med "Kartor per ark" (en karta per ark) är oförändrat i ordningen; baksidans innehåll är nu papperets element.
