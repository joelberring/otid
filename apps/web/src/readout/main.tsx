import { createRoot } from "react-dom/client";
import { ReadoutApp } from "./app";
import "./readout.css";

// Byggs utan Next/RSC så att hela sidan kan cachas och starta utan nät.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/readout/sw.js", { scope: "/readout/", updateViaCache: "none" })
    .catch((error: unknown) => {
      console.error("Avläsningen kunde inte förberedas för offline", error);
      document.body.dataset.offlineShell = "failed";
    });
}

createRoot(document.getElementById("root")!).render(<ReadoutApp />);
