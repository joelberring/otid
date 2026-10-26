# Lasttest (PLAN.md steg 51 och 54)

Frågan från ägaren: hur stora tävlingar klarar O-Tid på produktionsservern (Hetzner CX23, 2 vCPU x86, 4 GB) utan att bli seg?
Steg 51 mätte och rättade det publika; steg 54 ([ADR-0177](adr/ADR-0177-tavlingen-forst.md)) ser till att tävlingen
(avläsningen, arbetsytan, funktionärerna) går före publiken. Skripten finns i `scripts/lasttest/` (se [Köra om](#köra-om)).

## Steg 54: tävlingen först (mätt 2026-10-26)

Ägaren: "det är ju ett problem om själva tävlingsservern börjar strula för att det är för många som ska kolla på
tävlingen" och "bra om du fixar så att tävlingsadmin alltid fungerar bra även om resultatredovisningen blir
långsammare. jag tänker att vi inte skalar upp än". Kraven: 1 000 besökare under en målrusning, kvitto och arbetsytan
under 1 s (p95), en 25-manna med 300 lag.

### Svar i korthet

- **1 000 besökare och 3 000 löpare under en målrusning (toppar på 3 avläsningar/s):** kvittot på avläsningsdatorn
  **p95 0,87 s** (före 6,8 s) och arbetsytan **p95 0,58 s** (före 4,0 s). Publiken fick sina sidor och listor snabbare än
  före (p95 1,7–3,9 s, före 3,0–5,7 s) och inga fel, men ett nytt resultat syntes senare: p50 6,2 s, p95 13 s (före 2,6
  och 6,1 s). Det är priset för att tävlingen går före.
- **25-manna 300 lag × 25 med 300 besökare, 300 utläsningar på 5 minuter med toppar på 3/s:** kvitto p50 2,0 s, p95
  10,9 s (före 26,6 s och 91 s, och satser som fick tidsgräns). En utläsning tar 0,11 s utan last (före 0,33 s). Målet 1 s
  nås inte när många lag växlar på en gång; med jämnare växlingar (ungefär en per sekund) går det.
- **Ingen uppskalning:** samma CX23 och samma två kärnor. Det som ändrades är hur de delas (se nedan).

### Uppställning (skillnader mot steg 51)

- **Instanserna som i `docker-compose.prod.yml`:** `web` (tävlingen, `OTID_INSTANCE_ROLE=competition`) och två publika
  (`web-public`, `web-public2`), produktionsbygget (Next standalone) och PostgreSQL 17.10 som i steg 51. Lastgeneratorn
  delade anropen som `deploy/Caddyfile`: publika sökvägar utan inloggning till de publika, allt annat till `web`. Caddy
  provades för sig med samma bygge (Playwright mot HTTPS, se nedan).
- **Processortid som `cpu_shares`:** cgroup v1 med vikterna 1024 (databasen), 1024 (`web`) och 512 (de två publika
  tillsammans, 256 var), minnestak 1 GB, 1 GB och 1,5 GB. **Ingen kvot**: maskinen har 2 kärnor, som CX23, och compose
  sätter inte `--cpus`. (Steg 51 hade en kvot på 2 kärnor för hela gruppen; en kvot stoppar också `web` när publiken har
  använt upp den.)
- **Lastgeneratorn i två processer:** besökarna i en (vanlig prioritet, 0,15–0,2 kärnor) och avläsningsdatorerna,
  arbetsytan och speakern i en annan med hög prioritet. I verkligheten är de egna datorer; med en process räknades
  generatorns egen kö in i kvittot (mätt: kvitto p95 2,0 s i stället för 1,1 s med samma server).
- **Arbetsytan mäts för sig:** två inloggade funktionärer öppnar var femte sekund deltagarlistan, Kvar i skogen, "Kvar att
  läsa ut", banorna och inloggningen, och var tionde sekund resultatlistan som inloggad (`--office`).
- **Före** = `main` e6a4123 (steg 51, `web` + `web2`), mätt med samma uppställning (utan kvot, två generatorprocesser).

### Resultat

Individuell tävling, 3 000 löpare, 1 000 besökare, 150 avläsningar på 5 minuter (toppar på 3/s), två speakerskärmar, två
arbetsytor. Tider under rusningen, p50 / p95 / p99 i ms. CPU i kärnor (medel / p95).

| | Före (web + web2) | Efter (web + 2 × web-public) |
|---|---|---|
| Kvitto på avläsningsdatorn | 1 769 / 6 795 / 8 425 | **92 / 870 / 1 048** |
| Arbetsytan (alla anrop) | 1 548 / 3 981 / 8 801 | **70 / 578 / 705** |
| Arbetsytan: banorna, Kvar i skogen, deltagarlistan p95 | 8 801, 3 113, 2 563 | 697, 523, 482 |
| Resultat som inloggad (arbetsytan) p95 | 3 828 (räknades om varje gång) | 385 |
| Speakern: Kvar i skogen, resultat p95 | 3 944, 3 631 | 1 087, 746 |
| Publiken: resultatlistan, Live, deltagare, startlistan p95 | 5 667, 5 543, 5 087, 3 406 | 3 851, 2 993, 3 014, 1 692 |
| Publiken: sidladdningar p95 (sämsta) | 5 715 | 3 367 |
| Uppdatering till publiken p50 / p95 | 2,6 s / 6,1 s | 6,2 s / 13,0 s |
| Fel | 0 | 0 (inga 503 behövdes) |
| CPU web / publika / databas | 1,33 / – / 0,25 (p95 1,62 / – / 0,39) | 0,27 / 0,99 / 0,16 (p95 0,78 / 1,63 / 0,31) |
| Minne max web / publika / databas | 2 175 MB (två) / – / 530 MB | 318 MB / 979 MB (två) / 474 MB |

25-mannastafett, 300 lag × 25 (7 500 sträcklöpare, sträcka 1–4 avlästa), 300 besökare, 300 utläsningar på 5 minuter
(toppar på 3/s), två speakerskärmar och två arbetsytor:

| | Före | Efter |
|---|---|---|
| Kvitto p50 / p95 / p99 | 26 608 / 91 246 / 96 602 | **2 000 / 10 895 / 12 561** |
| Satser med tidsgräns (30 s) | 8 (skickades om) | 0 |
| Arbetsytan p50 / p95 | 771 / 2 508 | 604 / 1 694 |
| Publiken (resultat, Live, stafett) p95 | 2 691–3 957 | 1 938–2 319 |
| CPU web / publika / databas | 1,15 / – / 0,34 | 0,69 / 0,55 / 0,27 |

Utan last (en utläsning i taget, applikationslagret): individuell 81 → 50 ms (38 databasfrågor), stafett 3 sträckor 115 ms
före, 25-manna 343 → 110 ms (84 frågor). ¹

¹ Före: lasttestets testdata (`seed.ts`, ms per avläsning med main). Efter: samma avläsningar en och en mot en kopia av
testdatan.

Lastgeneratorn byggde före rättelsen om en avläsning vid omsändning efter tidsgräns (ny hash), och servern avvisade den
som sekvenskonflikt; det gav fem "ej sparad" i 25-mannakörningen före. Avläsningssidans kö skickar alltid samma
avläsning, och generatorn gör nu likadant.

### Vad som ändrades (och vad som provades)

Mätt i ordning med 1 000 besökare (individuell tävling):

| Ändring | Kvitto p95 | Arbetsytan p95 | Publiken |
|---|---:|---:|---|
| Före (`web` + `web2` delar allt) | 6,8 s | 4,0 s | p95 3,0–5,7 s |
| `web` + **en** `web-public`, CPU-vikter, pooler, lastavlastning, avgränsad avläsning ² | 1,05 s | 1,15 s | nästan 2 000 tidsgränser (30 s): en Node-process räcker inte |
| `web` + **två** publika | 1,1 s | 1,2 s | p95 4,3–7,1 s, inga fel |
| Två publika med en hård gräns på 1,3 kärnor | 1,0 s | 1,2 s | tidsgränser igen; används inte |
| Kvar i skogen delas av skärmarna i 2 s | 0,62 s | 0,64 s | p95 1,7–3,8 s |
| Inloggades resultatlista högst 5 s gammal direkt i `web` | **0,87 s** | **0,58 s** | p95 1,7–3,9 s |

² Med en generatorprocess och kvoten från steg 51; de andra raderna utan kvot och med två generatorprocesser.

- **Instanserna:** en Node-process använder en kärna. I steg 51 delade `web` och `web2` allt, så en avläsning väntade i
  samma kö som hundratals publika anrop. Nu tar `web` bara tävlingen (och allt för den som är inloggad) och använde
  0,27 kärnor i medel, medan de publika tog resten.
- **Profilering av `web-public`** under last: 19 % skräpsamling, 13 % sidrendering, 7 % skrivning till nätet och 7 %
  databasfrågor (en per anrop för grinden). Grindens svar för besökare utan inloggning delas nu i 1 s, och det packade
  svaret kopieras inte längre för varje anrop.
- **Profilering av `web`:** 71 % ledig. Kvittona var sega för att tunga läsningar (Kvar i skogen 1,7 MB, 0,3 s, från två
  speakerskärmar vid varje väckning) blockerade processen när en avläsning kom. Delad i 2 s halverade kvittots p95.
- **Arrangörens och funktionärernas resultatlista** (steg 52) räknades om vid varje anrop (4 MB, 0,5 s); nu en gång per
  tävlingsversion, och `web` ger en upp till 5 s gammal lista direkt.
- **Avläsningen** läser bara löparens eller lagets del av tävlingen, och stafettklasser utan flygande omstart låses per lag
  i stället för per klass.
- **Lastavlastningen** (äldre lista i upp till 10 s, uträkning och väckning högst var tredje sekund, kö, 503) slog till
  under hela rusningen (händelseloopen låg mer än 150 ms efter). Inga anrop behövde avvisas med 503 vid 1 000 besökare;
  taket finns som sista utväg och är provat i enhetstesterna.

### Gränser och rekommendation (steg 54)

- **CX23 räcker** för 3 000 löpare och 1 000 samtidiga besökare under en målrusning: kvitto och arbetsyta under 1 s (p95),
  publiken p95 under 4 s och ett nytt resultat syns hos publiken efter ungefär 5–10 s (p95 13 s).
- **25-manna:** fungerar med 300 lag, men vid täta växlingar (3 per sekund) får avläsningen vänta: kvitto p50 2 s, p95 11 s.
  Inget går förlorat; kön på avläsningsdatorn tar hand om det. En utläsning gör 84 databasfrågor i följd, och under last
  väntar varje fråga på processorn (se Idéer i STATUS.md).
- **Fler besökare:** publiken får det långsammare (glesare uppdatering, sist 503 och ett nytt försök), men tävlingen
  påverkas inte. Vill ni ha snabbare uppdatering till publiken: en större server med fler publika instanser.
- **Provat med Caddy** (2.11, `deploy/Caddyfile`) och tre produktionsinstanser med rollerna: en besökare utan inloggning
  får `/om` från en publik instans när `web` står still, en inloggad får `web`. Webbläsartesterna `hjalp`, `live`,
  `listor`, `publikt`, `stafett`, `stafett-steg47`, `stafett-steg48`, `stafett-steg50`, `gafflingar`, `gafflingsbild`,
  `banhemlighet`, `funktionarer`, `avlasaren`, `sakerhetshuvuden`, `radio`, `avslut` och `arbetsyta` gick igenom mot den.
  Docker-läget (`cpu_shares`, `mem_limit`) provas först i CI:s driftjobb.

## Steg 51 (mätt 2026-10-26)

### Svar i korthet

- **Före steg 51 klarade CX23 inte ens 100 samtidiga besökare** på en tävling med 3 000 löpare: varje besökare fick
  resultatlistan, Live och deltagarsidan uträknade på nytt var femte sekund och vid varje avläsning. Webben var mättad,
  publika anrop tog 30 s (tidsgräns) och avläsningsdatorerna fick aldrig sitt avläsningspaket.
- **Efter:** CX23 med två webbinstanser klarar **3 000 löpare och 300 samtidiga besökare under en målrusning (3
  avläsningar/s) med p95 under 1 s för alla publika sidor och anrop (0,5–0,95 s) och uppdatering till publiken inom 5 s
  (p95 4,0 s)**. 500 besökare fungerar men är segare (p95 1,2–1,5 s, uppdatering 5,2 s).
- **Avläsningen:** besked på avläsningsdatorn ges direkt av bedömningen i webbläsaren. Serverns kvitto tar p50 0,2–0,3 s
  men p95 1,3–1,7 s vid toppar på 3/s (målet 1 s nås inte), 2,5 s när funktionärer samtidigt ändrar banor och starttider.
- **Stafett** 300 lag × 3 går lika bra. **25-manna** 300 lag × 25: publiken klarar sig, men servern hinner bara ungefär
  en utläsning per sekund (kvitto 23 s p50 vid toppar på 3/s); välj en större server om växlingarna kommer tätt.
- **Gräns i en mening:** klarar 3 000 löpare och 300 samtidiga besökare på CX23 med p95 under 1 s för publiken och
  1,5 s för avläsningens kvitto; fler besökare eller en tät 25-manna kräver en större server (4 vCPU, fyra webbinstanser).

### Scenarier

Testdatan skapas av `scripts/lasttest/seed.ts` (påhittade namn) genom applikationslagret, som en arrangör gör det:

- **Individuell:** 3 000 löpare i 40 klasser (45–183 per klass), IOF-banfil med 24 banor varav fyra gafflade banfamiljer
  (två fjärilar, fyra varianter) för sex klasser, lottade minutstarter (1 min i klasser över 60 löpare, annars 2 min,
  klubbseparering), publicerad startlista. En vanlig bana delas av fyra klasser med 300+ löpare. 2 700 är redan avlästa;
  de sista 300 läses ut under testet.
- **Stafett:** 300 lag × 3 sträckor på en gafflad bana (masstart, växling). Sträcka 1–2 avlästa, sträcka 3 (300) under testet.
- **25-manna:** 300 lag × 25 sträckor (7 500 sträcklöpare). Sträcka 1–4 avlästa (1 200), sträcka 5 (300) under testet.
  Alla 24 sträckor hann inte läsas in före ändringarna (1,1–1,6 s per avläsning, se nedan).

Lastgeneratorn (`scripts/lasttest/load.ts`) kör ett scenario i taget:

- **Målrusning:** tre avläsningsdatorer (egna sessioner, löpnummer och köer) skickar till samma API som avläsningssidan
  (`POST …/administrator/readouts`, en avläsning per sats, kön samlar upp till 100 när den ligger efter). Riktiga
  SPORTident-ramar från den simulerade stationen. Ankomster med toppar på 3 per sekund i 15 s varannan minut, resten jämnt.
  **Besked** = från att brickan sätts i till att servern kvitterat (inklusive kön på datorn).
- **Publiken:** 100, 300 eller 500 virtuella webbläsare på resultatlistan (2/7), Live (2/7), startlistan (1/7),
  deltagarsidor (1/7) och tävlingssidan (1/7). De laddar sidan, håller resultatströmmen (SSE) öppen, hämtar som sidornas kod
  gör och laddar om sidan ungefär varannan minut. Svaren begärs med gzip.
- **Speakern:** två inloggade speakerskärmar (speakerunderlag, resultat, kvar i skogen, stafett, radio).
- **Funktionärsåtgärder:** redigera den delade banan (byt plats på två kontroller, 300+ avlästa räknas om) och tillbaka,
  flytta en klass starttider 2 min och tillbaka, "Resultaten är klara" när rusningen är slut.
- **Uppdatering till publiken:** 24 provbesökare letar efter varje kvitterad löpare i sina svar; tiden från kvitto till
  att löparen syns.

### Maskin och uppställning

- **Maskin:** en molnmaskin med 2 kärnor (Intel Xeon 2,8 GHz), 8 GB, Linux 6.18. Docker fanns men kunde inte hämta
  bilder (registret var spärrat i miljön), så PostgreSQL **17.10** kördes som vanlig process (binärerna från npm-paketet
  `@embedded-postgres/linux-x64`, samma standardinställningar som bilden `postgres:17`: 128 MB shared_buffers, 100
  anslutningar) och webben som **produktionsbygget** (Next standalone, `node apps/web/server.js`, Node 22, `NODE_ENV=production`).
- **Samma resurser som CX23:** webben och databasen låg i en gemensam cgroup med **2 kärnor (cfs-kvot) och 4 GB** (det
  `docker --cpus 2 --memory 4g` gör), med högre CPU-vikt än resten av maskinen så att andra processer inte stal tid.
  `scripts/lasttest/server.sh cgroup` gör samma uppställning; `server.sh docker` använder Docker där bilderna går att hämta.
- **Utan Caddy:** lastgeneratorn talade HTTP direkt med webben (TLS och Caddys packning ingår inte). Webben svarar nu själv
  med gzip för de publika listorna, så Caddy behöver inte packa dem. Två webbinstanser fick vardera en port och
  lastgeneratorn fördelade webbläsarna mellan dem, som Caddy gör.
- **Lastgeneratorn** körde på samma maskin (0,2 kärnor, redovisat per körning) och mätte varje anrop till sista byte.
- **Belastning:** andra agenter körde tester på maskinen under dagen. De slutliga mätningarna startade först när inga
  vitest-, playwright-, tsc- eller next build-processer körde och load average var under 2 i 20 s; load average under
  varje mätning (som även räknar webben, databasen och lastgeneratorn) står i tabellen.

### Resultat

Alla körningar: den individuella tävlingen (3 000 löpare) om inget annat står, 150 avläsningar på 5 minuter (toppar på
3/s i 15 s varannan minut), två speakerskärmar, två webbinstanser om inget annat står. Tiderna gäller under rusningen.
"Sidor" är sidladdningar (sämsta sidan av resultat, Live, startlista, deltagare och tävlingssidan). CPU i kärnor
(web = båda instanserna tillsammans). Load average gäller hela maskinen, inklusive webben, databasen och lastgeneratorn.

| Körning | Kvitto p50 / p95 / p99 ms | Resultat p95 ms | Live p95 ms | Deltagare p95 ms | Startlista p95 ms | Sidor p95 ms | Uppdatering p50 / p95 s | Fel | Web CPU medel / p95 | Db CPU medel | Web minne max MB | Load medel / max |
|---|---|---:|---:|---:|---:|---:|---|---:|---|---:|---:|---|
| **Före**, 100 besökare, en webb | – (paketet kom aldrig) | 30 005 | 30 004 | 30 004 | 30 003 | 35 955 | – | 1 059 | 1,11 / 1,34 | 0,18 | 1 266 | 1,6 / 2,4 |
| Efter, 100 besökare | 207 / 1 306 / 1 448 | 556 | 517 | 473 | 347 | 1 051 | 1,6 / 3,2 | 0 | 0,54 / 1,32 | 0,14 | 1 634 | 2,3 / 3,1 |
| Efter, 300 besökare | 322 / 1 501 / 1 890 | 815 | 726 | 641 | 480 | 948 | 2,0 / 4,0 | 3¹ | 0,68 / 1,42 | 0,15 | 1 783 | 2,2 / 3,9 |
| Efter, 500 besökare | 494 / 2 709 / 3 981 | 1 481 | 1 175 | 1 177 | 739 | 1 352 | 2,3 / 5,2 | 3¹ | 0,80 / 1,53 | 0,16 | 1 891 | 3,0 / 4,2 |
| Efter, 300 besökare, **en** webb | 353 / 1 712 / 2 060 | 842 | 726 | 748 | 378 | 1 406 | 1,9 / 4,3 | 3¹ | 0,53 / 1,08 | 0,13 | 981 | 1,7 / 2,2 |
| Efter, 500 besökare, **en** webb | 955 / 4 320 / 5 616 | 1 463 | 1 334 | 1 276 | 701 | 1 744 | 2,3 / 6,2 | 0 | 0,67 / 1,18 | 0,14 | 1 058 | 2,0 / 3,0 |
| Efter, 300 besökare, 300 avläsningar på 10 min **och funktionärsåtgärder** | 718 / 2 523 / 3 636 | 1 264 | 1 136 | 1 041 | 601 | 1 445 | 2,2 / 3,9 | 6¹ | 0,60 / 1,36 | 0,16 | 1 942 | 1,9 / 3,1 |
| Stafett 300 lag × 3, 300 besökare, 300 avläsningar | 346 / 1 720 / 2 131 | 339 | 342 | – | – | 793 | 0,2 / 1,0 | 6¹ | 0,80 / 1,24 | 0,25 | 1 529 | 5,6 / 7,3² |
| 25-manna 300 lag, 100 besökare, 300 avläsningar | 23 176 / 60 105 / 63 570 | 793 | 1 170 | – | – | 2 400 | 0,1 / 0,5 | 8³ | 1,07 / 1,49 | 0,32 | 1 677 | 3,0 / 4,3 |

¹ Speakerskärmens första anrop direkt efter inloggningen (speakerunderlag, kvar i skogen, stafett) gav 401 en gång per
skärm; nästa anrop gick igenom. Syns bara i lastgeneratorn och är inte utrett. Inga andra fel.
² En annan agent byggde och körde tester på maskinen under körningen.
³ Fyra satser med avläsningar fick tidsgräns (30 s) och skickades om; alla avläsningar sparades.

Funktionärsåtgärderna under last (300 besökare, målrusning, två webbinstanser):

| Åtgärd | Före (5 besökare) | Efter, under last |
|---|---:|---:|
| Redigera den delade banan (387 anmälda, förhandsbesked + spara, alla avlästa räknas om) | – | 2,1 s |
| Redigera tillbaka | – | 2,8 s |
| Flytta en klass starttider 2 min (förhandsbesked + spara) | 15 s (räknade om hela tävlingen) | 2,4 s |
| Flytta tillbaka | – | 1,1 s |
| Resultaten är klara (fastställer 3 000 resultat) | – | 6,9 s |

Andra mätningar: avläsningspaketet för 3 000 löpare är 2,0 MB och tar 0,3–0,8 s att hämta. En utläsning utan last tar
90–150 ms på servern (individuell), 0,1 s (stafett, 3 sträckor) och 0,33 s (25-manna).

### Vad som var långsamt och vad som rättades

Mätt med profilering (CPU-profiler i Node, `pg_stat_statements`, `EXPLAIN ANALYZE`). Före = `main` ac2e06d.

| Vad | Före | Efter |
|---|---|---|
| Resultatlistan (3 000 löpare, 4,0 MB JSON, 395 kB gzip) | räknades om för **varje anrop**: 0,35–0,8 s CPU per besökare och femte sekund | räknas **en gång per tävlingsversion** och delas av alla; ett anrop kostar 2–3 ms (300–500 anrop/s per process) |
| Live | 1,0 s per anrop (räknade om resultatlistan, stafett och radio) | 38 ms per version, ur de cachade listorna |
| Deltagarsidan | 0,6 s per anrop (räknade om hela resultatlistan för en rad) | en rad ur den cachade listan (380 anrop/s) |
| Resultatsidan (sidladdning) | 7,1 MB HTML, 1,9–4 s serverns tid per besök | listan skickas inte med när den har fler än 400 rader: 3 kB, ca 10 ms; sidan hämtar den cachade listan |
| Startlistan | 0,7 s per sidladdning, ny validering för varje anrop | cachad per version; sidan hämtar stora listor själv |
| Uträkningen av resultatlistan | – | 470 → 320 ms: raderna valideras en gång i stället för två, `Intl.Collator` i stället för `localeCompare` per jämförelse, urval med `= any($1::uuid[])` i stället för en parameter per id (37 → 4 ms per fråga med 3 000 id) |
| Resultatströmmen (SSE) | varje markör väckte **alla** besökare direkt, och var och en hämtade listan på nytt (vid en omräkning av 300 löpare: 300 väckningar) | markörer samlas per tävling i 250 ms; listorna räknas först och sedan väcks besökarna; sidan sprider hämtningen (0–1 s, minst 3 s mellan) |
| Sidornas egen hämtning | var femte sekund, alla tre listorna (resultat, stafett, radio) | var 10:e sekund medan strömmen är öppen (annars var femte); stafett och radio bara när de har innehåll (annars var 30:e) ¹ |
| Avläsning i stafett (300 lag) | hela klassens sträckor lästes och räknades vid varje avläsning: 25-manna **1,1–1,6 s**, 3 sträckor 0,31 s | bara lagets sträckor (utan flygande omstart, som är den enda regel som beror på andra lag): 25-manna **0,33 s**, 3 sträckor 0,1 s |
| Flytta en klass starttider (160 löpare) | prövade och räknade om **alla 2 700 avlästa** i tävlingen: 15 s, 2 700 nya revisioner, avläsningarna stod still | bara klassens avlästa: 1,0–1,7 s |
| Läsningar under en funktionärsåtgärd | 500 på publika listor och speakern (PostgreSQL 40001 i upprepbar läsning) | läsningen görs om (högst tre gånger); listan som fanns visas hellre än ett fel |
| En Node-process | använder en kärna; på 2 vCPU blev webben flaskhalsen långt före databasen (0,15 kärnor) | `docker-compose.prod.yml` kör två webbinstanser (`web`, `web2`) bakom Caddy |

¹ Mätningarna gjordes med 30 s; webbläsartesterna visade att "Resultaten är klara" (som inte väcker resultatströmmen) då
syntes för sent i arbetsytan, så reserven blev först 15 s och efter CI:s driftjobb (två instanser) 10 s. Under en
målrusning väcker strömmen sidorna oftare än så (var 3–5 s), så skillnaden syns inte i mätningarna.

**Rättat efter sammanslagningen med main (CI:s driftjobb, `web` + `web2` bakom Caddy).** Fyra webbläsartester såg en
inaktuell lista: en besökare som öppnade sidan just efter sista avläsningen fick listan före avläsningen (cachen gav en
upp till 3 s gammal lista direkt), väcktes inte av en avläsning som redan var gjord och hämtade själv först efter 15 s;
ett ångrat fastställande kunde ge "Officiella resultat" vid omladdning (versionen var delad i 500 ms, och en uträkning
som började före ändringen gavs ut). Nu: den äldre listan ges direkt bara när enbart nya resultat har kommit in, och
svaret märks `x-otid-stale` så att sidan hämtar igen efter 3–4 s (lika glest som väckningarna under rusningen); allt
annat väntar in den nya listan, en uträkning från före ändringen görs om, sidorna läser versionen direkt och API:et
högst 250 ms gammal, och reserven med öppen ström är 10 s.

**Live inom 5 s med två instanser (efter CI:s driftjobb).** Live-testet föll ibland i CI (Anna syntes inte inom 10 s).
Instansen som bara fick besökarens hämtningar (strömmen låg på den andra, `least_conn`) lyssnade inte på
resultatströmmen och räknade därför inte om i förväg; hämtningen fick den äldre listan eller väntade på uträkningen, och
sidan hämtade igen först efter 3–4 s. Nu lyssnar varje instans som visar en publik lista, och räknar om de tävlingar den
visat de senaste två minuterna; väckningen ger alltid listan för den nya versionen (en uträkning från före avläsningen
görs om); den äldre listan ges direkt bara om den är högst 1 s gammal, och sidan hämtar då igen efter 1,5–2,5 s. Mätt
med Caddy 2.11 och två produktionsinstanser (avläsning till rad i Live): före 0,9–5,0 s, efter 0,5–2,0 s, också med båda
kärnorna fullt belastade. Stafettsynken per lag var inte orsaken (stafettestarna gick
igenom lokalt även före rättelsen; ett lags starter beror utan flygande omstart bara på lagets egna växlingar).

Resultatreglerna är oförändrade: listorna ur cachen är byte för byte samma som förut (jämfört för den individuella tävlingen och stafetten),
och alla tester går igenom. Det enda som räknas om mer sällan är starttidsflytten, där bara klassens underlag ändras.

### Gränser och rekommendation

Gränserna att jämföra med: besked på avläsningsdatorn under 1 s (p95), publika sidor under 1 s (p95), uppdatering till
publiken inom 5 s, inga fel.

- **Publiken:** med två webbinstanser klarar CX23 **300 samtidiga besökare** på en tävling med **3 000 löpare** under en
  målrusning med p95 under 1 s för alla publika anrop och sidor (0,5–0,95 s) och uppdatering inom 5 s (p95 4,0 s).
  Vid **500** besökare är p95 1,2–1,5 s och uppdateringen 5,2 s (p95): fungerar, men känns seg på telefon.
- **Avläsningen:** besked på avläsningsdatorn kommer direkt från bedömningen i webbläsaren (avläsningsskalet räknar själv
  med samma resultatmotor). Serverns kvitto, som mätningen avser, har p50 0,2–0,35 s men **p95 1,3–1,7 s** vid toppar på
  3 avläsningar per sekund, redan vid 100 besökare: målet 1 s nås inte. Varje avläsning läser hela tävlingens
  avläsningspaket (3 000 anmälda och brickor, ca 25 frågor i följd) och väntar i webbprocessens kö när publiken väcks.
  Kön på avläsningsdatorn växer inte (längsta kvitto 2,0 s vid 300 besökare).
- **Stafett 300 lag × 3:** som den individuella (publikt p95 0,35 s, uppdatering 1 s, kvitto p95 1,7 s).
- **25-manna 300 lag × 25:** publiken klarar sig (p95 0,8–1,2 s), men avläsningen gör det inte: varje avläsning tar ca
  1,3 s på servern under last (0,33 s utan last), och avläsningarna i samma klass görs en i taget (stafettklassens lås).
  300 utläsningar på 5 minuter med toppar på 3/s gav kvitton på **23 s (p50) och 60 s (p95)** och några tidsgränser
  (avläsningarna skickades om och sparades). En 25-manna klarar ungefär **en utläsning per sekund**; jämnare växlingar
  (som i verkligheten, 300 lag på 10–20 minuter per sträcka) går, men inte en tät växling.
- **Funktionärsåtgärder under last:** banändring med 300+ avlästa 2–3 s, flyttade starttider 1–2,5 s, "Resultaten är
  klara" 6,9 s, utan fel för publiken (före rättelsen gav samtidiga läsningar 500, och starttidsflytten tog 15 s och
  stoppade avläsningarna).
- **Minne:** web 0,8–1 GB per instans under last, databasen 0,4–0,65 GB: högst 2,6 GB av 4 GB.
- **Fel:** inga fel för publiken eller avläsningen efter rättelserna (se fotnoten om speakerns första anrop).

**Rekommendation:**

1. Kör två webbinstanser (nu förval i `docker-compose.prod.yml`). En Node-process använder en kärna; databasen använde
   högst 0,5 kärnor i alla mätningar.
2. CX23 räcker för en tävling med **3 000 löpare och upp till 300 samtidiga besökare** (till exempel en distriktstävling
   eller ett mindre nationellt arrangemang med Live på storbild och publik i mobilen).
3. Välj en större server (Hetzner CX33, 4 vCPU/8 GB, och fyra webbinstanser i stället för två, inte provat) när ni väntar fler än
   300 samtidiga besökare, eller en 25-mannastafett där kvittona ska komma fort. Med fler kärnor kan fler webbinstanser
   dela publiken; avläsningen blir inte snabbare än ca 0,3 s per utläsning i 25-manna förrän avläsningen läser bara
   löparens del av paketet (nästa steg, se Idéer i STATUS.md).
4. Bandbredd: resultatlistan för 3 000 löpare är 411 kB packad och Live 123 kB. 300 besökare hämtar under en målrusning
   ca 18 resultatlistor och 18 Live per sekund, ca 80 Mbit/s ut från servern; 500 besökare ca 125 Mbit/s. Varje besökare
   på resultatlistan laddar ner ca 5 MB per minut under rusningen.

## Köra om

```bash
# 1. Server: produktionsbygget och PostgreSQL 17 (cgroup v1, root, en maskin med 2 kärnor).
pnpm install && pnpm --filter @o-tid/web build
# Steg 54 (förval): web på 3000 och två publika på 3001 och 3002 med CPU-vikter och minnestak som docker-compose.prod.yml.
# LASTTEST_ROLES=off LASTTEST_INSTANCES=2 ger steg 51:s två likadana instanser (för en mätning före).
PG_BIN=/väg/till/postgres17/bin scripts/lasttest/server.sh cgroup
# 2. Testdata (tom databas, påhittade namn). --small ger en tiondel; --races väljer individual,relay3,relay25.
DATABASE_URL=postgresql://otid:otid@127.0.0.1:5440/otid pnpm lasttest:seed -- --out /tmp/otid-lasttest/manifest.json --relay25-legs-read 4
# 3. Last i två processer (steg 54): besökarna och tävlingens del (avläsningsdatorer, arbetsyta, speaker) med hög prioritet.
NET="--base http://127.0.0.1:3000 --public-base http://127.0.0.1:3001,http://127.0.0.1:3002 --cgroups web=otid/web,public=otid/public,db=otid/db"
pnpm lasttest:load -- --manifest /tmp/otid-lasttest/manifest.json --race individual --visitors 1000 --readouts 150 --minutes 5 \
  $NET --part public --seen /tmp/otid-lasttest/seen.json --out /tmp/otid-lasttest/publik.json &
sleep 30   # besökarna hinner komma
mkdir -p /sys/fs/cgroup/cpu/otidhi && echo 8192 > /sys/fs/cgroup/cpu/otidhi/cpu.shares
sh -c 'echo $$ > /sys/fs/cgroup/cpu/otidhi/cgroup.procs; exec "$@"' sh pnpm lasttest:load -- --manifest /tmp/otid-lasttest/manifest.json \
  --race individual --visitors 1000 --readouts 150 --minutes 5 $NET --part competition --seen /tmp/otid-lasttest/seen.json \
  --out /tmp/otid-lasttest/tavlingen.json   # --actions kör funktionärsåtgärderna, --client old efterliknar sidorna före steg 51
wait
scripts/lasttest/server.sh stop
```

Utan `--part` kör en process allt (som steg 51). Lastgeneratorn skriver tabellerna (Markdown) och JSON. Kör testdatan på
nytt (eller kopiera databasen med `create database … template …`) före varje mätning: avläsningarna i manifestet kan
bara läsas ut en gång, och de lottade starttiderna utgår från klockan när testdatan skapades (kör lasten inom några timmar).
