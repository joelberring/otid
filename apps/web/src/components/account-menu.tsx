"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { accountMenuSv as text } from "../i18n/account-menu-sv";
import { logOut, pendingOfflineChanges, type PendingOfflineChanges } from "../lib/account-logout";
import { Button } from "./ui";
import styles from "./account-menu.module.css";

type Who = { displayName: string; email: string };

/** Initialerna i knappen: första bokstaven i de två första orden (eller adressen). */
export function initialsOf(name: string): string {
  const words = name.normalize("NFC").trim().split(/[\s@._-]+/).filter(Boolean);
  return (words.slice(0, 2).map(word => Array.from(word)[0] ?? "").join("") || "?").toLocaleUpperCase("sv-SE");
}

/**
 * ADR-0205 tillägg: kontomenyn i överlisten på varje inloggad sida (Mina tävlingar, banläggningen, utskriften, klubbarkivet,
 * träningsgrupperna och Mitt konto). Namnet (på telefonen bara initialerna) öppnar Mina klubbar, Mina grupper, Mitt konto och
 * Logga ut. Väntar ändringar på nät frågar menyn först. Utan inloggning visas ingenting. `who` sparar en hämtning när sidan
 * redan vet vem som är inloggad.
 */
export function AccountMenu({ who: known }: { who?: Who | undefined }) {
  const [who, setWho] = useState<Who | undefined>(known);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"idle" | "checking" | "confirm" | "leaving">("idle");
  const [pending, setPending] = useState<PendingOfflineChanges>();
  const [problem, setProblem] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => { if (known) setWho(known); }, [known?.displayName, known?.email]);
  useEffect(() => {
    if (known) return;
    let active = true;
    void fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!active || !response.ok) return;
      const body = await response.json() as { displayName?: unknown; email?: unknown };
      if (typeof body.displayName === "string" && typeof body.email === "string") setWho({ displayName: body.displayName, email: body.email });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [known]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, stage]);

  function close() { if (stage === "leaving") return; setOpen(false); setStage("idle"); setProblem(""); }

  async function leave() {
    setStage("leaving"); setProblem("");
    try {
      const result = await logOut();
      if (!result.ok) { setStage("idle"); setProblem(text.failed(result.status)); }
    } catch { setStage("idle"); setProblem(text.network); }
  }

  async function start() {
    setStage("checking"); setProblem("");
    const counted = await pendingOfflineChanges();
    setPending(counted);
    if (counted.total > 0) { setStage("confirm"); return; }
    await leave();
  }

  if (!who) return null;
  return <div className={styles.menu} ref={root} data-testid="account-menu">
    <button type="button" className={styles.trigger} aria-expanded={open} aria-controls={panelId} aria-label={text.open(who.displayName)}
      title={text.open(who.displayName)} onClick={() => (open ? close() : setOpen(true))}>
      <span className={styles.initials} aria-hidden="true">{initialsOf(who.displayName)}</span>
      <span className={styles.name} aria-hidden="true">{who.displayName}</span>
      <span className={styles.caret} aria-hidden="true">▾</span>
    </button>
    {open && <div className={styles.panel} id={panelId}>
      <p className={styles.who}><strong>{who.displayName}</strong><span>{who.email}</span></p>
      <nav aria-label={text.open(who.displayName)} style={{ display: "grid", gap: 2 }}>
        <Link className={styles.item} href="/organizer">{text.myEvents}</Link>
        <Link className={styles.item} href="/organizer#mina-klubbar">{text.myClubs}</Link>
        <Link className={styles.item} href="/organizer#mina-grupper">{text.myGroups}</Link>
        <Link className={styles.item} href="/konto">{text.myAccount}</Link>
      </nav>
      <div className={styles.separator} />
      {stage !== "confirm" && <button type="button" className={styles.item} disabled={stage !== "idle"} aria-busy={stage !== "idle"}
        onClick={() => void start()}>{stage === "leaving" ? text.loggingOut : stage === "checking" ? text.checking : text.logout}</button>}
      {stage === "confirm" && pending && <div className={styles.confirm} role="alertdialog" aria-label={text.logout}>
        <p><strong>{text.pending(pending.total)}</strong></p>
        {pending.courseSetting > 0 && <p>{text.pendingCourseSetting}</p>}
        {pending.tracks > 0 && <p>{text.pendingTracks(pending.tracks)}</p>}
        {pending.readouts + pending.party > 0 && <p>{text.pendingReadouts(pending.readouts + pending.party)}</p>}
        <div><Button type="button" variant="secondary" onClick={() => void leave()}>{text.logoutAnyway}</Button>
          <Button type="button" variant="quiet" onClick={() => setStage("idle")}>{text.cancel}</Button></div>
      </div>}
      {problem && <p className={styles.error} role="alert">{problem}</p>}
    </div>}
  </div>;
}
