"use client";

import React, { useEffect, useState } from "react";
import { publicLinkShareEn } from "../i18n/workspace-small-en";
import { useTexts } from "./language-provider";
import { publicLinkShareSv } from "../i18n/public-link-share-sv";
import { copyPublicLink, sharePublicLink } from "../lib/public-link-share";

function browser() {
  return {
    origin: window.location.origin,
    ...(typeof navigator.share === "function" ? { share: (data: { title: string; url: string }) => navigator.share(data) } : {}),
    ...(typeof navigator.clipboard?.writeText === "function" ? { copy: (url: string) => navigator.clipboard.writeText(url) } : {})
  };
}

/** Interaction-only control for an already-authorized public URL. */
export function PublicLinkShare({ path, title }: { path: string; title: string }) {
  const text = useTexts(publicLinkShareSv, publicLinkShareEn);
  const [canShare, setCanShare] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => { setCanShare(typeof navigator.share === "function"); }, []);

  async function share() {
    const result = await sharePublicLink(browser(), path, title);
    setMessage(result === "SHARED" ? text.shared : result === "SHARE_CANCELLED" ? text.shareCancelled : text.copyUnavailable);
  }

  async function copy() {
    const result = await copyPublicLink(browser(), path);
    setMessage(result === "COPIED" ? text.copied : text.copyUnavailable);
  }

  return <section className="public-link-share" aria-label={text.title}>
    {canShare && <button type="button" className="secondary" onClick={() => void share()}>{text.share}</button>}
    <button type="button" className="secondary" onClick={() => void copy()}>{text.copy}</button>
    {message !== undefined && <p role="status" aria-live="polite">{message}</p>}
  </section>;
}

/**
 * Översynen 2026-11-17 (ADR-0172): koden i den korta adressen (/t/, /fest/, /g/) i klartext, för den som har appen och skriver
 * den under "Har du en kod?". En liten, dämpad rad bredvid länken eller QR-koden; den ska inte konkurrera med dem.
 */
export function AppCode({ code, className }: { code: string; className?: string | undefined }) {
  const text = useTexts(publicLinkShareSv, publicLinkShareEn);
  return <p className={className ? `app-code ${className}` : "app-code"} data-testid="app-code">
    {text.appCode}: <span translate="no">{code}</span>
  </p>;
}
