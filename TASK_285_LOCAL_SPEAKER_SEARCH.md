# TASK285: lokal sökning i läst speakerunderlag

Status: genomförd och syntetiskt UI-verifierad 2026-10-01.

## Mål och gräns

Speakern ska snabbt hitta ett namn eller en klass inom redan hämtade
privata resultatuppdateringar och publika klassledare. En gemensam liten
sökrad filtrerar de två källorna var för sig och visar separata träffantal.
Den söker inte hela tävlingen, ändrar inte urvalets ordning, beräknar
ingen ranking och hämtar inte ledare automatiskt.

## Acceptans

- Lokal, skiftlägesokänslig delsträngssökning på namn och klass, med
  trimmad sökterm. Ingen ny dependency, API eller resultatlogik.
- Tydlig etikett ”Sök i läst speakerunderlag”, explicit begränsning
  och rensningsknapp. Ingen lagring av sökterm i Web Storage/URL.
- Båda källor har egna ”Visar X av Y”-antal först när de faktiskt har
  hämtats. Nollträff skiljs från tom/ohämtad källa; erbjuder rensning.
- Saknad källa, gamla uppgifter, separat lästid/cachevarning och
  sessionens fail-closed förblir synliga oberoende av sökfilter.
- Namn/klass från exakt befintligt underlag; ingen sammanslagning av
  personer med likalydande namn. Sessionfel/racebyte rensar lokal term.
- Behåll två platta desktopkolumner och mobilens layout/tryckytor.
- Utöka TASK284:s enda syntetiska browserfall för namn/klass, rensning,
  nollträff och ingen extra HTTP-trafik från sökning. Riktad webb-/E2E-
  lint/typecheck och build. Ingen ny testsvit eller DB-/hårdvarukörning.

## Arkitektur

Detta är en lokal presentationsfiltrering i befintlig läsvy. Inga
teknikval, domängränser, API-kontrakt eller behörigheter ändras; ingen
ny ADR behövs. Ingen serverbaserad global sökning, stafett, GPS eller
USB ingår.

## Genomfört

En liten sökrad filtrerar befintligt läst namn/klass med trimmad,
svensk skiftlägesokänslig delsträngsmatchning. Desktop har etikett,
sökfält och rensning på en rad; mobil behåller omflödning och minst
44 px tryckytor. ”Visar X av Y” finns för varje hämtad källa, inte
för ohämtad källa. Filtertomt underlag har egen förklaring och
gemensam rensning, skild från källa som faktiskt saknar resultat.

Ingen sortering, nätbegäran, sparning eller ranking infördes. Befintliga
records/slot-id och källornas ordning bevaras, även med likalydande namn.
Sessionfel och loppbyte rensar term; unmount tar bort lokalt React-state.
Gammalt underlag och källa/lästid ligger utanför filtervillkoret och
försvinner inte vid nollträff. Sol-agenten implementerade i de tre
befintliga UI-/i18n-filerna; huvudagenten förtätade desktopens sökrad.

## Exakta kontroller

| Kontroll | Resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json` | exit 0 |
| ESLint för `tests/e2e/task-167-payment-filter.spec.ts` med samma E2E-projekt | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK285` | exit 0, 1/1; slutkörning 4,0 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0; Next 16.3.3, 22 statiska sidor |

TASK284:s enda browserfall utökades. Det provar namn med ändrat
skiftläge och blanksteg, klass, matchning i en/båda källorna, nollträff,
rensning och frånvaro av ledarförhämtning. Browserklockan pausas för
att befintlig femsekunderspolling inte ska blandas ihop med nya
sökbegäranden; HTTP-räknaren är oförändrad under sökning/rensning.
Det bevarar också TASK284:s separata 503-varningar (även vid nollträff)
och personrensning/hidden search efter privat 403. Ingen oavsiktlig
write. Desktop-/mobilbilder vid 1280/390 px granskades.

Två körningar av samma fall passerade: först 7,7 s och därefter 4,0 s
efter desktopförtätning. Ingen ny testsvit, databas, riktig credential
eller hårdvara användes. Den befintliga rena ledarprojektionen ändrades
inte och dess tidigare test återkördes inte för denna filtrering.

## Kvarvarande antaganden

- Det är fortfarande högst 25 senaste privata resultathuvuden plus
  separat hämtade publika ledare, inte en serverbaserad deltagarsökning.
- Syntetisk browser är inte fysisk mobil-/fält-/skärmläsaracceptans;
  extrema långa namn/klasser och mycket stora ledarlistor återstår.
- Racebyte och söktermsrensning granskas i render/effect-koden men
  fick inget separat browserfall. Automatisk polling verifierades
  inte på nytt när testklockan var pausad.

Nästa minsta vertikala uppgift: läsande länk från en publik klassledare
till exakt publicerad deltagardetalj med befintligt publicResultId;
ingen namnbaserad koppling från privata speakeruppdateringar.
