# ADR-0226: Virtuella kontroller med telefonen

Status: beslutad och byggd 2026-11-16 (ägarens önskemål samma dag). Migration 0129. Bygger på ADR-0225 (bingon: publicering
för en dag, anmälan utan konto, fickläget, kö med kvittens, topplista och ledarsida).

## Beslut

1. **Ett tredje läge, CONTROLS**, på bingons grund (`bingo_race.mode`). Bingo och Sänka skepp ändras inte. Banorna är
   banläggningens vanliga banor (inte bingons grupper): kontrollerna i banans ordning med läget i kartans mm. Poängbana
   (`SCORE`) = valfri ordning.
2. **Inställningar per träning** (`bingo_race.settings`): radien (5–100 m, förval 25 m), stämpling automatiskt med tänd skärm
   (som bingon) eller med knappen «Stämpla» och en färsk position (som Sänka skepp, telefonen får vara låst), och poäng per
   kod (annars banläggningens poäng, annars 10).
3. **Reglerna** (`packages/domain/src/virtual-controls.ts`, servern räknar om allt): en stämpling kräver en position ≤ 20 m
   noggrann inom radien. Vanlig bana: bara nästa kontroll i ordningen räknas, en kontroll i fel ordning räknas inte, målet
   först när alla är tagna, inget efter målet. Poängbana: varje kontroll en gång. Duell: per kontroll rangordnas lagen efter
   sin första stämpling; först full poäng, tvåan 30 % avrundat, sedan 0; lagets poäng är summan och lagkamrater delar
   «först». Tidsgräns med avdrag är inte byggd.
4. **Duell och lag**: löparen skriver en kort kod (2–12 tecken A–Z och siffror) och ett valfritt lagnamn (tomt = eget lag).
   Topplistan har dueller med lagens poäng och vem som tog vilken kontroll först (för notiserna «Sara tog 34 – 10 p» och
   färgerna), aldrig positioner.
5. **Telefonens bild**: kontrollerna som ringar med nummer i rätt läge relativt varandra med kartnorr uppåt, start som
   triangel, mål som dubbelring, utan kartbild och utan egen position. Läget syns med färg och symbol: öppen ring, ✓
   (tagen av mig), randig och korsad (tagen av motståndaren). Efter Mål: mellantiderna och kartan med spåret och stämplingarna.
6. **Integritet** som ADR-0225: spåren och stämplingarnas positioner ser bara admin; löparna följer inte med i
   säkerhetskopian och tas bort av gallringen.

## Handledning (ledaren)

Banläggning → fliken Träning → Bingo → «Med telefonen»: bocka i, läge «Virtuella kontroller», radie, stämpling och poäng per
kod → Spara. Publicera träningen. Löparna: tävlingssidan → «Virtuella kontroller: anmäl dig och starta» → namn, bana, valfri
duellkod och lag → instruktionen → «Jag förstår – starta». Ledaren följer på `/admin/<tävling>/bingo`.
