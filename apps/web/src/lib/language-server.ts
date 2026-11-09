import { cookies, headers } from "next/headers";
import { LANGUAGE_COOKIE, languageFrom, type Language } from "./language";

/** Besökarens språk för en sida som renderas på servern (kakan, annars webbläsarens språk). */
export async function currentLanguage(): Promise<Language> {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  return languageFrom(jar.get(LANGUAGE_COOKIE)?.value, list.get("accept-language"));
}
