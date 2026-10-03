# TASK241: neutral, avgränsat zoomningsbar publik karta

Status: genomförd 2026-09-27.

## Användarutfall

En oinloggad besökare ska kunna öppna den publicerade tävlingskartan på
mobil, padda eller dator och se tävling, karttitel och nästa handling
utan dominerande grön sidkrom. Kartan ska kunna granskas i detalj utan
att råka dras helt ur sikte eller hindra vanlig sidsvepning.

## UI-beslut före implementation

Ge endast `/results/[raceId]/map` en lågmäld ljus/grå sidlayout som
TASK236–240: kompakt rubrik, tävlingskontext och länk tillbaka. Visa
den redan offentliga karttiteln som text. Färg behövs inte för en
normal karta; knappar och avdelare är neutrala. Ingen global palett
eller annan karta ändras.

Byt den äldre obundna CSS-transformen/pointer capture och
`touch-action:none` mot en fokuserbar, namngiven kartyta med native
overflow. Bildens naturliga proportioner ska bevaras; 1× passar
tillgänglig bredd utan horisontellt sidspill. Textmärkta svenska
kontroller zoomar 1×–4×, visar procent, spärrar ändlägen och återställer
helkartan. Förstora bildens faktiska layoutbredd så pan kan ske med
vanligt touch-svep och piltangenter när kartyta har scrollutrymme.
Bevara synligt centrum inom scrollgränserna. När kartbilden misslyckas
efter sidladdning ska ett textbundet fel visas och oanvändbara
zoomverktyg döljas. Print ska visa hel kartbredd oberoende av skärmzoom.

Behåll exakt serverresolverad bildväg `/api/public/races/{raceId}/map`,
sidans befintliga metadata/not-found-gräns, private-by-default och
inga interna lagrings-ID:n i publik HTML. Ingen ny dependency,
datamodell, publiceringsregel, API, domängräns eller teknik ändras;
ingen ADR behövs.

## Riktad acceptans

Med syntetisk kartbild: 320/390/1280 px har 1× rätt proportioner och
ingen horisontell sidspill; 2×/4× får verkligt större scrollbar bild
utan obunden position. Återställning, tangentbord, centrum, spärrlägen,
namn/fokus och print fungerar. Bildfel visar besked och inga
kartverktyg. Uppdatera befintligt TASK106-browserförväntan från
transformsträngar till den nya interaktionen; den är DB-bunden och
får inte köras utan isolerad PostgreSQL. Ett litet separat syntetiskt
browserprov, riktad lint/typecheck och webbuild räcker här.

## Ingår inte

Kartutgåva, georeferens, OMAP-import, ruttöverläggning, GPS-live,
kartprecision, offlinecache, ny publicering eller fysisk
touch-/fältacceptans.

## Utfall

Publik kartvy har nu kompakt, neutral tävlingskontext och karttitel.
Den faktiska kartbilden bevarar proportionerna, förstoras inom en
fokuserbar och rullbar yta 1×–4×, kan panoreras med piltangenter och
återställs till helkarta. Laddning spärrar zoom tills bilden är klar;
bildfel ger textbesked. Print passar helkartan. Befintligt TASK106-prov
förväntar sig nu scrollbaserad zoom i stället för CSS-transform.

Verifiering: webblint, webtypecheck, E2E-TypeScript för visuellt och
TASK106-kartprov, riktad E2E-ESLint och Next-build gav exit 0.
`map-asset-ui.test.tsx`: 3/3; syntetiskt monterat browserprov:
3/3; hela publika visuella sviten: 12/12. Skärmbilder granskade vid
320/1280 px. Det databasbundna TASK106-provet kördes inte utan
uttryckligen isolerad PostgreSQL. Ingen fysisk touch, verklig kartbild
eller publiceringsgrind verifierades här.
