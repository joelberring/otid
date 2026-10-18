# Domänregler

Gäller från steg 23. Äldre version med regler per TASK och capabilitytabeller:
`docs/archive/domain-rules-2026-10-18.md`. Koden för reglerna finns i `packages/domain`.

## Modellgränser

- `Event` är arrangemanget; `Race` är en tävling (ett lopp) inom arrangemanget.
- `Class` hör till ett lopp och pekar på en bestämd `CourseVersion`.
- `Course` är den stabila identiteten. `CourseVersion` är append-only och äger en ordnad följd
  `CourseControl` som pekar på `Control`. En gafflad bana har varianter per version.
- `Entry` är deltagandet i ett lopp, inte personen. Stafettens sträcklöpare är en `Entry` per sträcka i ett lag.
- `CardAssignment` kopplar ett bricknummer till en `Entry` för loppet (`is_rental` markerar hyrbricka).
- `NormalizedCardReadout` är en tolkad representation av oföränderlig rådata (`raw_device_message`).
- `ResultRevision` är en append-only lagrad bedömning med orsak, motorversion och underlag.

Alla interna identiteter är UUID. Externa identiteter (Eventor, IOF) lagras med källsystem och används aldrig
som primärnyckel.

## Resultatutvärdering

`evaluateCardReadout(readout, snapshot)` gör ingen I/O och läser inget globalt tillstånd. Den kräver bara
bricknummer, valfri start- och målstämpling och stämplingar.

1. Aktiv brickkoppling saknas: `UNKNOWN_CARD`; inget tävlingsresultat skapas. Den lagrade avläsningen kan
   sedan kopplas uttryckligen (direktanmälan eller befintlig deltagare); kopplingen lägger till en revision
   och ändrar aldrig råmeddelandet eller den första bedömningen.
2. Starttid väljs från startstämpling när klassens startsätt är `PUNCH`, annars från deltagarens fasta
   starttid.
3. Målstämpling krävs för en sluttid. Saknad start eller mål ger `MP` med stabil förklaringskod.
4. Kontroller matchas som en ordnad delsekvens. Extra stämplingar ignoreras för godkännandet men redovisas.
5. Saknad obligatorisk kontroll ger `MP/MISSING_CONTROL`.
6. En obligatorisk kontroll som är stämplad men bara utanför sin plats i följden (före föregående matchade
   kontroll eller efter en senare obligatorisk kontroll) ger `MP/WRONG_ORDER`. En extra stämpling av en
   kontroll som också finns på rätt plats påverkar inte bedömningen (motor 0.3.0, PLAN.md steg 22).
7. Om banan kräver samma kod flera gånger måste lika många förekomster matchas i rätt ordning. Övriga
   förekomster (även dubbelstämplingar vid kontroller som återkommer i fjärilsslingor) redovisas som extra.
8. Ett godkänt resultat får status `OK`; löptid och sträcktider räknas i hela millisekunder från vald start
   till kontroller och mål.

Motorn returnerar stabila koder. Svenska texter hör till `apps/web/src/i18n`. Avläsningsskalet kör samma
funktion lokalt; dess besked är preliminärt och serverns revision är auktoritativ.

## Statusbeslut

- Arrangören kan sätta ej start, ej fullföljt, disk, utom tävlan, utan tidtagning, godkänt manuellt samt
  ändra start- eller sluttid. Varje beslut lägger till en ny revision med orsak och aktör.
- Ett återtagande är också en ny revision; den återställer det tidigare utfallet men räknar inte om.
- Ett beslut mot ett underlag som har ändrats sedan formuläret öppnades avvisas (konflikt), och
  arrangören får se det nya läget.
- Fastställda resultat fryses per klass eller tävling. Senare revisioner ändrar inte en fastställd export.

## Revisionsregler

- En ny avläsning skapar en ny revision när brickan är känd.
- Ändrad bana, redigerad klass, ny lottning och ändrad starttid räknar om berörda löpares avlästa resultat
  med en ny revision (`EXPLICIT_RECALCULATION`) och en auditpost; tidigare revisioner skrivs aldrig om.
- Revisionen lagrar motorversion, snapshotversion, banversion och orsak.
- Placering och tid efter lagras inte; de härleds från de senaste publicerade revisionerna i klassen.
- Samtidig mottagning och omräkning serialiserar nästa revisionsnummer per deltagare (deltagarraden låses).

## Import

- IOF `EntryList` innehåller anmälan men ingen starttid, och `CourseData` klass–bana men inget startsätt.
  Nya klass–ban-kopplingar börjar därför som `PUNCH`.
- En individuell `StartList` får sätta klassen till `FIXED` och varje täckt deltagares starttid (med
  UTC-offset). Namn används aldrig som identitet.
- Dubbla klass- eller bannamn i samma tävling avvisas.

## Immutabilitet

Applikationslagret erbjuder ingen ändring eller borttagning av råmeddelanden, banversioner,
resultatrevisioner, importfiler eller journaler. Databasen avvisar `UPDATE` och `DELETE` på dessa tabeller
med triggers. Enda undantaget är superadminens borttagning av en hel tävling eller ett konto, som körs med
purge-flaggan (`otid.purge`) i samma transaktion.

## Publik resultatidentitet

`Entry.publicResultId` är en slumpmässig, stabil visningsidentitet för en publik resultatlänk. Den är inte
Entryns interna UUID, bricka eller behörighet. Publika svar väljer uttryckliga fält; interna id:n, rådata och
audit ingår aldrig.
