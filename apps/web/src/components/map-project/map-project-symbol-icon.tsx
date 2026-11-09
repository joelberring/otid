"use client";

import { useEffect, useState } from "react";
import styles from "./map-project-editor.module.css";

/** Symbolens lilla bild (PNG från Workern), som en bild-URL som släpps när den inte används. */
export function SymbolIcon({ icon, size = 32 }: { icon: Blob | undefined; size?: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!icon) return;
    const next = URL.createObjectURL(icon);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [icon]);
  const style = { width: size, height: size };
  return url ? <img src={url} alt="" width={size} height={size} className={styles.icon} style={style} /> : <span className={styles.icon} style={style} />;
}
