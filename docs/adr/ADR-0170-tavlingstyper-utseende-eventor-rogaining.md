# ADR-0170: Tävlingstyper, nytt utseende, Eventor och rogaining

Status: beslutad 2026-10-04 av ägaren (Joel). Kompletterar ADR-0168 och ADR-0169.

## Bakgrund

Efter steg 8–11 klarar O-Tid träning, lottning, gafflingar och stafett, men
ägaren upplever arbetsytan som rörig: alla funktioner syns för alla
tävlingar, start och resultat är svåröverskådliga, det går inte att få listor
på olika sätt, navigeringen i toppen försvinner när man rullar, speakern
behöver en egen sida och utseendet känns inte tillräckligt tydligt och tätt.
Klasser, deltagare och banor måste kunna läsas in från Eventor och banfiler och
uppdateras över tid.

## Beslut

### 1. Tävlingstyp styr vad som syns
När tävlingen skapas väljer arrangören typ: **Träning**, **Liten tävling**,
**Tävling**, **Tävling med gafflade banor**, **Stafett** eller **Rogaining**.
Typen bestämmer vilka delar av arbetsytan som visas och vilka förval som
gäller (startsätt, lottning, speaker, Eventor). Typen kan ändras under
Inställningar; inga data försvinner, bara synligheten ändras. Funktionerna
finns kvar i en gemensam kärna – typen är en vy, inte en egen kodväg.

### 2. Utseende och navigering
- Arbetsytan får ett fast skal: en ljus sidopanel (mobil: en remsa överst) som
  alltid syns, ritad som en bana – start, kontroller och mål – där varje steg
  är en del av tävlingen med sin status. En fast toppbalk visar tävlingen och
  läget (avläsning, kvar i skogen).
- Ett gemensamt, återhållsamt formspråk: vitt, gråskala och svart text.
  Färg används bara där den gör något tydligare: status (grön godkänd, röd
  felstämplad), orange för det som behöver åtgärdas och en enda accentfärg
  (banlila) för markerat val och fokus. Typsnittet Barlow och Barlow Semi
  Condensed (självhostat via npm), täta tabeller med tabellsiffror, få och
  konsekventa komponenter.
- Speakern är en egen sida som kan öppnas i ett eget fönster eller på en
  skärm och uppdateras av sig själv.

### 3. Listor
Start och resultat får en verktygsrad med vy (startlista per klass, per
starttid/startfålla, per klubb; resultat per klass, med sträcktider, per
klubb), utskrift och export (IOF XML, CSV). Utskrift är egen layout, inte
skärmlayouten.

### 4. Eventor och banfiler, även uppdateringar
Klasser och anmälningar (med bricka) hämtas från Eventor med klubbens
API-nyckel, som sparas krypterad på servern. Banor kommer från banfilen (IOF
XML från OCAD, Purple Pen, Condes). Båda kan läsas in igen när som helst:
appen visar skillnaderna (nya, ändrade, strukna) och arrangören godkänner dem.
Ändringar som påverkar resultat går genom samma besked och omräkning som
"Redigera bana" (ADR-0169). Detta lyfter Eventor ur parkeringen i ADR-0168.

### 5. Rogaining
Ny klasstyp med tidsgräns och poäng per kontroll. Löparen stämplar valfria
kontroller; resultat = summan av unika kontrollers poäng minus straffpoäng per
påbörjad minut över tidsgränsen. Sortering på poäng, sedan tid. Bedömningen
ligger i `packages/domain` bredvid den vanliga resultatmotorn.

## Konsekvenser

- Migration: tävlingstyp på tävlingen, poäng per kontroll, klasstyp för
  rogaining, Eventor-koppling per tävling.
- `PLAN.md` får steg 12–15.
