# ADR-0099: Resultatets aktualitet i administratörens deltagarlista

- Status: Accepterad
- Datum: 2026-09-18
- Uppgift: TASK070

## Kontext

Den gemensamma administratörsvyn visar ett resolverat gällande resultat först
när en deltagare väljs. Efter en snapshot-höjande ändring behöver
administratören kunna hitta deltagare med äldre gällande resultat direkt i
listan utan ett GET-anrop per rad.

Senaste lagrade eller senaste publicerade revisionsnummer är inte tillräckligt
som sanning. Ett aktivt manuellt beslut kan fortsatt styra över en senare
teknisk revision, och ett återtaget DNS-resultat kan ge inget aktivt resultat.

## Beslut

`entryTransferCandidates` får ett serverhärlett `resultFreshness` per entry:

- `NO_PUBLISHED_RESULT`: ingen publicerad revision är vald.
- `NO_ACTIVE_RESULT`: vald publicerad revision resolverar till återtaget
  resultat utan aktivt utfall.
- `CURRENT_SNAPSHOT`: det resolverade aktiva huvudet har samma snapshot som
  loppet.
- `OLDER_SNAPSHOT`: det resolverade aktiva huvudet har lägre snapshot än
  loppet.

Endast `OLDER_SNAPSHOT` visas som den textbundna badgen "Äldre resultat".
Värdet är rådgivande: det säger inte vilken ändring som gjorde resultatet
äldre, att resultatet måste räknas om eller att ett manuellt styrt
publikresultat kommer att ändras.

Application väljer senaste publicerade revision per entry och resolverar alla
valda huvuden i bulk med den centrala `resolveStoredResultHeadStates`. Samma
repeatable-read och låsta race-snapshot som rosterläsningen används. Ingen
enskild effective-result-route anropas i en loop. Resultathuvud från framtida
snapshot, trasig provenance, främmande entry eller för stor beslutshistorik
avvisas; vyn får inte fabricera `CURRENT_SNAPSHOT`.

Den befintliga rostergränsen 10 000 entries gäller även bulkprojektionen.
Beslutstabeller läses begränsat före resolvering så att den kompakta
operatörsvyn inte blir en obunden historikexport. Inga råavläsningar,
beslutspayloads eller credentials exponeras.

## Konsekvenser

Kontrakt, application-läsmodell och webb påverkas. Ingen migration, ny route,
behörighet, resultatrevision eller automatisk omräkning tillkommer. Markeringen
uppdateras vid befintlig rosterrefresh och är serverkunskap från den angivna
snapshoten, inte livebevakning eller finalisering.

Återställning: ta bort fältet och badgen; resultat- och beslutshistorik är
orörd. ADR-0074 fortsätter styra detaljkortet och exakt effektivt resultat.

