# TASK114: privat trepunktsgeoreferens för exakt rasterkarta

Status: implementerad och riktat verifierad enligt ADR-0124.

## Användarvärde

Arrangören kan spara och granska en spårbar, matematisk kalibrering av en
specifik privat rasterkarta. Det är förutsättningen för att senare kunna visa
en rutt på rätt plats, utan att visa eller publicera någon rutt nu.

## Avgränsning

- Additiv immutable georeferensjournal, alltid race-scopad och bunden till
  exakt lagrad PNG/JPEG-manifestversion.
- Endast `MANAGE_RACE`, privat admin-POST/GET och svensk, kompakt adminyta.
- Endast `EPSG:4326`, exakt tre tie points och en affinitet i pixel→lon/lat.
- Servern validerar dimensionsgränser, WGS84, icke-kollinearitet,
  inverterbarhet, numerisk tie-point-residual och exakt idempotent retry.
- Nyare kalibrering appendas; tidigare kalibrering och kopplad kartversion
  skrivs aldrig över.

## Acceptans

1. Saknat/ogiltigt manifest, annan race, fel mediatyp, felaktig bildextent,
   kollineära punkter, icke-inverterbar transform eller för stor numerisk residual
   avvisas utan journalrad.
2. Samma request-id/aktör/intent återger exakt samma georeferens; annat intent
   eller aktör konflikterar. Samtidiga requests får en monoton revision.
3. Privat adminläsning visar enbart den exakta manifestkopplingen och
   georeferensbeviset. Publika kart- och resultatrutter saknar fortsatt dessa
   fält.
4. Syntetiska WGS84-punkter klarar framåt- och inverterad transform inom
   dokumenterad numerisk tolerans.

## Utanför uppgiften

- OMAP/GeoTIFF/PDF-import eller rendering, automatisk CRS-tolkning, flerpunkt-
  eller robustpassning, tiles, kontroll- och banpåtryck, privat/publik
  ruttvisning, GPS-live, tidslinjering, analys, stafett, USB och hårdvara.
