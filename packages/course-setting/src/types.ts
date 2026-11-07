/**
 * Steg 62–65 (ADR-0180): kontraktet för banläggningen i O-Tid. Ren TypeScript utan I/O; körs i arrangörens webbläsare
 * och i servern (överföring till tävlingen, senare PDF). Koordinater är kartfilens mm med y uppåt, samma som
 * `@o-tid/map-file`, IOF `MapPosition` och Purple Pens `location`.
 *
 * Modellen följer Purple Pens händelsefil (.ppen) nära, så att en fil kan läsas in, ändras och skrivas tillbaka utan
 * att något tappas: kontroller (`controls`), banornas kontroller som en länkad lista med gafflingar (`courseControls`),
 * banor, sträckor och specialobjekt. Det som O-Tid inte förstår ännu sparas orört i `raw` och skrivs tillbaka.
 * Purple Pen är BSD-licensierad (Peter Golde); se `NOTICE.md` i paketet för det som bygger på dess format och kod.
 *
 * Typerna ligger per område och samlas här, så att resten av paketet importerar från `./types`.
 */
export * from "./document-types";
export * from "./edit-types";
export * from "./check-types";
export * from "./overprint-types";
