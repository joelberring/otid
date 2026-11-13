"use client";

import { invitationMailNoteEn } from "../../i18n/workspace-last-en";
import { useMapProjectFailure } from "./use-map-project-failure";
import { useEffect, useState, type FormEvent } from "react";
import { mapProjectEn } from "../../i18n/map-project-en";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { useLocale, useTexts } from "../language-provider";
import Link from "next/link";
import { invitationMailOutcomeSchema, type MapProjectOutputResponse, type MapProjectRole, type MapProjectView } from "@o-tid/contracts";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import { invitationMailNote } from "../../i18n/invitation-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { AccountMenu } from "../account-menu";
import { ClubMemberPicker, JoinLinks } from "./map-project-join-panel";
import { ProjectStatsSection } from "./map-stats-sections";
import { InvitationActions, invitationSentText } from "../invitation-actions";
import { Button, Field, Notice, Select } from "../ui";
import styles from "./map-project.module.css";

const ROLES: readonly MapProjectRole[] = ["READ", "SUGGEST", "EDIT", "OWNER"];
type Message = { tone: "ok" | "error"; text: string; refusals?: string[] };
const day = (iso: string) => iso.slice(0, 10);

/**
 * ADR-0219 (steg K0): kartprojektets sida. Grundfilen, filerna (grundfilen, versionerna och exporten av ändringarna), medlemmarna
 * och "Skapa ny kartversion" (i projektet, och i klubbens kartbank när projektet hör till en klubb). Att rita kommer i K1.
 * Behörigheten avgörs av API:et (404 för den som inte är med).
 */
export function MapProjectPage({ projectId }: { projectId: string }) {
  const failure = useMapProjectFailure();
  const text = useTexts(mapProjectSv, mapProjectEn);
  const mapProjectEditorText = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const locale = useLocale();
  const [view, setView] = useState<MapProjectView>();
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState<Message>();
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState(true);
  const base = mapProjectBase(projectId);

  async function load() {
    const result = await clubRequest(base);
    if (result.status === 200) { setView(result.json as MapProjectView); setState("ok"); return; }
    setState("missing"); setProblem(failure(result.status));
  }
  useEffect(() => { void load(); }, [projectId]);

  async function run(action: () => Promise<{ status: number; json: unknown }>, ok: string, conflict?: string) {
    setBusy(true); setMessage(undefined);
    try {
      const result = await action();
      if (result.status >= 200 && result.status < 300) { setMessage({ tone: "ok", text: ok }); await load(); return result; }
      setMessage({ tone: "error", text: result.status === 409 && conflict ? conflict : failure(result.status) });
      return undefined;
    } finally { setBusy(false); }
  }

  if (state === "loading") return <main className={styles.page}><p aria-live="polite">{text.page.loading}</p></main>;
  if (!view) return <main className={styles.page}><Notice tone="error" role="alert">{problem}</Notice>
    <p><Link href="/organizer/map-projects">{text.list.title}</Link></p></main>;

  async function writeVersion(toArchive: boolean) {
    if (!window.confirm(toArchive ? text.version.confirmArchive : text.version.confirm)) return;
    setBusy(true); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/versions`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), archive: toArchive });
      if (result.status === 409) { setMessage({ tone: "error", text: text.version.conflict }); return; }
      if (result.status !== 200 && result.status !== 201) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      const response = result.json as MapProjectOutputResponse;
      if (response.status === "created") {
        setMessage({ tone: "ok", text: result.status !== 201 ? text.version.same(response.fileName)
          : response.versionId ? text.version.createdArchive(response.fileName) : text.version.created(response.fileName) });
      } else if (response.status === "empty") setMessage({ tone: "error", text: text.version.empty });
      else setMessage({ tone: "error", text: text.version.refused, refusals: response.refusals.map(refusal => refusal.message) });
      await load();
    } finally { setBusy(false); }
  }

  const project = view;
  const manage = project.viewer.canManage;
  const mailEnabled = project.mailEnabled ?? false;
  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}><Link href="/organizer/map-projects">{text.list.title}</Link> · {project.club?.name ?? text.page.ownProject}</p>
        <h1>{project.name}</h1>
      </div>
      <AccountMenu />
    </header>
    {project.status === "CLOSED" && <Notice tone="attention">{text.page.closed}</Notice>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}
      {message.refusals && <ul className={styles.refusals}>{message.refusals.map((line, index) => <li key={index}>{line}</li>)}</ul>}</Notice>}
    <div className={styles.sections}>
      <section aria-labelledby="map-project-base">
        <h2 id="map-project-base">{text.page.base}</h2>
        <dl className={styles.facts}>
          <dt>{text.page.club}</dt><dd>{project.club?.name ?? text.page.ownProject}</dd>
          <dt>{text.page.base}</dt><dd>{project.base.mapName} · {project.base.fileName}{project.base.versionDate ? ` · ${project.base.versionDate}` : ""}
            {project.base.source === "NEW" ? ` · ${text.page.newMap}` : ""}</dd>
          <dt>{text.page.changes}</dt><dd>{text.page.changed(project.changedObjects)}</dd>
          <dt>{text.page.size}</dt><dd data-testid="map-project-size">{text.page.sizes(byteSize(project.storage.mapFileBytes, locale),
            byteSize(project.storage.totalBytes, locale))}</dd>
        </dl>
        <div className={styles.actions}><Link className={styles.buttonLink} href={`/organizer/map-projects/${encodeURIComponent(projectId)}/map`}
          data-testid="map-project-open-map">{mapProjectEditorText.openMap}</Link></div>
        <p className={styles.muted}>{mapProjectEditorText.openMapHelp}</p>
        {project.base.format === "OCD" && <p className={styles.muted}>{text.page.ocadLater}</p>}
        <div className={styles.actions}>
          <a className={styles.buttonLink} href={`${base}/source`} download>{text.page.download}</a>
          {project.base.format === "OMAP" && <a className={styles.buttonLink} href={`${base}/export?format=omap`} download>{text.page.exportMapper}</a>}
          <a className={styles.buttonLink} href={`${base}/export?format=geojson`} download>{text.page.exportGeojson}</a>
        </div>
        <p className={styles.muted}>{text.page.exportHelp}</p>
      </section>

      <section aria-labelledby="map-project-version">
        <h2 id="map-project-version">{text.version.title}</h2>
        <p className={styles.muted}>{text.version.help}</p>
        {project.viewer.canWriteVersion ? <>
          {project.viewer.canArchive && <label className={styles.check}>
            <input type="checkbox" checked={archive} disabled={busy} onChange={event => setArchive(event.target.checked)} />
            <span>{text.version.archive}<small className={styles.muted}> {text.version.archiveHelp}</small></span>
          </label>}
          <Button disabled={busy || project.base.format !== "OMAP"} onClick={() => void writeVersion(project.viewer.canArchive && archive)}>
            {text.version.button}</Button>
        </> : <p className={styles.muted}>{text.version.notOwner}</p>}
        <h3>{text.page.outputs}</h3>
        {project.outputs.length === 0 ? <p className={styles.muted}>{text.page.noOutputs}</p>
          : <ul className={styles.list} data-testid="map-project-outputs">{project.outputs.map(output => <li key={output.outputId}>
            <div><span>{text.page.outputLine(output.fileName, output.changes, day(output.createdAt))}{output.versionId ? ` · ${text.page.inArchive}` : ""}</span></div>
            <div className={styles.actions}><a className={styles.buttonLink} href={`${base}/outputs/${encodeURIComponent(output.outputId)}`} download
              aria-label={text.page.downloadOutput(output.fileName)}>{text.page.downloadShort}</a></div></li>)}</ul>}
      </section>

      <MembersSection view={project} base={base} busy={busy} mailEnabled={mailEnabled} run={run} onChanged={load} onMessage={setMessage} />

      <ProjectStatsSection base={base} canDecide={project.viewer.canDecide} />

      {manage && <ProjectSettings view={project} base={base} busy={busy} run={run} />}
    </div>
  </main>;
}

type Run = (action: () => Promise<{ status: number; json: unknown }>, ok: string, conflict?: string) => Promise<unknown>;

function MembersSection({ view, base, busy, mailEnabled, run, onChanged, onMessage }: { view: MapProjectView; base: string; busy: boolean;
  mailEnabled: boolean; run: Run; onChanged: () => Promise<void>; onMessage: (message: Message) => void }) {
  const failure = useMapProjectFailure();
  const text = useTexts(mapProjectSv, mapProjectEn);
  const mailNoteText = useTexts(invitationMailNote, invitationMailNoteEn);
  const copy = text.members;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MapProjectRole>("EDIT");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const manage = view.viewer.canManage;

  async function invite(event: FormEvent) {
    event.preventDefault();
    const result = await clubRequest(`${base}/members`, "POST", { formatVersion: 1, requestId, email: email.trim().toLowerCase(), role });
    setRequestId(crypto.randomUUID());
    if (result.status === 200 || result.status === 201) {
      const mail = invitationMailOutcomeSchema.catch("off").parse((result.json as { mail?: unknown } | undefined)?.mail);
      onMessage({ tone: "ok", text: `${copy.invited} ${mailNoteText[mail]}` });
      setEmail(""); await onChanged();
    } else onMessage({ tone: "error", text: result.status === 409 ? copy.exists : failure(result.status) });
  }

  const remove = (who: string, body: { accountId: string | null; invitationId: string | null }, self = false) => {
    if (!window.confirm(self ? copy.leaveConfirm : copy.removeConfirm(who))) return;
    void run(() => clubRequest(`${base}/members`, "DELETE", { formatVersion: 1, ...body }), text.page.saved,
      view.club ? copy.lastOwner : copy.lastOwnerOwn)
      .then(done => { if (done && self) window.location.assign("/organizer/map-projects"); });
  };

  return <section aria-labelledby="map-project-members">
    <h2 id="map-project-members">{copy.title}</h2>
    <p className={styles.muted}>{manage ? copy.help : copy.readerHelp} {view.club ? copy.clubAdmins : ""}</p>
    <ul className={styles.list} data-testid="map-project-members">
      {view.members.map(member => {
        const you = member.accountId === view.viewer.accountId;
        return <li key={member.accountId}>
          <div><strong>{member.name}{you ? ` (${copy.you})` : ""}</strong>
            <span>{[text.roles[member.role], member.edits ? copy.edits(member.edits) : ""].filter(Boolean).join(" · ")}</span></div>
          <div className={styles.actions}>
            {manage && !you && <select aria-label={`${copy.changeRole}: ${member.name}`} value={member.role} disabled={busy}
              onChange={event => void run(() => clubRequest(`${base}/members`, "PUT", { formatVersion: 1, accountId: member.accountId,
                role: event.target.value }), text.page.saved, copy.lastOwner)}>
              {ROLES.map(value => <option key={value} value={value}>{text.roles[value]}</option>)}
            </select>}
            {(manage || you) && <Button variant="secondary" disabled={busy}
              onClick={() => remove(member.name, { accountId: member.accountId, invitationId: null }, you)}>{you ? copy.leave : copy.remove}</Button>}
          </div>
        </li>;
      })}
      {view.invitations.map(invitation => <li key={invitation.invitationId}>
        <div><strong>{invitation.email}</strong><span>{[text.roles[invitation.role], copy.pending,
          invitationSentText(invitation.sentAt, mailEnabled)].filter(Boolean).join(" · ")}</span></div>
        <div className={styles.actions}>
          <InvitationActions name={invitation.email} mailEnabled={mailEnabled} disabled={busy} onSent={onChanged}
            endpoint={`${base}/invitations/${invitation.invitationId}`} />
          <Button variant="secondary" disabled={busy} onClick={() => remove(invitation.email, { accountId: null, invitationId: invitation.invitationId })}>
            {copy.remove}</Button>
        </div>
      </li>)}
    </ul>
    {manage && <form className={styles.form} onSubmit={event => void invite(event)} aria-label={copy.invite}>
      <div className={styles.inline}>
        <Field label={copy.email}><input type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={email}
          onChange={event => setEmail(event.target.value)} required /></Field>
        <Select label={copy.role} value={role} onChange={event => setRole(event.target.value as MapProjectRole)} help={text.roleHelp[role]}>
          {ROLES.map(value => <option key={value} value={value}>{text.roles[value]}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={busy || !email.trim()}>{copy.inviteButton}</Button>
    </form>}
    {manage && <ClubMemberPicker base={base} busy={busy} onChanged={onChanged} onMessage={onMessage} />}
    {manage && <JoinLinks base={base} links={view.joinLinks} busy={busy} onChanged={onChanged} onMessage={onMessage} />}
  </section>;
}

function ProjectSettings({ view, base, busy, run }: { view: MapProjectView; base: string; busy: boolean; run: Run }) {
  const text = useTexts(mapProjectSv, mapProjectEn);
  const [name, setName] = useState(view.name);
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(() => clubRequest(base, "PUT", { formatVersion: 1, name: name.trim() }), text.page.saved);
  };
  const toggle = () => {
    const closing = view.status === "OPEN";
    if (closing && !window.confirm(text.page.closeConfirm)) return;
    void run(() => clubRequest(base, "PUT", { formatVersion: 1, status: closing ? "CLOSED" : "OPEN" }), text.page.saved);
  };
  return <section aria-labelledby="map-project-settings">
    <h2 id="map-project-settings">{text.page.rename}</h2>
    <form className={styles.form} onSubmit={save}>
      <Field label={text.page.name}><input value={name} maxLength={120} onChange={event => setName(event.target.value)} required /></Field>
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || !name.trim() || name.trim() === view.name}>{text.page.save}</Button>
        <Button variant="secondary" disabled={busy} onClick={toggle}>{view.status === "OPEN" ? text.page.close : text.page.reopen}</Button>
      </div>
    </form>
  </section>;
}

/** Storleken i kB, MB eller GB (1000-steg, som filhanterarna), med en decimal under 10. */
function byteSize(bytes: number, locale: string): string {
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 })} ${units[unit]}`;
}
