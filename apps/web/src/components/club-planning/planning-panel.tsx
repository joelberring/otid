"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClubPlanResponse } from "@o-tid/contracts";
import { termWeeks } from "@o-tid/domain";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { planningBase, planFailure, planRequest, shortDate } from "../../lib/club-planning-client";
import { useLanguage, useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import { PlanArchivePicker } from "./plan-archive-picker";
import { PlanSessionCard, type PlanChange } from "./plan-session-card";
import { PlanTermCopy } from "./plan-term-copy";
import { planCopyEn } from "../../i18n/club-plan-copy-en";
import { planCopySv } from "../../i18n/club-plan-copy-sv";
import { PlanSessionForm } from "./plan-session-form";
import { PlanTermForm } from "./plan-term-form";
import styles from "./club-planning.module.css";

type Message = { tone: "ok" | "error"; text: string };

/**
 * ADR-0221: fliken Planering i klubbytan. Terminen vecka för vecka (tomma veckor syns), med de planerade träningarna, deras
 * ansvariga och uppgifter. Ledare, administratörer och ägare; behörigheten avgörs av API:et.
 */
export function PlanningPanel({ clubId }: { clubId: string }) {
  const text = useTexts(clubPlanningSv, clubPlanningEn);
  const copyText = useTexts(planCopySv, planCopyEn);
  /** Ägaren 2026-11-12: Hämta ur arkivet – veckan och dagen att börja med. */
  const [fetching, setFetching] = useState<{ week: number; date: string }>();
  const language = useLanguage();
  const [plan, setPlan] = useState<ClubPlanResponse>();
  const [termId, setTermId] = useState<string | null>(null);
  /** Terminen som nästa läsning ska ta (översynen B1: en ny eller borttagen termin ska inte läsas om med den gamla). */
  const chosen = useRef<string | null>(null);
  const selectTerm = useCallback((id: string | null) => { chosen.current = id; setTermId(id); }, []);
  const [failed, setFailed] = useState<string>();
  const [message, setMessage] = useState<Message>();
  const [termForm, setTermForm] = useState<"new" | "edit">();
  /** Ny träning: datumet att börja med (veckans måndag eller terminens första dag). */
  const [adding, setAdding] = useState<string>();
  const [busy, setBusy] = useState(false);
  const base = planningBase(clubId);

  const load = useCallback(async (term: string | null = chosen.current) => {
    const result = await planRequest(term ? `${base}?term=${encodeURIComponent(term)}` : base);
    if (result.status !== 200) { setFailed(planFailure(result.status, result.json, text)); return; }
    setFailed(undefined);
    const next = result.json as ClubPlanResponse;
    setPlan(next);
    selectTerm(next.term?.termId ?? null);
  }, [base, selectTerm, text]);
  // Första läsningen (terminen som pågår); senare läsningar tar den valda terminen.
  const [first] = useState(() => () => load(null));
  useEffect(() => { void first(); }, [first]);

  /** Ett anrop som ändrar planen; planen läses om efteråt. */
  const change: PlanChange = useCallback(async (path, method, body, done) => {
    setBusy(true);
    setMessage(undefined);
    const result = await planRequest(`${base}${path}`, method, body);
    setBusy(false);
    if (result.status !== 200) { setMessage({ tone: "error", text: planFailure(result.status, result.json, text) }); return false; }
    const shown = done?.(result.json);
    if (shown) setMessage({ tone: "ok", text: shown });
    await load();
    return true;
  }, [base, load, text]);

  const term = plan?.term;
  const weeks = useMemo(() => term ? termWeeks(term.startsOn, term.endsOn) : [], [term]);
  if (!plan) return failed ? <Notice tone="error" role="alert">{failed}</Notice> : <p role="status">{text.loading}</p>;

  return <section data-testid="club-planning" className={styles.planning}>
    <p className={`${styles.muted} ${styles.noPrint}`}>{text.help}</p>
    {failed && <Notice tone="error" role="alert">{failed}</Notice>}
    <div className={`${styles.termBar} ${styles.noPrint}`}>
      {plan.terms.length > 0 && <label className={styles.termChoice}><span>{text.term.choose}</span>
        <select value={termId ?? ""} onChange={event => { selectTerm(event.target.value); void load(event.target.value); }}>
          {plan.terms.map(option => <option key={option.termId} value={option.termId}>{option.name} · {text.term.sessions(option.sessions)}</option>)}
        </select></label>}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setTermForm(termForm === "new" ? undefined : "new")} aria-expanded={termForm === "new"}>{text.term.add}</Button>
        {term && <Button variant="quiet" onClick={() => setTermForm(termForm === "edit" ? undefined : "edit")} aria-expanded={termForm === "edit"}>{text.term.edit}</Button>}
        {term && <a className={styles.link} href={`/organizer/clubs/${encodeURIComponent(clubId)}/planering/utskrift?term=${encodeURIComponent(term.termId)}`}
          target="_blank" rel="noopener">{text.term.print}</a>}
      </div>
    </div>
    {termForm && <PlanTermForm key={termForm === "edit" && term ? term.termId : "new"} term={termForm === "edit" ? term ?? undefined : undefined} busy={busy} onCancel={() => setTermForm(undefined)}
      onSave={async (body, existing) => {
        const saved = existing
          ? await change(`/terms/${existing}`, "PUT", body)
          : await change("", "POST", body, json => { const created = (json as { termId?: string }).termId; if (created) selectTerm(created); return undefined; });
        if (saved) setTermForm(undefined);
      }}
      onRemove={term && term.sessions === 0 ? async () => {
        if (window.confirm(text.term.removeConfirm) && await change(`/terms/${term.termId}`, "DELETE", undefined, () => { selectTerm(null); return undefined; })) {
          setTermForm(undefined);
        }
      } : undefined} />}
    {message && <div className={styles.noPrint}><Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice></div>}
    {!term ? <p>{text.term.none}</p> : <>
      {term.planSessions.length === 0 && <PlanTermCopy key={term.termId} termId={term.termId} terms={plan.terms} busy={busy} change={change} />}
      {fetching && <PlanArchivePicker clubId={clubId} termId={term.termId} week={fetching.week} initialDate={fetching.date} minDate={term.startsOn}
        maxDate={term.endsOn} onDone={shown => { setFetching(undefined); if (shown) setMessage({ tone: "ok", text: shown }); void load(); }} />}
      <h2 className={styles.termTitle}>{term.name} <span>{text.term.dates(shortDate(term.startsOn, language), shortDate(term.endsOn, language))}</span></h2>
      <ol className={styles.weeks}>
        {weeks.map(week => {
          const planned = term.planSessions.filter(row => row.sessionDate >= week.monday && row.sessionDate <= week.sunday);
          const first = week.monday < term.startsOn ? term.startsOn : week.monday;
          // Användartestet 2026-11-12 (F): i innevarande vecka föreslås dagens datum, inte en måndag som redan varit.
          const today = new Date().toLocaleDateString("sv-SE");
          const suggested = today > first && today <= week.sunday && today <= term.endsOn ? today : first;
          return <li key={week.monday} className={styles.week} data-testid="plan-week" aria-label={text.week.title(week.week)}>
            <div className={styles.weekHead}>
              <h3>{text.week.title(week.week)} <span>{shortDate(first, language)} – {shortDate(week.sunday < term.endsOn ? week.sunday : term.endsOn, language)}</span></h3>
              <span className={`${styles.actions} ${styles.noPrint}`}>
                <Button variant="quiet" aria-label={text.week.addInWeek(week.week)} disabled={busy} onClick={() => setAdding(suggested)}>{text.week.add}</Button>
                <Button variant="quiet" aria-label={copyText.fromArchiveInWeek(week.week)} disabled={busy}
                  onClick={() => setFetching({ week: week.week, date: suggested })}>{copyText.fromArchive}</Button>
              </span>
            </div>
            {adding !== undefined && adding >= week.monday && adding <= week.sunday && <PlanSessionForm key={adding} plan={plan} termId={term.termId}
              initialDate={adding} busy={busy} onCancel={() => setAdding(undefined)} onSave={async body => {
                if (await change("/sessions", "POST", body, json => {
                  const created = json as { sessionIds?: string[]; mailed?: boolean };
                  return `${text.session.created(created.sessionIds?.length ?? 1)}${created.mailed ? ` ${text.session.responsibleMailed}` : ""}`;
                })) {
                  setAdding(undefined);
                }
              }} />}
            {planned.length === 0 ? <p className={styles.empty}>{text.week.empty}</p>
              : planned.map(row => <PlanSessionCard key={row.sessionId} plan={plan} session={row} busy={busy} change={change}
                termId={term.termId} reload={() => load()} />)}
          </li>;
        })}
      </ol>
    </>}
  </section>;
}
