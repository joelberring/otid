# Status

Kort logg. Högst tio rader per steg. Nyaste överst. Historik före omstarten
finns i `docs/archive/status-2026-10-03.md`.

## Aktuellt steg

Steg 1 – Två behörighetsnivåer (se `PLAN.md`). Steg 3 är gjort separat.

## Logg

### 2026-10-03 – Steg 3 klart (gjort före steg 1–2, oberoende av dem)
- Nytt paket `packages/sportident`: ramtolkning med CRC, tillståndsmaskin för avläsningsstation,
  avkodning av SI5/6/8/9/10/11/SIAC/pCard, tidstolkning med tidszon samt `FakeSiStation`.
- 55 tester: alla chunkgränser, fel CRC/ETX, trunkering, dubbletter, alla bricktyper, uttagen bricka,
  tidsgräns, station utan handskakning, fel inställd station, AM/PM, midnatt, vintertid.
- CRC verifierad mot publicerade ramar. Minneslayouterna är jämförda mot en oberoende öppen avkodare
  (bara som referens, inte kopierad): allt stämmer utom SI6-kontrollkoder >255, där referensen har fel.
- Hårdvara: alla rader `untested` i `docs/sportident.md` tills steg 7.

### 2026-10-03 – Steg 0 klart
- Git och GitHub (`joelberring/otid`). TASK-filer, gamla status- och plandokument är flyttade till `docs/archive/`.
- **Fel i migreringarna:** drizzles migrator kör allt i en transaktion, och PostgreSQL vägrar då använda nya
  enum-värden. `pnpm db:migrate` kraschade på ny databas och vid uppgradering över flera migrationer.
  `@o-tid/database` har nu en egen `migrate` som committar enum-värden först och sedan kör en transaktion per fil.
- Borttaget (parkerat enligt ADR-0168, testerna krävde macOS): backup/replikering och PM-skannerns Docker-isolering.
- Röda tester som var föråldrade är rättade: formatversioner 10/12/14 → 15, motorversion 0.1.1, ett tidsberoende
  test (TASK160), ett för strikt namnkrav på testdatabas (TASK153), kortbyte med extra fält (TASK030), TASK300/301.
- Gröna: lint, typecheck, `pnpm test`, `pnpm test:integration` (ett test om begränsade roller hoppas över tills steg 1), `pnpm build`.
- **Webbläsartester:** `pnpm test:e2e` går inte att köra som helhet. Det finns 38 separata Playwright-konfigurationer
  och flera specar kräver egna databaser och miljövariabler. Läget för adminflödet finns nedan. Konsolideras i steg 1 och 5.
- CI kör nu lint, typecheck, test, integration och build. Android-jobbet är borttaget (parkerat).

### 2026-10-03 – Omstart
Granskning visade 301 uppgifter på fem veckor men ingen riktig brickavläsning,
en Android-app som aldrig byggts och för mycket behörighetsmaskineri.
Ägaren beslutade om ny plan (`PLAN.md`) och ADR-0168: ett mål (körbar
klubbträning), avläsning i webbläsaren via Web Serial, eget SPORTident-protokoll
nu, två behörighetsnivåer (admin och alla andra) och parkering av GPS,
deltagarkonton med mera. `AGENTS.md` har bantats från 210 KB. Den gamla finns i
`docs/archive/AGENTS-2026-10-03.md`.

Kvarstår för ägaren: begära *PC Programmer's Guide* från SPORTident
(support@sportident.com), välja server för drift (steg 6), skaffa station och
brickor till steg 7.

## Idéer (inte i planen än)

- …
