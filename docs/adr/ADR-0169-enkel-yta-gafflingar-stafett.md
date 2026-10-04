# ADR-0169: Enkel arbetsyta, lottning, gafflingar och stafett

Status: beslutad 2026-10-03 av ägaren (Joel). Kompletterar ADR-0168.

## Bakgrund

Efter steg 0–6 fungerar en träningskväll. Ägaren vill att O-Tid ska vara
enkelt att förstå men också klara komplexa tävlingar: lottning, gafflingar
och stafett. Två hinder:

1. **Modellen:** en klass har exakt en banversion. Löpare i samma klass kan
   inte springa olika varianter, och lag/sträckor finns inte.
2. **Arbetsytan visar maskineriet:** "oföränderlig banversion", "länka om",
   "tävlingsversion", "slumpfrö", "underlagshash", UTC-offset i starttider,
   granska–bekräfta för varje åtgärd och fyra olika verktyg för att rätta en bana.
   Varje ändring i tävlingen gör dessutom alla resultat till "äldre underlag".

## Beslut

### 1. Resultatets underlag gäller löparen, inte hela tävlingen
Ett resultat är aktuellt så länge det som påverkar just den löparens
bedömning är oförändrat: klass, bana/variant med kontroller, strukna
kontroller, startsätt, fast starttid och bricka. Detta sparas som en
underlagshash per resultatrevision. Tävlingsversionen används fortsatt för
avläsningspaket och samtidighet, men inte för att avgöra om ett resultat är
inaktuellt. När en ändring påverkar löpares underlag räknas deras resultat om
automatiskt i samma transaktion, med ny revision och bevarad historik.

### 2. Bana kan ha varianter; löparen bär sin variant
En bana kan ha flera varianter (gafflingar). En klass pekar på en bana. Varje
löpare (eller sträcka) får en variant genom lottning, import eller manuellt
val. Resultatmotorn bedömer mot löparens variant. Utan varianter fungerar
allt som i dag. Gafflingar kommer i första hand från IOF XML (OCAD, Purple
Pen, Condes), inte från en egen editor.
Saknar en löpare i en gafflad klass giltig variant bedöms avläsningen mot den
variant som stämplingarna passar bäst (godkänd först, därefter färst saknade
kontroller), så att en glömd tilldelning inte ger felstämpling.

### 3. Stafett: lag med sträckor
Stafettklass har antal sträckor och startsätt per sträcka (masstart,
växling, omstart). Lag har namn, klubb och nummer; varje sträcka har löpare,
bricka och variant. Varje sträcka bedöms som en individuell avläsning;
lagresultatet räknas i `packages/domain`.

### 4. Principer för arbetsytan
- Ett flöde som checklista: Banor → Klasser → Anmälda → Start → Avläsning → Resultat,
  med status per steg. Mallar: Träning, Klubbtävling, Stafett.
- Vanligt språk. Inga interna id, hashar, versionsnummer eller tidszonsformat i
  vyerna. Tider skrivs som klockslag.
- Spara direkt när inget resultat ändras (kan ångras via historiken). Bekräfta
  bara när resultat påverkas, med ett besked i klartext om vad som händer.
- En sak, ett ställe: "Redigera bana" ersätter omlänkning, kortbaneflytt och
  neutralisering i gränssnittet. Ett deltagarkort samlar allt om en löpare.
- Appen gör omförsök själv. Användaren får bara besked när något behöver göras.

## Konsekvenser

- Ny migration: underlagshash på resultatrevision, banvarianter, variant per
  deltagare, lag och sträckor. Ingen produktionsdata finns ännu (ADR-0168 beslut 6).
- Befintliga applikationsfunktioner för omlänkning/kortbana/neutralisering
  behålls som byggstenar bakom "Redigera bana" tills de kan förenklas.
- `PLAN.md` får steg 8–11. Steg 7 (hårdvara) görs parallellt av ägaren.
