"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ClubMapView, GroupSummary, MapAgreement } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubBase, clubFailure, clubRequest, renderMapVersion, sendRenderedMap, uploadMapVersion } from "../../lib/club-archive-client";
import { Button, DateInput, EmptyState, Field, Notice } from "../ui";
import { MapAgreementFields, MapAgreementSummary } from "../training-group/map-agreement";
import styles from "./club-archive.module.css";

const text = clubArchiveSv.maps;
type Message = { tone: "ok" | "error"; text: string };

const agreementOf = (map: ClubMapView): MapAgreement => ({ ownership: map.ownership, ownerKind: map.ownerKind, ownerName: map.ownerName,
  agreement: map.agreement, validUntil: map.validUntil, contact: map.contact, trainingOnly: map.trainingOnly, feePerPrint: map.feePerPrint,
  noPublicDisplay: map.noPublicDisplay });

function uploadProblem(status: number, json: unknown): string {
  const body = json as { error?: string; quota?: { usedMb: number; limitMb: number } } | undefined;
  if (status === 422 && body?.error === "DUPLICATE") return text.duplicate;
  if (status === 422 && body?.error === "MAP_FILE_TOO_LARGE") return text.tooLarge;
  if (status === 422 && body?.error === "INVALID_MAP_FILE") return text.invalid;
  if (status === 422 && body?.error === "STORAGE_QUOTA_EXCEEDED" && body.quota) return text.quota(body.quota.usedMb, body.quota.limitMb);
  return clubFailure(status);
}

/** Uppladdning av en ny version (eller en ny karta): filen, versionens datum och en anteckning. */
function UploadForm({ clubId, mapId, onDone, onMessage }: { clubId: string; mapId: string | null; onDone: () => Promise<void>;
  onMessage: (message: Message) => void }) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || (!mapId && !name.trim())) return;
    setBusy(true);
    try {
      const result = await uploadMapVersion(clubId, { mapId, mapName: mapId ? null : name.trim(), file, versionDate: date || null, note: note.trim() || null });
      if (result.status !== 201) { onMessage({ tone: "error", text: uploadProblem(result.status, result.json) }); return; }
      onMessage({ tone: "ok", text: text.uploaded });
      await onDone();
    } finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={event => void submit(event)}>
    <p className={styles.small}>{text.uploadHelp}</p>
    {!mapId && <Field label={text.mapName}><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></Field>}
    <Field label={text.file}><input type="file" accept=".ocd,.omap,.xmap" onChange={event => setFile(event.target.files?.[0])} /></Field>
    <div className={styles.inline}>
      <Field label={text.versionDate}><DateInput value={date} onChange={event => setDate(event.target.value)} /></Field>
      <Field label={text.note}><input value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></Field>
    </div>
    <Button type="submit" disabled={busy || !file}>{busy ? text.uploading : text.uploadButton}</Button>
  </form>;
}

function MapCard({ clubId, map, maps, admin, groups, onChanged, onMessage }: { clubId: string; map: ClubMapView; maps: readonly ClubMapView[]; admin: boolean;
  groups: readonly GroupSummary[]; onChanged: () => Promise<void>; onMessage: (message: Message) => void }) {
  const [name, setName] = useState(map.name);
  const [agreement, setAgreement] = useState<MapAgreement>(agreementOf(map));
  const [mergeTarget, setMergeTarget] = useState("");
  const [busy, setBusy] = useState("");
  const others = maps.filter(other => other.mapId !== map.mapId);

  async function act(key: string, action: () => Promise<{ status: number; json?: unknown }>, ok: string) {
    setBusy(key);
    try {
      const result = await action();
      if (result.status >= 200 && result.status < 300) { onMessage({ tone: "ok", text: ok }); await onChanged(); }
      else onMessage({ tone: "error", text: clubFailure(result.status) });
    } finally { setBusy(""); }
  }

  async function toGroup(group: GroupSummary) {
    const latest = map.versions[0];
    if (!latest) return;
    setBusy(`group-${group.groupId}`);
    try {
      const rendered = await renderMapVersion(clubId, latest.versionId, latest.fileName);
      if (rendered.type === "error") { onMessage({ tone: "error", text: clubArchiveSv.entry.previewFailed }); return; }
      const result = await sendRenderedMap(clubId, latest.versionId, "group", group.groupId, rendered);
      if (result.status !== 200) { onMessage({ tone: "error", text: clubFailure(result.status) }); return; }
      onMessage({ tone: "ok", text: text.toGroupDone((result.json as { updated: boolean }).updated) });
    } finally { setBusy(""); }
  }

  return <article className={styles.card} data-testid="club-map">
    <h3>{map.name}</h3>
    <p className={styles.small}>{text.versions(map.versions.length)} · {text.trainings(map.trainings)}</p>
    <MapAgreementSummary agreement={agreementOf(map)} />
    <ul className={styles.versions}>
      {map.versions.map(version => <li key={version.versionId}>
        <div><strong>{version.versionDate ?? "–"}</strong> {version.fileName}
          {version.versionId === map.latestVersionId && <span className={styles.latest}>{text.latest}</span>}
          <div className={styles.small}>{clubArchiveSv.mb(version.byteLength)} · {text.trainings(version.trainings)}{version.note ? ` · ${version.note}` : ""}</div></div>
        <div className={styles.actions}>
          <a href={`${clubBase(clubId)}/map-versions/${version.versionId}`} download>{clubArchiveSv.entry.downloadMap}</a>
          {admin && <select aria-label={`${text.move} ${version.fileName}`} value="" disabled={busy !== ""}
            onChange={event => {
              const target = event.target.value;
              if (!target) return;
              const newName = target === "NEW" ? window.prompt(text.newMapName, map.name)?.trim() : null;
              if (target === "NEW" && !newName) return;
              void act(`move-${version.versionId}`, () => clubRequest(`${clubBase(clubId)}/map-versions/${version.versionId}/move`, "POST",
                { formatVersion: 1, targetMapId: target === "NEW" ? null : target, newMapName: target === "NEW" ? newName : null }), clubArchiveSv.entry.saved);
            }}>
            <option value="">{text.move}</option>
            {others.map(other => <option key={other.mapId} value={other.mapId}>{other.name}</option>)}
            <option value="NEW">{text.moveNew}</option>
          </select>}
        </div>
      </li>)}
    </ul>
    {groups.length > 0 && map.versions.length > 0 && <details className={styles.details}>
      <summary>{text.toGroup}</summary>
      <p className={styles.small}>{text.toGroupHelp}</p>
      <div className={styles.actions}>{groups.map(group => <Button key={group.groupId} variant="secondary" disabled={busy !== ""}
        onClick={() => void toGroup(group)}>{text.toGroupButton(group.name)}</Button>)}</div>
    </details>}
    {admin && <>
      <details className={styles.details}>
        <summary>{text.upload}</summary>
        <UploadForm clubId={clubId} mapId={map.mapId} onDone={onChanged} onMessage={onMessage} />
      </details>
      <details className={styles.details}>
        <summary>{text.rename}</summary>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void act("update", () => clubRequest(`${clubBase(clubId)}/maps/${map.mapId}`,
          "PUT", { formatVersion: 1, name: name.trim(), agreement }), clubArchiveSv.entry.saved); }}>
          <Field label={text.mapName}><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></Field>
          <MapAgreementFields value={agreement} onChange={setAgreement} disabled={busy !== ""} />
          <Button type="submit" disabled={busy !== "" || !name.trim()}>{clubArchiveSv.entry.save}</Button>
        </form>
      </details>
      {others.length > 0 && <details className={styles.details}>
        <summary>{text.merge}</summary>
        <p className={styles.small}>{text.mergeHelp}</p>
        <div className={styles.inline}>
          <select aria-label={text.merge} value={mergeTarget} onChange={event => setMergeTarget(event.target.value)}>
            <option value="">–</option>{others.map(other => <option key={other.mapId} value={other.mapId}>{other.name}</option>)}
          </select>
          <Button variant="secondary" disabled={!mergeTarget || busy !== ""} onClick={() => void act("merge", () => clubRequest(
            `${clubBase(clubId)}/maps/${map.mapId}/merge`, "POST", { formatVersion: 1, targetMapId: mergeTarget }), clubArchiveSv.entry.saved)}>
            {text.mergeButton}</Button>
        </div>
      </details>}
    </>}
  </article>;
}

/** ADR-0194 beslut 2 och 5: klubbens kartor med versioner, rättigheter, slå ihop och dela, ny version och gruppens bibliotek. */
export function ClubMapsPanel({ clubId, maps, admin, onChanged }: { clubId: string; maps: readonly ClubMapView[]; admin: boolean;
  onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState<Message>();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  useEffect(() => {
    void clubRequest("/api/organizer/groups").then(result => {
      if (result.status === 200) setGroups((result.json as { groups: GroupSummary[] }).groups.filter(group => group.role === "LEADER"));
    });
  }, []);
  return <section className={styles.cards} aria-labelledby="club-maps">
    <div>
      <h2 id="club-maps">{text.title}</h2>
      <p className={styles.muted}>{text.help}</p>
    </div>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    {maps.length === 0 && <EmptyState title={text.empty} />}
    {maps.map(map => <MapCard key={`${map.mapId}-${map.versions.length}-${map.name}`} clubId={clubId} map={map} maps={maps} admin={admin} groups={groups}
      onChanged={onChanged} onMessage={setMessage} />)}
    {admin && <details className={styles.details}>
      <summary>{text.uploadNew}</summary>
      <UploadForm clubId={clubId} mapId={null} onDone={onChanged} onMessage={setMessage} />
    </details>}
  </section>;
}
