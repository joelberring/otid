# TASK014 – En kompakt, sammanhållen tävlingsöversikt

Status: implementerad; verifieringsresultat i docs/status.md. Användarens uppdaterade
produktinriktning i CODEX_BRIEF §24 går före fortsatt PM-testinfrastruktur.
TASK013 är ofärdig, inte godkänd eller bortdefinierad.

## Användbart snitt

Arrangören öppnar befintlig privat tävlingsöversikt, ser centralt tävlingsläge
och hittar nästa åtgärd inom förberedelse, start, mål/resultat och publicering.
Befintliga funktioner ska vara nåbara utan en lång odifferentierad länklista.
Detta är första förbättringen av arbetsytan, inte full MeOS-funktionsparitet.

## Omfattning och gränser

- Web: race-overview-admin, svenska texter, lokalt avgränsad CSS och relevanta
  UI-tester. Befintliga routes, kontrakt och behörigheter används oförändrade.
- Grupperad funktionsnavigation, kompakt översikt och tydlig huvudåtgärd per
  arbetsområde. Kritisk status syns utan att behöva öppna en meny.
- Desktop utnyttjar tillgänglig bredd. Mobil behåller läsbarhet och tryckytor.
  Ingen dubblerad datahämtning eller ny klientpersistens tillförs.
- Ingen resultatlogik, migration, ny sessionsmodell, ny dependency, stafett,
  GPS, USB, skanneraktivering eller Eventoranrop ingår.
- MeOS används enbart som beteende-/funktionsreferens; ingen kod eller
  fil-/klassstruktur kopieras. Inga teknikval/domängränser ändras. Om en sådan
  ändring visar sig nödvändig krävs ADR före implementation.

## Proportionerlig acceptans

1. Alla befintliga funktionslänkar finns kvar och leder till rätt race.
2. Privat innehåll är fortsatt dolt före login och efter logout/authfel.
3. Tävlingsläge, nätstatus, uppdaterings-/felstatus behåller tydlig text;
   färg eller hopfällda områden får inte vara enda bärare av kritisk information.
4. Verifiera faktisk layout vid 1366×768 och 390×844: inga överlapp eller
   horisontell sidskroll, läsbara texter och tillgängliga kontroller. På desktop
   ska översikt och arbetsområdesval rymmas i första vyn med normalt testunderlag.
5. Befintliga relevanta UI-tester plus ett fokuserat navigations-/layoutprov;
   lint/typecheck och build inför samlad leverans. Ingen full PG-/hardware- eller
   scanneromkörning för en ren layoutändring.

Utveckla mot syntetiskt underlag. Befintlig privat tävling och gamla demos
databaser/credentials ska inte migreras eller ersättas implicit.
