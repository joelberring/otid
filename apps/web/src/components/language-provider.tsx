"use client";

import { createContext, useContext, type ReactNode } from "react";
import { LOCALE, pickTexts, type Language, type Texts } from "../lib/language";

/**
 * Idéerna 2026-11-08 (engelska): språket för klientkomponenterna. De publika sidornas layout (tävlingssidan, start- och
 * resultatlistorna) sätter besökarens språk; allt annat (arbetsytan) är svenska tills det är översatt.
 */
const LanguageContext = createContext<Language>("sv");

export function LanguageProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export const useLanguage = (): Language => useContext(LanguageContext);
export const useTexts = <T,>(sv: T, en: Texts<T>): Texts<T> => pickTexts(useLanguage(), sv, en);

/** Språkkoden för datum och tal (`sv-SE` eller `en-GB`), så att månadsnamn och decimaltecken följer språket. */
export const useLocale = (): string => LOCALE[useLanguage()];
