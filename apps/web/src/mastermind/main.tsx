import { createRoot } from "react-dom/client";
import { MastermindApp } from "./app";
import { LanguageProvider } from "../components/language-provider";
import { LANGUAGE_COOKIE, languageFrom } from "../lib/language";
import "../components/ui/tokens.css";
import "./mastermind.css";

// Byggs utan Next, som avläsningsskalet: Web Serial och WebUSB, och spelet fungerar utan nät när sidan väl är laddad.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/mastermind/sw.js", { scope: "/mastermind/", updateViaCache: "none" })
    .catch((error: unknown) => console.warn("Spelet kunde inte förberedas för offline", error));
}

const cookie = document.cookie.split(";").map(part => part.trim().split("=")).find(([name]) => name === LANGUAGE_COOKIE)?.[1];
const language = languageFrom(cookie, navigator.languages.join(","));
document.documentElement.lang = language;
// Från en träning (`/admin/{id}/mastermind`): träningens id efter #, som i avläsningen.
const hash = window.location.hash.slice(1);
const raceId = /^[0-9a-f-]{36}$/.test(hash) ? hash : undefined;
createRoot(document.getElementById("root")!).render(<LanguageProvider language={language}><MastermindApp language={language} raceId={raceId} /></LanguageProvider>);
