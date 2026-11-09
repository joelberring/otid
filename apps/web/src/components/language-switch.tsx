"use client";

import { usePathname } from "next/navigation";
import { languageSwitch } from "../i18n/public-en";
import { languageHref, type Language } from "../lib/language";

/** Idéerna 2026-11-08 (engelska): länken som byter språk och kommer tillbaka till samma sida. */
export function LanguageSwitch({ language, className }: { language: Language; className?: string }) {
  const pathname = usePathname();
  const target: Language = language === "sv" ? "en" : "sv";
  const text = languageSwitch[language];
  return <a href={languageHref(target, pathname || "/")} hrefLang={target} lang={target} title={text.title} className={className}
    data-testid="language-switch">{text.label}</a>;
}
