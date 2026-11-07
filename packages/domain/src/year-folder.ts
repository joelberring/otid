/**
 * En årsmapp i ett klubbarkiv (ADR-0194 beslut 6, ADR-0210 beslut 3): bara året ("2019") eller året och ord ("2019 träningar",
 * "2019 [Anna]"), men inte en träning som börjar med ett datum ("2019-04-02 Skogen", "2019 04-02 Skogen", "20190402 Skogen").
 * Året är 1950–2100. Den enda regeln (städrundan C4): importen och webbläsarens "Välj mapp", träningens mapp och kartversionens
 * år frågar här, så att samma mappnamn tolkas lika överallt. Ren funktion.
 */
const YEAR_FOLDER = /^(\d{4})(?:$| \D)/;

/** Årsmappens år, eller null om namnet inte är en årsmapp. */
export function yearOfYearFolder(name: string): number | null {
  const match = YEAR_FOLDER.exec(name.normalize("NFC").replace(/\s+/g, " ").trim());
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1950 && year <= 2100 ? year : null;
}
