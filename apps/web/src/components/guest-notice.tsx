"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { accountMenuSv } from "../i18n/account-menu-sv";
import styles from "./guest-notice.module.css";

/**
 * Demoläget del 2: på gästens övningstävling står gästläget överst, när allt tas bort och vägen till ett eget konto. Visas inte
 * för vanliga konton (frågan "vem är inloggad?" ger då inget `guestExpiresAt`).
 */
export function GuestNotice() {
  const [until, setUntil] = useState<Date>();
  useEffect(() => {
    let active = true;
    void fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!active || !response.ok) return;
      const body = await response.json() as { guestExpiresAt?: unknown };
      if (typeof body.guestExpiresAt === "string") setUntil(new Date(body.guestExpiresAt));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!until) return null;
  return <p className={styles.notice} data-testid="guest-notice">
    <strong>{accountMenuSv.guestBadge}</strong> <span>{accountMenuSv.guestNote(until)}</span>{" "}
    <Link href="/organizer" prefetch={false}>{accountMenuSv.createAccount}</Link>
  </p>;
}
