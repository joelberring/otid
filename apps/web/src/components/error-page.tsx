"use client";

import { useEffect, useState } from "react";
import { errorPageEn } from "../i18n/error-page-en";
import { errorPageSv } from "../i18n/error-page-sv";
import { LANGUAGE_COOKIE, languageFrom, pickTexts, type Language } from "../lib/language";

/** Språket i webbläsaren (kakan, annars webbläsarens språk); svenska tills sidan visats, så att servern och klienten stämmer. */
export function useBrowserLanguage(): Language {
  const [language, setLanguage] = useState<Language>("sv");
  useEffect(() => {
    const cookie = document.cookie.split(";").map(part => part.trim().split("=")).find(([name]) => name === LANGUAGE_COOKIE)?.[1];
    setLanguage(languageFrom(cookie, navigator.languages.join(",")));
  }, []);
  return language;
}

/**
 * Felsidan när något ofångat går sönder i en vy (översynen, batch 5): förklaring, «Försök igen» och en väg tillbaka. Inline-stilar,
 * eftersom `global-error` ersätter rotlayouten och inte får globala stilar. Inga animationer.
 */
export function ErrorPage({ error, reset, language }: { error: Error & { digest?: string }; reset: () => void; language: Language }) {
  const text = pickTexts(language, errorPageSv, errorPageEn);
  useEffect(() => { console.error("Vyn föll ihop", error); }, [error]);
  return <main role="alert" style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
    <h1 style={{ fontSize: "1.5rem", margin: "0 0 12px" }}>{text.title}</h1>
    <p>{text.body}</p>
    {error.digest ? <p style={{ fontSize: "0.875rem", color: "#555" }}>{text.code(error.digest)}</p> : null}
    <p style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 18px", fontSize: "1rem", cursor: "pointer" }}>{text.retry}</button>
      {/* En vanlig länk (inte next/link): när vyn är trasig laddas startsidan om från grunden. */}
      <a href="/" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>{text.home}</a>
    </p>
  </main>;
}
