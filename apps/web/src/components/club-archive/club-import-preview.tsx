"use client";

import { SKIP_LABELS, STATUS_LABELS, type ImportPlan, type ScannedFile, type SkipCategory } from "@o-tid/club-archive";
import { clubWebImportEn } from "../../i18n/club-archive-more-en";
import { useTexts } from "../language-provider";
import { clubWebImportSv } from "../../i18n/club-import-web-sv";
import { Notice } from "../ui";
import styles from "./club-archive.module.css";

const LIST_MAX = 300;

export interface ServerState { readonly known: ReadonlySet<string>; readonly knownEntries: ReadonlySet<string> }

/** Vad förhandsgranskningen räknar med (samma som importen sedan gör). */
export function previewNumbers(plan: ImportPlan, server: ServerState) {
  const versions = plan.maps.flatMap(map => map.versions);
  const upload = versions.filter(version => !server.known.has(version.sha256));
  const existingEntries = plan.trainings.filter(training => server.knownEntries.has(training.key)).length;
  return { versions: versions.length, upload: upload.length, uploadBytes: upload.reduce((sum, version) => sum + version.size, 0),
    newEntries: plan.trainings.length - existingEntries, existingEntries };
}

function Paths({ paths, summary }: { paths: readonly string[]; summary: string }) {
  const text = useTexts(clubWebImportSv, clubWebImportEn);
  if (paths.length === 0) return null;
  return <details className={styles.details}>
    <summary>{summary}</summary>
    <ul className={styles.pathList}>
      {paths.slice(0, LIST_MAX).map(path => <li key={path}>{path}</li>)}
      {paths.length > LIST_MAX && <li>{text.more(paths.length - LIST_MAX)}</li>}
    </ul>
  </details>;
}

/**
 * ADR-0204: förhandsgranskningen, samma uppgifter som kommandots `--dry-run`: träningarna (nya och de som finns), kartorna och
 * versionerna (det som laddas upp och det servern har), banfilerna, utrymmet, det som inte skickas och det att titta på.
 */
export function ClubImportPreview({ plan, scanned, problems, server, quota }: { plan: ImportPlan; scanned: readonly ScannedFile[];
  problems: readonly string[]; server: ServerState; quota: { used: number; limit: number | null } }) {
  const text = useTexts(clubWebImportSv, clubWebImportEn);
  const numbers = previewNumbers(plan, server);
  const t = plan.totals;
  const count = (status: keyof typeof STATUS_LABELS) => plan.trainings.filter(training => training.status === status).length;
  const missing = plan.trainings.filter(training => training.status === "MAP_MISSING");
  const skipped = scanned.filter(file => file.kind === "SKIP").map(file => file.path);
  const overflow = quota.limit === null ? 0 : quota.used + numbers.uploadBytes - quota.limit;
  const nothing = plan.trainings.length === 0 && plan.maps.length === 0;
  return <div className={styles.previewReport} data-testid="import-preview">
    <h3>{text.previewTitle}</h3>
    {nothing ? <Notice tone="attention">{text.nothingFound}</Notice> : <>
      <p><strong>{text.trainings(plan.trainings.length)}</strong>. {text.trainingsNew(numbers.newEntries, numbers.existingEntries)}</p>
      <ul className={styles.plainList}>
        {(["COMPLETE", "COURSES_RESOLVED", "MAP_MISSING", "MAP_ONLY"] as const).filter(status => count(status) > 0)
          .map(status => <li key={status}>{text.statusLine(count(status), STATUS_LABELS[status])}</li>)}
      </ul>
      <p>{text.maps(t.uniqueMaps, plan.maps.length, t.uniqueMapBytes)}. {text.mapsNew(numbers.upload, numbers.uploadBytes, numbers.versions - numbers.upload)}</p>
      <p>{text.courses(t.ppen, t.courseData, t.courseBytes)}.</p>
      <p className={styles.small}>{text.quota(quota.used, numbers.uploadBytes, quota.limit)}</p>
      {overflow > 0 && <Notice tone="error">{text.quotaFull(overflow)}</Notice>}
      {numbers.upload === 0 && numbers.newEntries === 0 && <Notice tone="ok">{text.nothingNew}</Notice>}
    </>}
    <h4>{text.notSentTitle}</h4>
    {skipped.length === 0 ? <p className={styles.small}>{text.notSentNone}</p> : <>
      <ul className={styles.plainList} data-testid="import-not-sent">
        {(Object.entries(plan.skippedFiles) as [SkipCategory, { files: number; bytes: number }][])
          .map(([category, value]) => <li key={category}>{text.notSentLine(value.files, SKIP_LABELS[category], value.bytes)}</li>)}
      </ul>
      <Paths paths={skipped} summary={text.showFiles(skipped.length)} />
    </>}
    {(problems.length > 0 || missing.length > 0 || plan.skippedFolders.length > 0) && <>
      <h4>{text.problemsTitle}</h4>
      <ul className={styles.plainList} data-testid="import-problems">
        {problems.map(problem => <li key={problem} className={styles.warning}>{problem}</li>)}
        {missing.length > 0 && <li>{text.mapMissing(missing.length)}</li>}
        {plan.skippedFolders.length > 0 && <li>{text.emptyFolders(plan.skippedFolders.length)}</li>}
      </ul>
      <Paths paths={missing.map(training => training.path)} summary={`${text.showList}: ${STATUS_LABELS.MAP_MISSING}`} />
      <Paths paths={plan.skippedFolders.map(folder => folder.path)} summary={`${text.showList}: ${text.emptyFolders(plan.skippedFolders.length)}`} />
    </>}
  </div>;
}
