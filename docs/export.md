# Export av en tävling

Inställningar → "Exportera tävlingen" (bara administratör) ger en fil `otid-<namn>-<datum>.json` med allt om ett lopp
(PLAN.md steg 27). Den är en säkerhetskopia och underlag för en senare import; import finns inte än.

```json
{ "format": "otid-race-export", "formatVersion": 1, "exportedAt": "…", "engineVersion": "0.5.0",
  "event": { … }, "race": { … }, "controls": [ … ], "courses": [ … ], … }
```

- Raderna är databasens rader som de är (kolumnnamn i snake_case, tider i ISO 8601 med tidszon), en array per avsnitt.
- Avsnitt: `controls`, `courses`, `courseVersions`, `courseControls`, `courseVariants`, `courseVariantControls`, `classes`,
  `classControlNeutralizations`, `relayLegs`, `teams`, `entries` (även strukna, `struck_at`), `cardAssignments`,
  `startDraws`, `startDrawClasses`, `startDrawSlots`, `startListPublications`, `rawReadouts` (oförändrade nyttolaster med
  råa ramar i hex), `cardReadouts`, `readoutOutcomes`, `readoutRegistrations`, `unknownReadoutResolutions`,
  `resultRevisions`, `resultFinalizations` (med fastställd IOF XML), `radioControls`, `radioLink`, `radioPunches`, `maps`
  (bilden i `image_base64`), `mapSources` (kartfilen från OCAD eller Mapper i `file_base64`, steg 59), `participantRoutes` (GPX i `gpx_base64`), `eventorLink` och `auditEvents`.
- Med: personuppgifter om deltagarna (namn, klubb, bricka). Filen ska hanteras som tävlingens övriga uppgifter.
- Inte med: klubbens krypterade Eventor-nyckel, konton, lösenord och sessioner (konton finns bara som id).
- `formatVersion` höjs när ett avsnitt eller en kolumn ändrar betydelse. Nya kolumner kan komma utan ny version.
