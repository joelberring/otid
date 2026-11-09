"use client";

import { useClubFailure } from "./use-club-failure";
import { useEffect, useState, type FormEvent } from "react";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { clubMapDuplicatesEn } from "../../i18n/club-space-en";
import { clubArchiveChecksEn } from "../../i18n/club-archive-more-en";
import { useTexts } from "../language-provider";
import type { Texts } from "../../lib/language";
import type { ClubMapView, GroupSummary, MapAgreement } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubBase, clubRequest, renderMapVersion, sendRenderedMap, uploadMapVersion } from "../../lib/club-archive-client";
import { Button, DateInput, EmptyState, Field, Notice } from "../ui";
import { MapAgreementSummary } from "../training-group/map-agreement";
import { clubArchiveChecksSv } from "../../i18n/club-archive-checks-sv";
import { clubMapDuplicatesSv } from "../../i18n/club-map-duplicates-sv";
import { MapCheckChip, MapThumbnail } from "./map-check";
import { defaultKeep, DuplicatesCard, MergeChooser } from "./map-duplicates";
import { MapRightsEditor } from "./map-rights-editor";
import { MapMakerToVersions, MergeHistory, VersionDetails } from "./map-versions";
import duplicates from "./map-duplicates.module.css";
import type { useArchiveChecks } from "./use-archive-checks";
import checks from "./archive-checks.module.css";
import styles from "./club-archive.module.css";

type Checks = ReturnType<typeof useArchiveChecks>;

type Message = { tone: "ok" | "error"; text: string };

const agreementOf = (map: ClubMapView): MapAgreement => ({ ownership: map.ownership, ownerKind: map.ownerKind, ownerName: map.ownerName,
  agreement: map.agreement, validUntil: map.validUntil, contact: map.contact, trainingOnly: map.trainingOnly, feePerPrint: map.feePerPrint,
  noPublicDisplay: map.noPublicDisplay });

function uploadProblem(status: number, json: unknown, text: Texts<typeof clubArchiveSv.maps>, failure: (status: number) => string): string {
  const body = json as { error?: string; quota?: { usedMb: number; limitMb: number } } | undefined;
  if (status === 422 && body?.error === "DUPLICATE") return text.duplicate;
  if (status === 422 && body?.error === "MAP_FILE_TOO_LARGE") return text.tooLarge;
  if (status === 422 && body?.error === "INVALID_MAP_FILE") return text.invalid;
  if (status === 422 && body?.error === "STORAGE_QUOTA_EXCEEDED" && body.quota) return text.quota(body.quota.usedMb, body.quota.limitMb);
  return failure(status);
}

/** Uppladdning av en ny version (eller en ny karta): filen, versionens datum och en anteckning. */
function UploadForm({ clubId, mapId, onDone, onMessage }: { clubId: string; mapId: string | null; onDone: () => Promise<void>;
  onMessage: (message: Message) => void }) {
  const failure = useClubFailure();
  const text = useTexts(clubArchiveSv.maps, clubArchiveEn.maps);
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
      if (result.status !== 201) { onMessage({ tone: "error", text: uploadProblem(result.status, result.json, text, failure) }); return; }
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

function MapCard({ clubId, map, maps, admin, mapBank, groups, selected, onSelect, onChanged, onMessage }: { clubId: string; map: ClubMapView;
  maps: readonly ClubMapView[]; admin: boolean; mapBank: boolean; groups: readonly GroupSummary[]; selected: boolean; onSelect: (selected: boolean) => void;
  onChanged: () => Promise<void>; onMessage: (message: Message) => void }) {
  const failure = useClubFailure();
  const clubArchiveText = useTexts(clubArchiveSv, clubArchiveEn);
  const text = useTexts(clubArchiveSv.maps, clubArchiveEn.maps);
  const clubMapDuplicatesText = useTexts(clubMapDuplicatesSv, clubMapDuplicatesEn);
  const [name, setName] = useState(map.name);
  const [description, setDescription] = useState(map.description ?? "");
  const [maker, setMaker] = useState(map.maker ?? "");
  const [busy, setBusy] = useState("");
  const others = maps.filter(other => other.mapId !== map.mapId);

  async function act(key: string, action: () => Promise<{ status: number; json?: unknown }>, ok: string) {
    setBusy(key);
    try {
      const result = await action();
      if (result.status >= 200 && result.status < 300) { onMessage({ tone: "ok", text: ok }); await onChanged(); }
      else onMessage({ tone: "error", text: failure(result.status) });
    } finally { setBusy(""); }
  }

  async function toGroup(group: GroupSummary) {
    const latest = map.versions[0];
    if (!latest) return;
    setBusy(`group-${group.groupId}`);
    try {
      const rendered = await renderMapVersion(clubId, latest.versionId, latest.fileName);
      if (rendered.type === "error") { onMessage({ tone: "error", text: clubArchiveText.entry.previewFailed }); return; }
      const result = await sendRenderedMap(clubId, latest.versionId, "group", group.groupId, rendered);
      if (result.status !== 200) { onMessage({ tone: "error", text: failure(result.status) }); return; }
      onMessage({ tone: "ok", text: text.toGroupDone((result.json as { updated: boolean }).updated) });
    } finally { setBusy(""); }
  }

  const latest = map.versions.find(version => version.versionId === map.latestVersionId);
  return <article className={styles.card} data-testid="club-map">
    <div className={checks.mapCard}>
      <MapThumbnail clubId={clubId} version={latest} name={map.name} />
      <div className={checks.rights}>
        <h3>{map.name}</h3>
        <p className={styles.small} data-testid="map-summary">{clubMapDuplicatesText.versions.summary(map.versions.length, map.years)} · {text.trainings(map.trainings)}</p>
        {map.description && <p className={styles.small}>{map.description}</p>}
        {map.maker && <p className={styles.small}>{clubMapDuplicatesText.versions.makerLabel(map.maker)}</p>}
        {admin && <label className={duplicates.select}><input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} />
          {clubMapDuplicatesText.duplicates.selection.select(map.name)}</label>}
        <MapAgreementSummary agreement={agreementOf(map)} />
        {admin && <MapRightsEditor clubId={clubId} map={map} onSaved={onChanged} />}
      </div>
    </div>
    <ul className={styles.versions}>
      {map.versions.map(version => <li key={version.versionId} data-testid="club-map-version">
        <div><strong>{version.fileName}</strong>
          {version.versionId === map.latestVersionId && <span className={styles.latest}>{text.latest}</span>}
          <VersionDetails clubId={clubId} map={map} version={version} admin={admin} onChanged={onChanged} onMessage={onMessage} />
          <div className={styles.small}>{version.versionDate ? `${version.versionDate} · ` : ""}{clubArchiveText.mb(version.byteLength)} · {text.trainings(version.trainings)}
            {version.note ? ` · ${version.note}` : ""}</div>
          <MapCheckChip check={version.check} explain /></div>
        <div className={styles.actions}>
          {mapBank && <a href={`${clubBase(clubId)}/map-versions/${version.versionId}`} download>{clubArchiveText.entry.downloadMap}</a>}
          {admin && <select aria-label={`${text.move} ${version.fileName}`} value="" disabled={busy !== ""}
            onChange={event => {
              const target = event.target.value;
              if (!target) return;
              const newName = target === "NEW" ? window.prompt(text.newMapName, map.name)?.trim() : null;
              if (target === "NEW" && !newName) return;
              void act(`move-${version.versionId}`, () => clubRequest(`${clubBase(clubId)}/map-versions/${version.versionId}/move`, "POST",
                { formatVersion: 1, targetMapId: target === "NEW" ? null : target, newMapName: target === "NEW" ? newName : null }), clubArchiveText.entry.saved);
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
        <summary>{clubMapDuplicatesText.mapInfo.title}</summary>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void act("update", () => clubRequest(`${clubBase(clubId)}/maps/${map.mapId}`,
          "PUT", { formatVersion: 1, name: name.trim(), agreement: agreementOf(map), description: description.trim(), maker: maker.trim() }),
          clubArchiveText.entry.saved); }}>
          <Field label={text.mapName}><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></Field>
          <Field label={clubMapDuplicatesText.mapInfo.description}><textarea value={description} maxLength={2000}
            onChange={event => setDescription(event.target.value)} /></Field>
          <Field label={clubMapDuplicatesText.mapInfo.maker} help={clubMapDuplicatesText.mapInfo.makerHelp}><input value={maker} maxLength={200}
            onChange={event => setMaker(event.target.value)} /></Field>
          <Button type="submit" disabled={busy !== "" || !name.trim()}>{clubArchiveText.entry.save}</Button>
        </form>
        <MapMakerToVersions clubId={clubId} map={map} onChanged={onChanged} onMessage={onMessage} />
      </details>
    </>}
    <MergeHistory clubId={clubId} map={map} admin={admin} onChanged={onChanged} onMessage={onMessage} />
  </article>;
}

/** ADR-0196: "Kontrollera alla kartor igen" med hur långt kontrollen har kommit. */
function RecheckBox({ checks: run }: { checks: Checks }) {
  const clubArchiveChecksText = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const state = run.state;
  const t = clubArchiveChecksSv;
  return <div className={checks.recheck} data-testid="recheck">
    <p className={styles.small}>{t.recheckHelp}</p>
    <div className={checks.buttons}>
      <Button variant="secondary" onClick={run.recheckAll} disabled={state.running && state.forced}>{t.recheckAll}</Button>
      {state.running && <Button variant="quiet" onClick={run.stop}>{clubArchiveChecksText.rights.cancel}</Button>}
    </div>
    {state.running && <p className={checks.progress} role="status" aria-live="polite">
      {state.forced ? t.progress(state.done, state.total, state.label) : t.progressAuto(state.done, state.total)}</p>}
    {!state.running && state.message && <Notice tone={state.message.tone} role={state.message.tone === "ok" ? "status" : "alert"}>{state.message.text}</Notice>}
  </div>;
}

/** ADR-0194 beslut 2 och 5: klubbens kartor med versioner, rättigheter, slå ihop och dela, ny version och gruppens bibliotek. */
export function ClubMapsPanel({ clubId, maps, admin, mapBank, onChanged, checks: run }: { clubId: string; maps: readonly ClubMapView[]; admin: boolean;
  mapBank: boolean;
  onChanged: () => Promise<void>; checks: Checks }) {
  const text = useTexts(clubArchiveSv.maps, clubArchiveEn.maps);
  const clubMapDuplicatesText = useTexts(clubMapDuplicatesSv, clubMapDuplicatesEn);
  const [message, setMessage] = useState<Message>();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const chosen = maps.filter(map => selected.has(map.mapId));
  const afterMerge = async () => { setSelected(new Set()); setMerging(false); await onChanged(); };
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
    {admin && maps.length > 0 && <RecheckBox checks={run} />}
    {admin && maps.length > 1 && <DuplicatesCard clubId={clubId} maps={maps} onChanged={onChanged} onMessage={setMessage} />}
    {maps.length === 0 && <EmptyState title={text.empty} />}
    {maps.map(map => <MapCard key={`${map.mapId}-${map.versions.length}-${map.name}-${map.description ?? ""}-${map.maker ?? ""}`} clubId={clubId} map={map}
      maps={maps} admin={admin} mapBank={mapBank} groups={mapBank ? groups : []} selected={selected.has(map.mapId)} onChanged={onChanged} onMessage={setMessage}
      onSelect={value => setSelected(current => { const next = new Set(current); if (value) next.add(map.mapId); else next.delete(map.mapId); return next; })} />)}
    {admin && chosen.length > 0 && <div className={duplicates.selectBar} data-testid="merge-selected">
      {merging && chosen.length >= 2 ? <div className={duplicates.picker}>
        <p className={duplicates.summary}>{clubMapDuplicatesText.duplicates.selection.title}</p>
        <MergeChooser key={chosen.map(map => map.mapId).join()} clubId={clubId} maps={chosen} keepDefault={defaultKeep(chosen)}
          label={clubMapDuplicatesText.duplicates.selection.title} onMerged={afterMerge} onMessage={setMessage} />
      </div> : <>
        <p className={duplicates.summary}>{clubMapDuplicatesText.duplicates.selection.count(chosen.length)}</p>
        <div className={duplicates.buttons}>
          <Button disabled={chosen.length < 2} onClick={() => setMerging(true)}>{clubMapDuplicatesText.duplicates.selection.merge}</Button>
          <Button variant="secondary" onClick={() => { setSelected(new Set()); setMerging(false); }}>{clubMapDuplicatesText.duplicates.selection.clear}</Button>
        </div>
      </>}
    </div>}
    {admin && <details className={styles.details}>
      <summary>{text.uploadNew}</summary>
      <UploadForm clubId={clubId} mapId={null} onDone={onChanged} onMessage={setMessage} />
    </details>}
  </section>;
}
