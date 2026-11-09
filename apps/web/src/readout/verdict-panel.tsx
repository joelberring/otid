/** Avläsningens besked (stort, med sträcktider, stafett, rogaining och placering) och raderna i Senaste avläsningar. */
import { useMemo } from "react";
import { readoutTextEn } from "./text-en";
import { useLanguage, useTexts } from "../components/language-provider";
import type { ReadoutPackage } from "@o-tid/contracts";
import { formatDuration } from "@o-tid/domain";
import { evaluateLocally, type LocalVerdict } from "./evaluate";
import type { QueuedReadout, QueuedRegistration } from "./store";
import { RegistrationStatus } from "./registration-form";
import { startPunchText } from "../lib/start-punch-text";
import { readoutText } from "./text-sv";
import { QrCode } from "./receipt-view";
import { PunchListView } from "./punch-list-view";
import type { receiptLink } from "./receipt";
import { placementLines, placementState, placementText } from "./placement-text";
import { placementLinesEn, placementTextEn } from "./placement-text-en";

export type Current =
  | { readonly phase: "reading"; readonly cardNumber: number }
  | { readonly phase: "failed"; readonly message: string; readonly at: number }
  | { readonly phase: "done"; readonly cardNumber: string; readonly localSequence: number; readonly verdict?: LocalVerdict; readonly invalid?: boolean };

/** Serverns status för avläsningen; en okänd bricka som sedan direktanmälts har anmälans bedömning (PLAN.md steg 25). */
function serverStatus(item: QueuedReadout | undefined, registration: QueuedRegistration | undefined) {
  const status = item?.serverResult?.status;
  if (status !== "UNKNOWN_CARD" || !registration || registration.status === "rejected") return status;
  return registration.response?.linkedResult?.status;
}
export function Verdict({ current, verdict, item, qr, registration, timeZone, online }: { current: Current | undefined; verdict: LocalVerdict | undefined;
  item: QueuedReadout | undefined; qr: ReturnType<typeof receiptLink> | undefined; registration: QueuedRegistration | undefined;
  timeZone: string; online: boolean }) {
  const t = useTexts(readoutText, readoutTextEn);
  if (!current) return <p className="big">{t.waitingForCard}</p>;
  if (current.phase === "reading") return <p className="big">{t.reading(current.cardNumber)}</p>;
  if (current.phase === "failed") return <p className="big">✗ {current.message}</p>;
  const symbol = !verdict ? "✓" : verdict.status === "OK" ? "✓" : verdict.status === "MP" || verdict.status === "OVERTIME" ? "✗" : "?";
  const server = serverStatus(item, registration);
  return <div className="verdict-layout"><div className="verdict-body">
    <p className="big">{symbol} {verdict ? t.verdict[verdict.status] : t.verdict.NO_PACKAGE}</p>
    <p className="card">Bricka {current.cardNumber}{verdict?.name ? ` · ${verdict.name}` : ""}{verdict?.className ? ` · ${verdict.className}` : ""}</p>
    {/* Hyrbricka (PLAN.md steg 25): en egen rad med ord och symbol, inte bara färg. */}
    {verdict?.rental ? <p className="rental" data-testid="verdict-rental">▲ {t.rental}</p> : null}
    {registration ? <RegistrationStatus registration={registration} className={verdict?.className ?? ""} /> : null}
    {verdict?.relay ? <RelayLine relay={verdict.relay} /> : null}
    {/* Steg 50: teamsprint – utläsningen gick inte att lägga på någon av löparens sträckor. */}
    {verdict?.teamSprintProblem ? <p role="alert" data-testid="verdict-team-sprint">{verdict.teamSprintProblem.kind === "ALL_READ"
      ? t.teamSprintAllRead : t.teamSprintEarlierFinish(verdict.teamSprintProblem.leg)}</p> : null}
    {verdict?.variant ? <p className="variant" data-testid="verdict-variant">{verdict.variant.assigned
      ? t.variant(verdict.variant.code) : t.variantGuessed(verdict.variant.code)}</p> : null}
    {verdict?.wrongMap ? <p role="note" className="start-note" data-testid="verdict-wrong-map">! {t.wrongMap(verdict.wrongMap.assignedCode,
      verdict.wrongMap.fittingCodes)}</p> : null}
    {verdict?.excludedVariant ? <p role="note" className="start-note" data-testid="verdict-excluded-variant">! {t.excludedVariant(verdict.excludedVariant)}</p> : null}
    {verdict?.rogaining && verdict.elapsedMs !== undefined ? <Rogaining score={verdict.rogaining} elapsedMs={verdict.elapsedMs}
      splits={verdict.splits} />
      : verdict?.elapsedMs !== undefined && (verdict.status === "OK" || verdict.status === "OVERTIME")
        ? <p className="time">{formatDuration(verdict.elapsedMs)}</p> : null}
    {verdict?.status === "OK" && (!server || server === "OK") ? <Placement item={item} online={online} /> : null}
    {/* Minutstart (PLAN.md steg 25): sen eller tidig startstämpling är en varning, inte en ny status. */}
    {verdict?.startNote ? <p className="start-note" role="note" data-testid="verdict-start-punch" data-kind={verdict.startNote.kind}>
      {verdict.startNote.kind === "FROM_PUNCH" ? "" : "! "}{startPunchText(verdict.startNote, timeZone)}</p> : null}
    {verdict?.ignoredPunches && !verdict.punchList ? <p className="start-note" role="note" data-testid="verdict-old-punches">! {t.ignoredPunches(verdict.ignoredPunches)}</p> : null}
    {verdict?.splitsMissing ? <p className="start-note" role="note" data-testid="verdict-no-splits">! {t.noSplits}</p> : null}
    {verdict && verdict.status !== "OK" ? <p>{t.reason[verdict.reason]}</p> : null}
    {verdict && verdict.missingControls.length > 0 ? <p>{t.missing(verdict.missingControls)}</p> : null}
    {verdict?.punchList ? <PunchListView list={verdict.punchList} timeZone={timeZone} /> : null}
    {!verdict ? <p>{t.noPackage}</p> : null}
    {verdict && !verdict.rogaining && verdict.splits.length > 0 ? <ol className="splits" aria-label={t.splits}>
      {verdict.splits.map((split, index) => <li key={index}>
        <span>{split.controlCode}</span> <span>{formatDuration(split.legMs)}</span> <span>({formatDuration(split.elapsedMs)})</span>
      </li>)}
    </ol> : null}
    {current.invalid ? <p>{t.localInvalid}</p> : null}
    {verdict && server && server !== verdict.status ? <p role="alert">{t.serverDiffers(t.verdict[server])}</p> : null}
    <p className="sync" data-testid="verdict-sync">{item?.status === "pending" ? t.savedLocally
      : item?.status === "rejected" ? t.rejected(item.rejectedReason ?? "")
      : item ? t.confirmed : t.savedLocally}</p>
  </div>
  {qr ? <figure className="verdict-qr" data-testid="screen-qr">
    <QrCode value={qr.url} label={t.receipt.scan} />
    <figcaption>{t.receipt.scan}{qr.published ? null : <small>{t.receipt.notPublished}</small>}</figcaption>
  </figure> : null}
  </div>;
}

/**
 * Steg 57: placeringen ur serverns kvitto ("2:a av 5 i mål · +0:30 efter Ada Ek", preliminärt). Innan servern svarat står
 * när den kommer; aldrig en gammal eller lokalt gissad placering.
 */
function Placement({ item, online }: { item: QueuedReadout | undefined; online: boolean }) {
  const en = useLanguage() === "en";
  const pt = en ? placementTextEn : placementText;
  const placement = placementState(item, online, en ? placementLinesEn : placementLines);
  if (placement.kind === "none") return null;
  if (placement.kind !== "known") return <p className="placement" data-state="waiting" data-testid="verdict-placement">
    {placement.kind === "offline" ? pt.offline : pt.sending}</p>;
  return <div className="placement" data-testid="verdict-placement" aria-label={pt.label}>
    <small>{pt.preliminary}</small>
    {placement.lines.map((line) => <span key={line}>{line}</span>)}
  </div>;
}
export function RecentRow({ item, pkg, local, registration }: { item: QueuedReadout; pkg: ReadoutPackage | undefined;
  local: readonly QueuedReadout["payload"][]; registration: QueuedRegistration | undefined }) {
  const t = useTexts(readoutText, readoutTextEn);
  // Bedöms om bara när avläsningen, paketet eller de tidigare avläsningarna ändras (inte vid varje stationshändelse).
  const verdict = useMemo(() => pkg ? evaluateLocally(item.payload, pkg, local, item.stationReceivedAt) : undefined,
    [item.payload, pkg, local.length, item.stationReceivedAt]);
  const status = serverStatus(item, registration) ?? verdict?.status;
  const queue = item.status === "pending" ? t.statusPending : item.status === "stored" ? t.statusStored
    : item.status === "duplicate" ? t.statusDuplicate : t.statusRejected;
  return <li data-sequence={item.localSequence}>
    <span className="card">{item.payload.cardNumber}</span>
    <span>{verdict?.name ?? ""}</span>
    <span>{status ? t.verdict[status] : ""}</span>
    <span className="queue">{queue}</span>
  </li>;
}

/**
 * Rogaining (ADR-0170 beslut 5): summan stort, kontrollpoäng och straff, tiden mot gränsen och de räknade
 * kontrollerna med poäng och tid från start. För sent märks med ord och symbol, inte bara färg.
 */
function Rogaining({ score, elapsedMs, splits }: { score: NonNullable<LocalVerdict["rogaining"]>; elapsedMs: number;
  splits: LocalVerdict["splits"] }) {
  const t = useTexts(readoutText, readoutTextEn);
  const times = new Map(splits.map((split) => [split.controlCode, split.elapsedMs]));
  return <>
    <p className="time" data-testid="verdict-total">{t.rogainingTotal(score.total)}</p>
    <p className="breakdown" data-testid="verdict-breakdown"><span>{t.rogainingBreakdown(score.controlPoints, score.penalty)}</span>
      {" · "}<span>{t.rogainingTime(formatDuration(elapsedMs), formatDuration(score.timeLimitMs))}</span></p>
    {score.overtimeMinutes > 0 ? <p className="late" data-testid="verdict-late">! {t.rogainingLate(score.overtimeMinutes)}</p> : null}
    {score.controls.length > 0 ? <ol className="splits" aria-label={t.rogainingControls}>
      {score.controls.map((control) => <li key={control.controlCode}>
        <span>{control.controlCode}</span> <span>{t.rogainingPoints(control.points)}</span>
        {times.has(control.controlCode) ? <> <span>({formatDuration(times.get(control.controlCode)!)})</span></> : null}
      </li>)}
    </ol> : null}
  </>;
}

/** Stafett: "Lag 12 OK Test · Sträcka 2 av 3 · Växlar till sträcka 3", eller lagets tid på sista sträckan. */
function RelayLine({ relay }: { relay: NonNullable<LocalVerdict["relay"]> }) {
  const t = useTexts(readoutText, readoutTextEn);
  const own = relay.legs.at(-1) ?? relay.leg;
  const last = own === relay.legCount;
  const team = relay.team;
  const outcome = !last ? t.relayNext(own + 1)
    : team.status === "OK" && team.elapsedMs !== undefined ? `${t.relayLast} – ${t.relayTeamTime(formatDuration(team.elapsedMs))}`
      : team.status === "RUNNING" ? `${t.relayLast} – ${t.relayTeamWaiting}` : `${t.relayLast} – ${t.relayTeamStatus[team.status]}`;
  // Steg 48: teamsprint – "Sträcka 1 och 3 av 4"; saknad växlingsstämpling sägs tydligt. Steg 50: utläsning efter varje
  // sträcka – "Lag 12 Ek – sträcka 3 (Ada Ek, andra sträckan)".
  const legs = relay.teamSprint ? t.relayTeamSprintLeg(relay.teamNumber, relay.teamName, relay.leg, relay.teamSprint.runner, relay.teamSprint.part)
    : relay.legs.length > 1 ? t.relayTeamLegs(relay.teamNumber, relay.teamName, relay.legs, relay.legCount)
      : t.relayTeam(relay.teamNumber, relay.teamName, relay.leg, relay.legCount);
  return <>
    <p className="relay" data-testid="verdict-relay">{legs} · {outcome}</p>
    {relay.teamSprint?.missingLegs.map(leg => <p key={leg} role="alert" data-testid="verdict-readout-missing">{t.teamSprintReadoutMissing(leg)}</p>)}
    {relay.changeoverMissing ? <p role="alert" data-testid="verdict-changeover">
      {t.relayChangeoverMissing(relay.changeoverMissing.found, relay.changeoverMissing.needed)}</p> : null}
  </>;
}
