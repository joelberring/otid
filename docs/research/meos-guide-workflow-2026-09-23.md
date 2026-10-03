# MeOS 5.0-handboken som arbetsflödesreferens, 2026-09-23

Läsande jämförelse av [den officiella MeOS 5.0-handboken](https://www.melin.nu/meos/sv/show.php?base=156&id=5400),
[funktionsbeskrivningen](https://www.melin.nu/meos/sv/features.php),
[avsnittet om lag och gafflingar](https://www.melin.nu/meos/sv/show.php?base=5400&id=5472)
och [allmänna råd](https://www.melin.nu/meos/sv/show.php?id=5506).
Detta är beteende- och behovsresearch. Ingen MeOS-kod, UI-struktur, textmall
eller branding återanvänds. Vissa underavsnitt gick inte att hämta i denna
webbläsningsmiljö; deras detaljer antas inte.

## Vad guiden gör begripligt

- Handboken börjar med ett litet arrangemangs väg från förberedelse
  (deltagare, klasser, banor, lottning, hyrbrickor) till genomförande
  (avläsning, rättning, listor och kvar-i-skogen). Större arrangemang,
  speaker, lag/stafett/gaffling och specialformat får egna avsnitt. Det
  beskriver **när** en funktion behövs, inte bara att den finns.
- Funktioner som saknar relevant tävlingsunderlag eller valts bort visas inte
  överallt. Det är ett beteendemönster för begriplig komplexitet, inte en
  instruktion att kopiera MeOS skärmar.
- Guiden skiljer uppgifter på ett objekt, exempelvis en deltagares namn/klass/
  bricka, från operationer som lottning eller export. Den beskriver även ett
  tabelläge för att överblicka och sortera många deltagare. O-Tid bör behålla
  sin egen revisions-/bekräftelsemodell för konsekvensfulla ändringar.
- MeOS beskriver uttryckligen att vanliga individuella klasser och
  lag-/gafflingsklasser kan samexistera. O-Tid stöder ännu inte stafett eller
  gaffling som tävlingsform; en ny flik kan inte skapa det stödet.

## Jämförelse med nuvarande O-Tid

`/admin/{raceId}/manage` visar nu en statusremsa men därefter en lång följd
av kurs-/resultaträttningar, okända avläsningar, skogsrapport, startpublicering,
export och först därefter deltagarlistan. Den valda deltagarens kontokoppling
med engångskod syns före aktuell resultatsammanfattning. Många funktioner
finns alltså, men vanliga frågor — *vem är anmäld, vilken klass/start/bricka
har personen, vad är status, vad gör vi nu?* — får inte första plats.

Första självständiga O-Tid-förbättringen är en kompakt statusrad och ett
förvalt deltagarläge, följt av tydliga arbetslägen **Före**, **Under** och
**Efter tävlingen**. Befintliga operationer grupperas utan att deras
behörighet, transaktion, resultatregel eller retry ändras. Kontokoppling
förklaras som en separat frivillig uppgift för att visa personliga resultat,
inte som ett krav för tävlingsadministration eller offentlig resultatläsning.
En pågående granskning/retry får aldrig döljas av lägesbytet. Nästa snitt
behöver därefter göra deltagarrad/detalj mer informationstät utifrån redan
serverbevisade fält, inte lägga till påhittad data.

Stafett och gaffling prioriteras som öppna produktluckor i
[funktionsmatrisen](../meos-feature-matrix.md). De kräver vald ordning,
eget ADR/domänfacit och en representativ hel tävling; de får inte etiketteras
som stödda av navigationsarbetet. Fysisk SPORTident- och pilotgrind kvarstår.
