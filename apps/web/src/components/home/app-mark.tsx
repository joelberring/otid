"use client";

import { useEffect, useRef } from "react";
import { trackingBridge } from "../../lib/otid-tracking";

/** Samma prov som `trackingBridge()`, som text för skriptet som körs medan sidan läses in. */
const MARK = "var p=document.currentScript&&document.currentScript.parentElement,c=window.Capacitor;"
  + "if(p&&c&&c.Plugins&&c.Plugins.OTidTracking)p.setAttribute('data-otid-app','')";

/**
 * Översynen av startsidan 2026-11-17: i appen (ADR-0227, bryggan finns) märks föräldern med `data-otid-app`, så att
 * startsidans CSS kan visa kodfältet (det syns bara i appen). Skriptet körs medan HTML:en läses, före första ritningen (inget flimmer; Nexts
 * guide "Preventing flash before hydration"); vid en navigering i webbläsaren körs inte skriptet, och då märker effekten.
 * Föräldern ska ha `suppressHydrationWarning`, eftersom attributet inte finns i serverns svar.
 */
export function AppMark({ nonce }: { nonce: string | undefined }) {
  const ref = useRef<HTMLScriptElement>(null);
  useEffect(() => {
    if (trackingBridge()) ref.current?.parentElement?.setAttribute("data-otid-app", "");
  }, []);
  return <script ref={ref} nonce={nonce} type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning
    dangerouslySetInnerHTML={{ __html: MARK }} />;
}
