"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { mapProjectJoinLinkViewSchema, type MapProjectJoinLinkInfo, type MapProjectRole } from "@o-tid/contracts";
import { accountSv } from "../../i18n/account-sv";
import { accountEntryEn } from "../../i18n/account-en";
import { mapProjectEn } from "../../i18n/map-project-en";
import { mapProjectJoinEn } from "../../i18n/map-project-join-en";
import { mapProjectJoinSv } from "../../i18n/map-project-join-sv";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { accountRequest } from "../../lib/account-client";
import { clubRequest } from "../../lib/club-archive-client";
import { tokenFromHash } from "../../lib/map-project-invite-link";
import { parseOrganizerSessionStatus } from "../../lib/organizer-client";
import { useLanguage, useTexts } from "../language-provider";
import { Button, Notice, Section } from "../ui";
import styles from "../account-pages.module.css";

type Valid = Extract<MapProjectJoinLinkInfo, { status: "valid" }>;
type State = { kind: "checking" } | { kind: "no-token" } | { kind: "failed" } | { kind: "invalid" } | { kind: "valid"; view: Valid };

/**
 * Sidan som tar emot länken från kartprojektets medlemmar (som /inbjudan för e-postinbjudningar): visar vem som bjudit in, till
 * vilket projekt och som vad, och «Gå med» för den som är inloggad. Nyckeln tas ur adressfältet först när personen är inloggad,
 * så att länken går att öppna igen efter inloggningen. Sidan ger ingenting själv; behörigheten kommer när servern tar emot nyckeln.
 */
export function MapProjectJoinPage() {
  const en = useLanguage() === "en";
  const text = useTexts(mapProjectJoinSv.page, mapProjectJoinEn.page);
  const roles = useTexts(mapProjectSv.roles, mapProjectEn.roles);
  const back = en ? accountEntryEn.reset.backToLogin : accountSv.reset.backToLogin;
  const [state, setState] = useState<State>({ kind: "checking" });
  const [token, setToken] = useState<string>();
  const [signedIn, setSignedIn] = useState<boolean>();
  const [verified, setVerified] = useState(true);
  const [outcome, setOutcome] = useState<{ kind: "joining" } | { kind: "joined"; projectId: string } | { kind: "refused" } | undefined>();

  useEffect(() => {
    const found = tokenFromHash(window.location.hash);
    if (!found) { setState(current => current.kind === "checking" ? { kind: "no-token" } : current); return; }
    setToken(found);
    void (async () => {
      try {
        const response = await accountRequest("/api/map-project-link", { method: "POST", body: { formatVersion: 1, token: found } });
        const parsed = mapProjectJoinLinkViewSchema.safeParse(response.json);
        if (response.status !== 200 || !parsed.success) { setState({ kind: "failed" }); return; }
        setState(parsed.data.status === "valid" ? { kind: "valid", view: parsed.data } : { kind: "invalid" });
      } catch { setState({ kind: "failed" }); return; }
      try {
        const session = await fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" });
        const current = session.ok ? parseOrganizerSessionStatus(await session.json() as unknown) : undefined;
        setSignedIn(!!current?.email);
        setVerified(current?.emailVerified !== false);
        // Inloggad: nyckeln behövs inte längre i adressfältet och historiken. Utloggad behålls den för att öppna om efter inloggningen.
        if (current?.email) window.history.replaceState(null, "", window.location.pathname);
      } catch { setSignedIn(false); }
    })();
  }, []);

  async function join() {
    if (!token) return;
    setOutcome({ kind: "joining" });
    const result = await clubRequest("/api/organizer/map-projects/join", "POST", { formatVersion: 1, token });
    const projectId = (result.json as { projectId?: unknown } | undefined)?.projectId;
    setOutcome(result.status === 200 && typeof projectId === "string" ? { kind: "joined", projectId } : { kind: "refused" });
  }

  const view = state.kind === "valid" ? state.view : undefined;
  const until = view ? new Intl.DateTimeFormat(en ? "en-GB" : "sv-SE", { dateStyle: "long", timeZone: "Europe/Stockholm" }).format(new Date(view.expiresAt)) : "";
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p>
      <h1>{state.kind === "invalid" ? text.invalidTitle : text.title}</h1></div></header>
    {state.kind === "checking" && <p role="status">{text.checking}</p>}
    {state.kind === "no-token" && <Notice tone="error" role="alert">{text.noToken}</Notice>}
    {state.kind === "failed" && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {state.kind === "invalid" && <Notice tone="error" role="alert">{text.invalid}</Notice>}
    {view && <Section label={text.title}>
      <div className={styles.form} data-testid="map-project-join">
        <p><strong>{text.invited(view.inviterName, view.projectName, roles[view.role as MapProjectRole])}</strong></p>
        <p>{text.validUntil(until)}</p>
        {signedIn === false && <Notice tone="info" role="status">{text.signedOut}</Notice>}
        {signedIn && !verified && <Notice tone="attention" role="status">{text.verify}</Notice>}
        {outcome?.kind === "refused" && <Notice tone="error" role="alert">{text.refused}</Notice>}
        {outcome?.kind === "joined" && <Notice tone="ok" role="status">{text.joined(view.projectName)}</Notice>}
        <div className={styles.actions}>
          {signedIn && verified && outcome?.kind !== "joined" && <Button disabled={outcome?.kind === "joining"} onClick={() => void join()}>
            {outcome?.kind === "joining" ? text.joining : text.join}</Button>}
          {outcome?.kind === "joined" && <Link href={`/organizer/map-projects/${encodeURIComponent(outcome.projectId)}`}>{text.open}</Link>}
        </div>
      </div>
    </Section>}
    <p><Link href="/organizer">{back}</Link></p>
  </main>;
}
