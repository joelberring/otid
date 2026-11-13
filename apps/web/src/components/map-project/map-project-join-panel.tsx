"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { mapProjectEn } from "../../i18n/map-project-en";
import { mapProjectJoinEn } from "../../i18n/map-project-join-en";
import { mapProjectJoinSv } from "../../i18n/map-project-join-sv";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectJoinLinkRoles, mapProjectJoinUrl, parseClubMembers, parseJoinLinkCreated } from "../../lib/map-project-invite-link";
import { useLocale, useTexts } from "../language-provider";
import { Button, Field, Select, copyText } from "../ui";
import { useMapProjectFailure } from "./use-map-project-failure";
import type { MapProjectClubMembersResponse, MapProjectJoinLinkView, MapProjectRole } from "@o-tid/contracts";
import styles from "./map-project.module.css";

type Say = (message: { tone: "ok" | "error"; text: string }) => void;
const ROLES: readonly MapProjectRole[] = ["READ", "SUGGEST", "EDIT", "OWNER"];

/**
 * Ägaren 2026-11-13: «bjud in klubbmedlemmar utan mejl». En lista med namnen på de konton som är medlemmar i samma klubb som
 * ägaren (sök på namn, välj roll, Lägg till; aldrig e-postadresser). Listan visas inte om ägaren inte är med i någon klubb.
 */
export function ClubMemberPicker({ base, busy, onChanged, onMessage }: { base: string; busy: boolean; onChanged: () => Promise<void>; onMessage: Say }) {
  const failure = useMapProjectFailure();
  const text = useTexts(mapProjectJoinSv.members, mapProjectJoinEn.members);
  const projectText = useTexts(mapProjectSv, mapProjectEn);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<MapProjectRole>("EDIT");
  const [data, setData] = useState<MapProjectClubMembersResponse>();
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const [working, setWorking] = useState(false);
  const latest = useRef(0);

  async function load(search: string) {
    const ticket = ++latest.current;
    const result = await clubRequest(`${base}/club-members${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`);
    if (ticket !== latest.current) return;
    const parsed = result.status === 200 ? parseClubMembers(result.json) : undefined;
    if (!parsed) { setState("failed"); return; }
    setData(parsed); setState("ok");
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [base, query]);

  async function add(accountId: string, name: string) {
    setWorking(true);
    try {
      const result = await clubRequest(`${base}/club-members`, "POST", { formatVersion: 1, accountId, role });
      if (result.status === 201) { onMessage({ tone: "ok", text: text.added(name) }); await onChanged(); await load(query); }
      else onMessage({ tone: "error", text: result.status === 404 || result.status === 409 ? text.gone : failure(result.status) });
    } finally { setWorking(false); }
  }

  if (state === "ok" && data && data.clubs.length === 0) return null;
  return <section aria-labelledby="map-project-club-members" data-testid="map-project-club-members">
    <h3 id="map-project-club-members">{text.title}</h3>
    {state === "loading" && <p className={styles.muted} role="status">{text.loading}</p>}
    {state === "failed" && <p className={styles.muted} role="alert">{text.failed}</p>}
    {data && <>
      <p className={styles.muted}>{text.help(data.clubs)}</p>
      <div className={styles.inline}>
        <Field label={text.search}><input type="search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} /></Field>
        <Select label={text.role} value={role} onChange={event => setRole(event.target.value as MapProjectRole)} help={projectText.roleHelp[role]}>
          {ROLES.map(value => <option key={value} value={value}>{projectText.roles[value]}</option>)}
        </Select>
      </div>
      {data.members.length === 0 ? <p className={styles.muted}>{query.trim() ? text.noMatch : text.none}</p>
        : <ul className={styles.list} data-testid="map-project-club-member-list">{data.members.map(member => <li key={member.accountId}>
          <div><strong>{member.name}</strong>{data.clubs.length > 1 && <span>{text.from(member.clubNames)}</span>}</div>
          <div className={styles.actions}><Button variant="secondary" disabled={busy || working} aria-label={text.addLabel(member.name)}
            onClick={() => void add(member.accountId, member.name)}>{text.add}</Button></div>
        </li>)}</ul>}
    </>}
  </section>;
}

/**
 * «Skapa länk»: en länk med en vald roll som den som öppnar den inloggad blir medlem med. Nyckeln visas bara när länken skapas
 * (servern sparar bara hashen); de öppna länkarna i listan kan tas bort.
 */
export function JoinLinks({ base, links, busy, onChanged, onMessage }: { base: string; links: readonly MapProjectJoinLinkView[]; busy: boolean;
  onChanged: () => Promise<void>; onMessage: Say }) {
  const failure = useMapProjectFailure();
  const text = useTexts(mapProjectJoinSv.link, mapProjectJoinEn.link);
  const projectText = useTexts(mapProjectSv, mapProjectEn);
  const locale = useLocale();
  const [role, setRole] = useState<(typeof mapProjectJoinLinkRoles)[number]>("EDIT");
  const [url, setUrl] = useState<string>();
  const [working, setWorking] = useState(false);
  const until = (iso: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sv-SE", { dateStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(iso));

  async function create(event: FormEvent) {
    event.preventDefault();
    setWorking(true); setUrl(undefined);
    try {
      const result = await clubRequest(`${base}/join-links`, "POST", { formatVersion: 1, role });
      const created = result.status === 201 ? parseJoinLinkCreated(result.json) : undefined;
      if (!created) { onMessage({ tone: "error", text: result.status === 409 ? text.tooMany : result.status === 201 ? text.failed : failure(result.status) }); return; }
      const link = mapProjectJoinUrl(window.location.origin, created.token);
      setUrl(link);
      // Urklippet kan vara avstängt: länken står i fältet.
      onMessage({ tone: "ok", text: await copyText(link) ? text.copied : text.created });
      await onChanged();
    } finally { setWorking(false); }
  }

  async function remove(link: MapProjectJoinLinkView) {
    setWorking(true);
    try {
      const result = await clubRequest(`${base}/join-links`, "DELETE", { formatVersion: 1, linkId: link.linkId });
      if (result.status === 200) { setUrl(undefined); onMessage({ tone: "ok", text: text.removed }); await onChanged(); }
      else onMessage({ tone: "error", text: failure(result.status) });
    } finally { setWorking(false); }
  }

  return <section aria-labelledby="map-project-join-links" data-testid="map-project-join-links">
    <h3 id="map-project-join-links">{text.title}</h3>
    <p className={styles.muted}>{text.help}</p>
    <form className={styles.form} onSubmit={event => void create(event)} aria-label={text.create}>
      <div className={styles.inline}>
        <Select label={projectText.members.role} value={role} onChange={event => setRole(event.target.value as typeof role)} help={projectText.roleHelp[role]}>
          {mapProjectJoinLinkRoles.map(value => <option key={value} value={value}>{projectText.roles[value]}</option>)}
        </Select>
      </div>
      <div className={styles.actions}><Button type="submit" variant="secondary" disabled={busy || working}>{text.create}</Button></div>
    </form>
    {url && <div className={styles.form}>
      <Field label={text.field}><input readOnly value={url} data-testid="map-project-join-url" onFocus={event => event.currentTarget.select()} /></Field>
      <div className={styles.actions}><Button variant="secondary" onClick={() => void copyText(url)}>{text.copy}</Button></div>
    </div>}
    {links.length > 0 && <>
      <h4>{text.open}</h4>
      <ul className={styles.list} data-testid="map-project-join-link-list">{links.map(link => <li key={link.linkId}>
        <div><span>{text.line(projectText.roles[link.role], until(link.expiresAt))}</span></div>
        <div className={styles.actions}><Button variant="secondary" disabled={busy || working}
          aria-label={text.removeLabel(projectText.roles[link.role], until(link.expiresAt))} onClick={() => void remove(link)}>{text.remove}</Button></div>
      </li>)}</ul>
    </>}
  </section>;
}
