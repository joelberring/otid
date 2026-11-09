import { createRoot } from "react-dom/client";
import { ReadoutApp } from "./app";
import { LanguageProvider } from "../components/language-provider";
import { LANGUAGE_COOKIE, languageFrom } from "../lib/language";
import "../components/ui/tokens.css";
import "./readout.css";

// Byggs utan Next/RSC så att hela sidan kan cachas och starta utan nät.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/readout/sw.js", { scope: "/readout/", updateViaCache: "none" })
    .catch((error: unknown) => {
      console.error("Avläsningen kunde inte förberedas för offline", error);
      document.body.dataset.offlineShell = "failed";
    });
}

// Idéerna 2026-11-08 (engelska): samma språkval som webbplatsen (kakan, annars webbläsarens språk). Kvittot är kvar på svenska.
const cookie = document.cookie.split(";").map(part => part.trim().split("=")).find(([name]) => name === LANGUAGE_COOKIE)?.[1];
const language = languageFrom(cookie, navigator.languages.join(","));
document.documentElement.lang = language;
createRoot(document.getElementById("root")!).render(<LanguageProvider language={language}><ReadoutApp /></LanguageProvider>);
