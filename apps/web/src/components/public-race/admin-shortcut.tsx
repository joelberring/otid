"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clubLeadersEn } from "../../i18n/club-leaders-en";
import { clubLeadersSv } from "../../i18n/club-leaders-sv";
import { readOrganizerCsrf } from "../../lib/organizer-client";
import { useTexts } from "../language-provider";
import styles from "./public-race.module.css";

type Shortcut = { raceId: string; bingo: boolean };

function signedIn(): boolean {
  try { readOrganizerCsrf(document.cookie, new URL(window.location.href)); return true; } catch { return false; }
}

/**
 * Ägaren 2026-11-15: "Till adminläget" (och för en bingoträning "Ledarens tabell") på tävlingssidan och dess undersidor, för
 * ett inloggat konto med adminbehörighet (uttrycklig eller som ledare i arrangörsklubben för en träning). Hämtas i webbläsaren
 * efter sidan med ett privat anrop, så att sidan själv är densamma för alla och kan cachas. Utan inloggning görs inget anrop.
 */
export function AdminShortcut({ code }: { code: string }) {
  const text = useTexts(clubLeadersSv.shortcut, clubLeadersEn.shortcut);
  const [shortcut, setShortcut] = useState<Shortcut>();
  useEffect(() => {
    if (!signedIn()) return;
    const controller = new AbortController();
    void fetch(`/api/organizer/race-shortcut?code=${encodeURIComponent(code)}`, { credentials: "same-origin", cache: "no-store",
      signal: controller.signal })
      .then(async response => response.ok ? await response.json() as { admin: Shortcut | null } : undefined)
      .then(result => { if (result?.admin) setShortcut(result.admin); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [code]);
  if (!shortcut) return null;
  const base = `/admin/${encodeURIComponent(shortcut.raceId)}`;
  return <nav className={styles.adminShortcut} aria-label={text.label} data-testid="admin-shortcut">
    <Link href={`${base}/manage`} prefetch={false}>{text.admin}</Link>
    {shortcut.bingo && <Link href={`${base}/bingo`} prefetch={false}>{text.bingoLeader}</Link>}
  </nav>;
}
