"use client";

import { memo } from "react";
import styles from "./map-project-editor.module.css";

const iconUrls = new WeakMap<Blob, string>();

/** Delad bild-URL per `Blob` (samma symbolikon i palett, verktygshjul, toppbar och lager skapar bara en URL). */
export function symbolIconUrl(icon: Blob | undefined): string | undefined {
  if (!icon || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  let url = iconUrls.get(icon);
  if (!url) {
    url = URL.createObjectURL(icon);
    iconUrls.set(icon, url);
  }
  return url;
}

/** Symbolens lilla bild (PNG från Workern), med delad bild-URL per `Blob`. */
export const SymbolIcon = memo(function SymbolIcon({ icon, size = 32 }: { icon: Blob | undefined; size?: number }) {
  const url = symbolIconUrl(icon);
  const style = { width: size, height: size };
  return url ? <img src={url} alt="" width={size} height={size} className={styles.icon} style={style} /> : <span className={styles.icon} style={style} />;
});
