import type { MetadataRoute } from "next";
import { sv } from "../i18n/sv";

/**
 * Webbmanifestet: namn och ikoner när O-Tid läggs på hemskärmen. Ikonerna (hela loggan) skrivs av
 * `scripts/logo/generate.py` till `public/icons/`; den maskerbara har vit yta och loggan inom det säkra området.
 * `minimal-ui` behåller bakåt och adressen, så att publika länkar fungerar som i webbläsaren.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: sv.appName,
    short_name: sv.appName,
    description: sv.tagline,
    lang: "sv",
    start_url: "/",
    display: "minimal-ui",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
