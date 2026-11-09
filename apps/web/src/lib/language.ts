/**
 * Idéerna 2026-11-08 (engelska i appen): språket för en besökare. Ett val i kakan `otid-lang` gäller; annars engelska bara när
 * webbläsarens språk inte nämner svenska eller ett närliggande nordiskt språk (många i Sverige har engelska webbläsare men
 * svenska i listan). Texterna ligger i `i18n/*-sv.ts` och för det som är översatt i `*-en.ts` med samma form (`Texts`).
 */
export type Language = "sv" | "en";
export const LANGUAGE_COOKIE = "otid-lang";
export const LOCALE: Readonly<Record<Language, string>> = { sv: "sv-SE", en: "en-GB" };
const NORDIC = /^(sv|nb|nn|no|da|fi)(-|$)/;

export const isLanguage = (value: unknown): value is Language => value === "sv" || value === "en";

export function languageFrom(cookie: string | undefined, acceptLanguage: string | null | undefined): Language {
  if (isLanguage(cookie)) return cookie;
  const tags = (acceptLanguage ?? "").split(",").map(part => part.split(";")[0]!.trim().toLowerCase()).filter(tag => tag && tag !== "*");
  if (tags.length === 0 || tags.some(tag => NORDIC.test(tag))) return "sv";
  return "en";
}

/** Språket för en begäran till ett API (kakan, annars webbläsarens språk), t.ex. för mejlet som skickas. */
export function languageOfRequest(request: Request): Language {
  const cookie = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim().split("="))
    .find(([name]) => name === LANGUAGE_COOKIE)?.[1];
  return languageFrom(cookie, request.headers.get("accept-language"));
}

/** Ett textobjekt med samma form men vanliga strängar (svenskans `as const` ger bokstavliga typer). */
export type Texts<T> = T extends string ? string
  : T extends (...args: infer A) => infer R ? (...args: A) => (R extends string ? string : R)
  : T extends readonly (infer U)[] ? readonly Texts<U>[]
  : T extends object ? { readonly [K in keyof T]: Texts<T[K]> } : T;

/** Texten på besökarens språk. */
export const pickTexts = <T>(language: Language, sv: T, en: Texts<T>): Texts<T> => language === "en" ? en : sv as Texts<T>;

/** Adressen som byter språk och kommer tillbaka till samma sida. */
export const languageHref = (language: Language, back: string) =>
  `/sprak?${new URLSearchParams({ till: language, tillbaka: back.startsWith("/") && !back.startsWith("//") ? back : "/" })}`;
