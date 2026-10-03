# TASK186: öppna lokal testtävling utan manuell inloggning

Status: klar 2026-09-24. ADR-0162 dokumenterad före kod.

Automatisk normal administratörssession endast för valt lokalt demolopp.
Ingen nyckel i browser, ingen auth-bypass i skyddade endpoints, ingen ändring
av tävlingsdata. En liten riktad testfil för miljö-/origin-/loppgrind,
sessionåterbruk och normala cookies, web-typecheck/lint/build samt manuell
läsande kontroll i den redan öppna demobrowsern. Ingen bred testsuite.

## Levererat

Vald lokal demo öppnar `/manage` utan manuell nyckel. Vid sessionsutgång
räcker omladdning eller knappen Öppna testtävlingen. Opt-in ligger i lokal,
ignorerad `apps/web/.env.local`. Vanlig auth, audit, CSRF och sessionsutgång
är kvar; inga skyddade API-writers ändrades. Endast åtkomst-/sessions-/
auditrader tillkom vid kontrollen. Ingen migration, seed eller tävlingsändring.

## Exakta slutresultat

Kommandon från repositoryroten om inte annat anges:

```bash
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/eslint/bin/eslint.js apps/web/src/lib/development-demo-access.ts apps/web/src/lib/development-demo-access.test.ts 'apps/web/src/app/api/admin/races/[raceId]/administrator/development-session/route.ts' apps/web/src/components/race-administrator-workspace.tsx 'apps/web/src/app/admin/[raceId]/manage/page.tsx' apps/web/src/i18n/race-workspace-navigation-sv.ts packages/application/src/index.ts
```

Båda **exit 0**. Slutlig build körde dessutom TypeScript efter sista rättningen.
Från `apps/web`:

```bash
node ../../node_modules/vitest/vitest.mjs run src/lib/development-demo-access.test.ts
DATABASE_URL=postgresql://build:build@127.0.0.1:1/build node node_modules/next/dist/bin/next build
```

Tester: **1 fil, 6/6 passerade, 3,06 s, exit 0**. Produktionsbuild: **exit 0**,
kompilering 2,6 s, TypeScript 3,2 s, 22 statiska sidor. Bygg-URL är endast en
syntetisk icke-anslutande placeholder; ingen riktig databas används av bygget.

Browserkontroll på befintlig lokal demo: omladdning gav automatiskt
**O-Tid syntetisk demonstration**, dess tävlingsöversikt, 2 deltagare och
3 klasser utan lösenordsfält/nyckelinmatning. Ingen deltagare ändrades.
Produktionsspärren provas i riktat enhetstest; ingen separat produktionsserver
eller full äldre regression kördes.

Mellanliggande fel: browsern visade Nexts modulfel medan agentfilen ännu
skrevs (felaktig direktimport togs bort). Första färdiga anropet gav 403:
Next normaliserade intern request-URL trots rätt inkommande Host/Origin.
Rättat att validera de två inkommande adressfälten; ett av de sex testen
täcker nu denna Next-normalisering. Ett testkommando med fel lokal sökväg
gav MODULE_NOT_FOUND/exit 1, sedan rättat till workspacebinären ovan.

## Antaganden och avgränsning

- Servern förblir loopbackbunden och exponeras inte via tunnel/proxy.
- Bara explicit valt demolopp, inte andra tävlingar, konton eller separata roller.
- Giltiga sessioner återanvänds; inga skrivförsök återspelas vid förnyelse.
- Ingen timslång browserväntan för verklig sessionsutgång kördes; befintlig
  utgångshantering är oförändrad och knappen anropar samma fungerande öppning.

Nästa minsta uppgift: återstående TASK183, tätare filter-/verktygsyta så minst
fem deltagarrader syns på 1280×800. Ingen ny backendfunktion i nästa UI-snitt.
