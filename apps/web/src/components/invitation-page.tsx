"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { invitationLinkViewSchema, passwordResetTokenSchema, type InvitationLinkView } from "@o-tid/contracts";
import { accountSv } from "../i18n/account-sv";
import { invitationRoleWord, invitationSv, invitationTargetPhrase } from "../i18n/invitation-sv";
import { invitationEn, invitationRoleWordEn, invitationTargetPhraseEn } from "../i18n/workspace-last-en";
import { accountEntryEn } from "../i18n/account-en";
import { useLanguage } from "./language-provider";
import { accountRequest } from "../lib/account-client";
import { saveInvitationHandoff } from "../lib/invitation-handoff";
import { parseOrganizerSessionStatus } from "../lib/organizer-client";
import { Button, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

type Valid = Extract<InvitationLinkView, { status: "valid" }>;

/** Nyckeln ur adressens #token=… och bort ur adressfältet och historiken (som bekräftelselänken). */
function takeTokenFromLocation(): string | undefined {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? undefined;
  if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token && passwordResetTokenSchema.safeParse(token).success ? token : undefined;
}

/**
 * ADR-0206: länken i inbjudningsmejlet. Visar vem som bjudit in, till vad och som vad, och två knappar: "Skapa konto" (adressen
 * ifylld och låst) och "Logga in" (adressen ifylld). Sidan ger ingenting själv och ser likadan ut oavsett om adressen har ett
 * konto; behörigheten kommer när personen loggar in med adressen och har bekräftat den.
 */
export function InvitationPage() {
  const en = useLanguage() === "en";
  const text = en ? invitationEn.page : invitationSv.page, back = en ? accountEntryEn.reset.backToLogin : accountSv.reset.backToLogin;
  const target = en ? invitationTargetPhraseEn : invitationTargetPhrase, roleWord = en ? invitationRoleWordEn : invitationRoleWord;
  const [state, setState] = useState<{ kind: "checking" } | { kind: "no-token" } | { kind: "failed" } | { kind: "invalid" }
    | { kind: "valid"; view: Valid }>({ kind: "checking" });
  const [sessionEmail, setSessionEmail] = useState<string>();

  useEffect(() => {
    const token = takeTokenFromLocation();
    if (!token) {
      // Effekten kan köras två gånger (React strict mode); då är adressen redan tömd och första körningen har hämtat.
      setState(current => current.kind === "checking" ? { kind: "no-token" } : current);
      return;
    }
    void (async () => {
      try {
        const response = await accountRequest("/api/invitation", { method: "POST", body: { formatVersion: 1, token } });
        const parsed = invitationLinkViewSchema.safeParse(response.json);
        if (response.status !== 200 || !parsed.success) { setState({ kind: "failed" }); return; }
        setState(parsed.data.status === "valid" ? { kind: "valid", view: parsed.data } : { kind: "invalid" });
      } catch { setState({ kind: "failed" }); }
      try {
        const session = await fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" });
        if (session.ok) setSessionEmail(parseOrganizerSessionStatus(await session.json() as unknown)?.email);
      } catch { /* utan session visas knapparna */ }
    })();
  }, []);

  function go(view: Valid, mode: "register" | "login") {
    saveInvitationHandoff({ email: view.email, next: view.next, mode });
    window.location.assign("/organizer");
  }

  const view = state.kind === "valid" ? state.view : undefined;
  const until = view ? new Intl.DateTimeFormat(en ? "en-GB" : "sv-SE", { dateStyle: "long", timeZone: "Europe/Stockholm" }).format(new Date(view.expiresAt)) : "";
  const signedInAsInvited = view && sessionEmail && sessionEmail.toLowerCase() === view.email.toLowerCase();
  const signedInAsOther = view && sessionEmail && !signedInAsInvited;
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p>
      <h1>{state.kind === "invalid" ? text.invalidTitle : text.title}</h1></div></header>
    {state.kind === "checking" && <p role="status">{text.checking}</p>}
    {state.kind === "no-token" && <Notice tone="error" role="alert">{text.noToken}</Notice>}
    {state.kind === "failed" && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {state.kind === "invalid" && <Notice tone="error" role="alert">{text.invalid}</Notice>}
    {view && <Section label={text.title}>
      <div className={styles.form} data-testid="invitation">
        <p><strong>{text.invited(view.inviterName, target(view.kind, view.targetName, view.raceDate),
          roleWord(view.kind, view.role))}</strong></p>
        <p>{text.address(view.email)}</p>
        <p>{text.howItWorks} {text.validUntil(until)}</p>
        {signedInAsInvited && <div className={styles.actions}><Button onClick={() => window.location.assign(view.next)}>{text.open}</Button></div>}
        {signedInAsOther && <Notice tone="info" role="status">{text.otherAccount(sessionEmail)}</Notice>}
        {!sessionEmail && <div className={styles.actions}>
          <Button onClick={() => go(view, "register")}>{text.register}</Button>
          <Button variant="secondary" onClick={() => go(view, "login")}>{text.login}</Button>
        </div>}
      </div>
    </Section>}
    <p><Link href="/organizer">{back}</Link></p>
  </main>;
}
