# TASK283: vald deltagare även vid detaljscroll

Status: genomförd och syntetiskt UI-verifierad 2026-10-01.

## Mål och gräns

Funktionären ska veta vems kontroller, resultat eller historik som visas
när desktopens detaljpanel scrollas. En liten neutral identitetsrad
visar befintligt namn och klass inom panelen, inte i sidans globala topp.
På mobil följer raden dokumentflödet; ingen ytterligare fast toppyta.
Inga API-, domän-, behörighets- eller teknikval ändras, varför ny ADR
inte behövs. Befintliga deltagarfakta och skrivspärrar bevaras.

## Acceptans och verifiering

- Namn och klass kommer från exakt vald deltagare och läst klassregister;
  ingen egen kopia eller nätbegäran för identitetsraden.
- Raden finns bara när deltagare är vald och inte vid direktanmälan,
  tomt urval eller utloggning. Nytt deltagarval uppdaterar sammanhanget.
- Desktoprad är sticky endast inom befintlig scrollpanel; långa namn
  får radbrytas utan horisontell scroll eller ellips som döljer identitet.
- Neutral typografi, tunn avdelare, ingen extra åtgärd eller signalstatus.
  Mobilrad är statisk. Fokus på befintliga åtgärder får inte täckas.
- Återanvänd TASK281:s enda syntetiska browserfall för scroll och
  deltagarbyte vid 390/1280 px. Riktad E2E-typkontroll/lint, webblint,
  webbtypkontroll och build; ingen ytterligare DB-/hårdvarusvit.

## Ingår inte

Ny deltagareditor, resultatberäkning, historikmodell, navigation,
globala sticky-rubriker eller fysisk fältacceptans.

## Genomfört

WORK-panelen visar en liten namngiven region ”Vald deltagare” med namn
och klass från befintligt valt underlag. Raden innehåller ingen knapp,
resultatlogik, lokal datakopia eller nätbegäran. Den försvinner vid tomt
urval, direktanmälan och utloggning via den befintliga renderingsgränsen.
Desktop har panelintern sticky-rad, neutral bakgrund och tunn avdelare;
mobil har statisk rad. En glipa ovanför sticky-raden som upptäcktes i
bildgranskningen togs bort med sidlokal desktop-CSS. Inga globala ytor,
behörigheter eller skrivspärrar ändrades. Sol-agenten gjorde den
avgränsade implementationen; huvudagenten granskade och förfinade den.

TASK281:s enda syntetiska browserfall utökades, inte en ny svit. Det
verifierar raden utan valt urval, vald Åsa/klass, statisk mobilposition,
desktopscroll med raden kvar vid panelens överkant, byte till Bo,
explicit klasseditor och frånvaro vid ny direktanmälan. Det befintliga
fakta → resultat → kontroller-testet och noll oavsiktliga skrivningar
behölls. Mobilbild och desktopbild efter scroll granskades.

## Exakta resultat

| Kontroll | Resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json` | exit 0 |
| ESLint för `tests/e2e/task-167-payment-filter.spec.ts` med samma E2E-projekt | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK283` | exit 0, 1/1; slutkörning 7,7 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0 efter sista CSS-ändringen; Next 16.3.3, 22 statiska sidor |

Browserfallet kördes två gånger: första exit 0 och sista exit 0 efter
glipjusteringen. Agentens vanliga pnpm-försök utan CI avbröts före
kontrollerna av workspace-/offlinemiljön; direkt installerade verktyg
och huvudagentens ovanstående CI-kommandon passerade. Ingen databas,
riktig credential, hårdvara eller annan browser-/testsvit användes.

## Kvarstående antaganden

- Syntetisk browser vid 390/1280 px är inte fysisk mobil-/fältacceptans.
- Radbrytning tillåts i CSS utan ellips, men extrema namn/klassnamn,
  förstoring och skärmläsare har inte testats här. Desktopens enda
  5rem-scrollpadding är ett konservativt fokusutrymme för normal
  radbrytning, inte ett bevis för godtyckligt hög text eller alla
  webbläsares fokusscroll. Ingen ny JS-mätning infördes.
- TASK167:s äldre breda fall har fortsatt tidigare dokumenterad
  mobilnavigationsdrift; dess DOM-ordningsförväntan uppdaterades men
  det kördes inte som ersättning för det riktade fallet.

Nästa minsta vertikala uppgift: granska och förtydliga en enda kompakt
speakeröverblick så att ledare, felstämplade och saknat resultatunderlag
går att skilja med text och få signalfärger utan extra stora statuskort.
