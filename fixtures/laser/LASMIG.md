# Laserdata för tester

`kungshatt-300m.laz` är en ruta på 300 × 300 m (SWEREF 99 TM 664780–665080 öst, 6576500–6576800 nord) av Kungshatt i Mälaren,
klippt med `tools/lasclip` ur Lantmäteriets **Laserdata Nedladdning, skog** (ruta 21c031-657_66, skannad mars 2021, 239 966
punkter). © Lantmäteriet, CC BY 4.0. Lagd här med ägarens godkännande 2026-11-10 som testdata för grundkartan ur laser
(PLAN.md, steg K5 och projektdokumentet `plan-grundkarta-ur-laser.md`).

`kungshatt-300m/` är det Karttapullautin 2.15.4 ger för rutan med geo-arbetarens inställningar (`iniWith` i
`scripts/geo-worker.ts`: ekvidistans 5 m, formlinjer i läge 2, klassbilder för vegetationen): de sammanslagna DXF-filerna
(packade med gzip), höjdrastret `xyz2.hmap` och klassbilderna för grönt och undervegetation. Testet
`packages/map-revision/test/geo-real.test.ts` läser dem som geo-arbetaren och importen gör.

Görs om så här (Karttapullautin byggd ur källkoden vid taggen i `deploy/geo.Dockerfile`):

```bash
mkdir -p /tmp/kp/in && cp fixtures/laser/kungshatt-300m.laz /tmp/kp/in/ruta00.laz && cd /tmp/kp
# pullauta.ini: iniWith(pullauta.default.ini, { contour_interval: 5, formline: 2 }, true, true)
pullauta && pullauta pngmerge 1 && pullauta dxfmerge
```

Med `OTID_PULLAUTA`, `OTID_PULLAUTA_INI` och `OTID_LASCLIP` satta kör testet också hela kedjan på riktigt och jämför med filerna här.
