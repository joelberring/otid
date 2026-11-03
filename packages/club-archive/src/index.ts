/**
 * ADR-0194: klubbarkivets import. De rena delarna (mappnamn, taggar, filernas slag, kartornas grupper, .ppen:s karta, planen,
 * rapporten, omgångarna, läsningen av en abstrakt källa och uppladdningen) används av kommandot, webbläsaren (ADR-0204) och
 * testerna. Inget här importerar Node; filsystemet finns i `scan.ts`/`zip.ts` (kommandot) och File/Blob i `browser.ts`.
 */
export * from "./folder-name";
export * from "./tags";
export * from "./classify";
export * from "./map-groups";
export * from "./ppen-reference";
export * from "./plan";
export * from "./report";
export * from "./payload";
export * from "./scan-core";
export * from "./upload";
