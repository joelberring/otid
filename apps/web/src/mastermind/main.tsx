import { createRoot } from "react-dom/client";
import { MastermindApp } from "./app";
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
createRoot(document.getElementById("root")!).render(<MastermindApp language={language} />);
