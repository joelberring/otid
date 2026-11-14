/**
 * Felbesked som skapas i webbläsarens kod utanför React (hämtningar, webbläsarens lager, kvitton). Språket läses från
 * sidans `<html lang>`, som rotlayouten och avläsningens skal sätter. Utan dokument (servern och testerna) blir det
 * svenska. Använd bara för text som visas; kod som jämför felbesked ska använda egna koder.
 */
export function inLanguage(sv: string, en: string): string {
  return typeof document !== "undefined" && document.documentElement.lang === "en" ? en : sv;
}
