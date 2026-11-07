/**
 * ADR-0196: läsarens version. Höjs när läsaren klarar fler filer eller ritar dem bättre, så att klubbarkivets sparade
 * kontroller och bilder (som anger versionen de gjordes med) görs om. 1 = OCAD 12+ och Mapper, 2 = också OCAD 8–11,
 * 3 = OCAD 8:s ytmönster på rätt plats (T2) och objektens ursprung i filen (`sources`, ADR-0219).
 */
export const MAP_READER_VERSION = 3;
