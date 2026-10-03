# TASK103: papperslista från avprickningsmobilen

Påbörjad 2026-09-20.

## Användarvärde

Startpersonalen kan skriva ut samma filtrerade privata roster som mobilen
redan använder för offlineavprickning. Papperslistan gör det enklare att
arbeta vid en start där flera funktionärer delar ett underlag, utan att låtsas
att en markering på papper har synkats till systemet.

## Avgränsning

- Endast den redan upplåsta `START_CHECKIN`-roster som finns i den krypterade
  lokala vaulten får skrivas ut. Ingen ny hämtning, serverroute, data- eller
  domänskrivning tillkommer.
- Utskriften följer aktivt klassfilter och visar namn, klubb, klass, planerad
  start, brickvarning/-nummer och en tom pappersruta.
- Metadata visar att detta är en privat planeringslista, vilken roster-/tidszon
  den kommer från samt att pappersnoteringar inte överförs till systemet.
- Funktionen finns endast för startrollen. Målpersonalens skogsroster och
  synk-/resultatregler ändras inte.
- Browserns `window.print()` och komponentavgränsad print-CSS används. Ingen
  PDF-generator, filuppladdning, offline-cacheändring eller dependency.

Detta är ren presentation inom ADR-0053/0054 och TASK016:s redan accepterade
printprincip. Ingen ny ADR krävs eftersom ingen beständig modell, behörighet,
domänregel eller arkitekturgräns ändras.

## Acceptans

1. En upplåst startmobil kan öppna browserns utskrift utan nätanrop eller
   domänskrivning; knapp saknas för målrollen.
2. Printmediet visar endast den filtrerade, privata papperslistan med korrekt
   blandning av fri/minutstart, namn, klubb, brickvarning och tom ruta.
3. Skrivläge, inloggningsfält, synkknappar och återhämtningshemligheter syns
   inte i printmediet.
4. Mobil layout har ingen horisontell sidscroll. Fysisk skrivare, pagination
   och fältanvändning är separata senare acceptanser.

## Utfört och verifierat 2026-09-20

`CheckinRosterControls` visar nu knappen **Skriv ut aktuellt startunderlag**
enbart för upplåst `START_CHECKIN`. Den använder den redan laddade lokala
rosterprojektionen och det aktiva klassfiltret; tryck på knappen anropar endast
`window.print()`. Printmediet lämnar kvar en semantisk tabell med privat
underlag, roster-/tidszonsmetadata, namn, klubb, klass, planerad start,
brickinformation och en tom pappersnotering. Allt annat — inklusive
inloggningsfält, synk, skrivläge och återhämtning — döljs i printmediet.

Riktade kontroller med syntetiska browserdata:

```text
CI=true pnpm --filter @o-tid/web lint                                      exit 0
CI=true pnpm --filter @o-tid/web typecheck                                 exit 0
CI=true pnpm --filter @o-tid/web exec vitest run src/checkin/roster-controls.test.tsx
                                                                        1 fil / 5 test passerat
CI=true pnpm --filter @o-tid/web build:checkin                            exit 0
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.checkin-shell.json   exit 0
CI=true pnpm exec eslint tests/e2e/task-006w-shell.spec.ts tests/e2e/playwright.checkin-shell.config.ts ...
                                                                        exit 0
CI=true pnpm exec playwright test --config tests/e2e/playwright.checkin-shell.config.ts
                                                                        3 passerat (6,5 s)
CI=true pnpm --filter @o-tid/web build                                    exit 0
```

Browserfallet kör verkligt byggt shell på loopback, men interceptar enbart
syntetiskt HTTP-underlag. Det verifierar 390 px utan sidscroll, klassfilter,
fri/minutstart, brickvarning, print-only synlighet, att synkknapp döljs och
att print inte skapar ett syncanrop. Ingen fysisk skrivare, PDF, extern trafik
eller riktig person-/tävlingsdata används.
