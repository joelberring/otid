# ADR-0199: Banläggningens varningar – nivåer, förbjudna områden med vägval och godtagna varningar

Status: beslutad 2026-11-03 (grenen `varningar`, ägarens önskemål samma dag). Bygger på ADR-0180 beslut 9 (kontrollerna
under arbetet), steg 64 (förbjudna områden och spärrar) och ADR-0179 (vägvalen i webbläsaren). Ändrar dokumentet: nytt fält
`event.acceptedChecks` och åtgärden `SET_ACCEPTED_CHECKS`. Ingen migration (dokumentet är jsonb).

## Bakgrund

Ägaren: "hur släcker/accepterar man varningar? att sträck passerar förbjudna områden är tex inget ovanligt om det finns
vägval runt". Fliken Varningar visade elva rader av typen "A: sträckan kontroll 38–kontroll 40 går genom ett förbjudet
område", samma sträcka en gång per bana, och det gick inte att godta något. Kontrollen prövade bara fågelvägen.

## Beslut

1. **Tre nivåer** (`checkLevel`), visade som ord och färg, i ordningen fel, varning, notis och grupperade per sort med antal:
   - Fel: samma kod på flera kontroller, kod saknas, bana utan start eller mål, kontroll i ett förbjudet område, sträcka utan
     laglig väg (vägvalet med spärrarna hittar ingen väg).
   - Varning: för nära (under riktvärdet, eller samma slags objekt under granskningsgränsen), kod som kan läsas upp och ned,
     samma kontroll två gånger i rad, sträcka genom en annan ring.
   - Notis: nära med okänt objekt (kolumn D saknas), oanvänd kontroll, fågelväg genom ett förbjudet område när vägvalet inte är
     räknat.
   Fliken räknar fel och varningar som inte är godtagna; notiser räknas inte.
2. **Förbjudna områden prövas med vägvalet.** En fågelväg genom ett område är ingen varning när vägvalet (räknat med
   banläggningens spärrar, `LegInput.barriers`) går runt; den visas i stället i Vald sträcka: "Fågelvägen korsar ett förbjudet
   område – vägvalet går runt (+182 m)". Ingen väg = fel. Inte räknat = notis. Spärrarna i vägvalen är ej passerbara, så en väg
   kan bara gå genom ett område om en kontroll ligger i det; det prövas geometriskt (`CONTROL_IN_FORBIDDEN`, alltid fel) och
   sträckorna till och från den kontrollen räknas inte en gång till.
3. **Vägvalen räknas i den befintliga Workern och tabellen.** Bara sträckor vars fågelväg korsar en spärr räknas, en gång per
   indata (samma sträcka och spärrar på flera banor är en). Svaren delas med banans längd och vald sträcka (`useRouteResults`).
   Körningen startar när Workern är ledig och viker för vald sträcka och banans längd (`cancelled` på sessionen). På datorn
   räknas de utan att fliken är öppen; i telefonen bara med fliken öppen, eftersom Workern är det tyngsta i editorn.
4. **Samma fysiska sak är en rad.** Nyckeln (`checkKey`) har ingen bana för sträckor och kontroller ("A, B, C: sträckan …"),
   och ett godtagande gäller alla banor och varianter där den finns (också nya banor och gafflingsvarianter).
5. **Godta sparas i dokumentet**, i `event.acceptedChecks` (nyckel → lägena för det den gäller när den godtogs: kontroller
   `c:<id>`, specialobjekt `s:<id>` som mittpunkt). Åtgärden `SET_ACCEPTED_CHECKS` sätter eller tar bort nycklar, så två som
   godtar olika varningar samtidigt inte krockar (touches per nyckel). Ångra, versioner och autospar som för andra fält.
6. **Ett godtagande gäller tills det den gäller verkligen ändras:** en kontroll eller ett område som byts ut (nytt id ger ny
   nyckel), eller något som flyttas mer än 25 m (`ACCEPT_MOVE_METERS`) från där det var när varningen godtogs. Nyckeln för
   för nära har gränsen, så två kontroller som kommer under riktvärdet visas igen. En sträcka utan väg har en annan nyckel än
   notisen om fågelvägen, så att godta notisen inte döljer felet.
7. **Fel som stoppar tidtagningen eller överföringen går inte att godta**: samma kod, kod saknas, bana utan start eller mål.
8. **.ppen har inget fält för det.** Godtagandena skrivs inte till .ppen. När en ny .ppen läses in följer de med som har kvar
   alla sina kontroller och specialobjekt (Purple Pens id), `keepAcceptedChecks`.

## Följder

- Fliken Varningar har grupper med rubrik och antal, "Godta" per rad, "Godta alla n" per grupp och de godtagna hopfällda under
  "Godtagna (n)" med "Ångra". Ett klick på en sträcka väljer den på banan (vägvalet visas i Vald sträcka).
- Visa på kartan har "Kollade kontroller", "Notiser" och "Markera varningar" (per webbläsare, på som förval).
