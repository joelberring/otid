"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ClubPlanResponse } from "@o-tid/contracts";
import { termWeeks } from "@o-tid/domain";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { planFailure, planningBase, planRequest, shortDate } from "../../lib/club-planning-client";
import { useLanguage, useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import styles from "./club-planning.module.css";

/**
 * ADR-0221, översynen 2026-11-10 G6: terminen som en egen sida för utskrift (i stället för en regel som gömmer resten av
 * klubbsidan). Bara läsning: veckorna, träningarna, de ansvariga och uppgifterna.
 */
export function PlanPrint({ clubId, termId }: { clubId: string; termId: string | null }) {
  const text = useTexts(clubPlanningSv, clubPlanningEn);
  const language = useLanguage();
  const [plan, setPlan] = useState<ClubPlanResponse>();
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    const base = planningBase(clubId);
    void planRequest(termId ? `${base}?term=${encodeURIComponent(termId)}` : base).then(result => {
      if (result.status === 200) setPlan(result.json as ClubPlanResponse);
      else setFailed(planFailure(result.status, result.json, text));
    }, () => setFailed(planFailure(0, undefined, text)));
  }, [clubId, termId, text]);
  const term = plan?.term;
  const weeks = useMemo(() => term ? termWeeks(term.startsOn, term.endsOn) : [], [term]);
  if (failed) return <Notice tone="error" role="alert">{failed}</Notice>;
  if (!plan) return <p role="status">{text.loading}</p>;
  return <section className={styles.printPage} data-testid="plan-print">
    <div className={`${styles.actions} ${styles.noPrint}`}>
      <Button onClick={() => window.print()}>{text.term.printNow}</Button>
      <Link className={styles.link} href={`/organizer/clubs/${encodeURIComponent(clubId)}`}>{text.term.printBack}</Link>
    </div>
    {!term ? <p>{text.term.none}</p> : <>
      <h1 className={styles.termTitle}>{term.name} <span>{text.term.dates(shortDate(term.startsOn, language), shortDate(term.endsOn, language))}</span></h1>
      <ol className={styles.weeks}>
        {weeks.map(week => {
          const planned = term.planSessions.filter(row => row.sessionDate >= week.monday && row.sessionDate <= week.sunday);
          return <li key={week.monday} className={styles.week}>
            <h2>{text.week.title(week.week)}</h2>
            {planned.length === 0 ? <p className={styles.empty}>{text.week.empty}</p> : planned.map(row => <article key={row.sessionId} className={styles.session}>
              <p className={styles.when}>{shortDate(row.sessionDate, language)}{row.startTime ? ` · ${row.startTime}` : ""}</p>
              <h3>{row.title}</h3>
              <p className={styles.small}>{[row.place, row.mapName ? text.session.mapIs(row.mapName) : "", row.groupName ? text.session.groupIs(row.groupName) : ""]
                .filter(Boolean).join(" · ")}</p>
              <p className={styles.small}>{row.responsibleName ? text.session.responsibleIs(row.responsibleName) : text.session.noResponsibleYet}</p>
              {row.note && <p className={styles.note}>{row.note}</p>}
              {row.tasks.length > 0 && <ul className={styles.small} aria-label={text.term.printTasks}>
                {row.tasks.map(task => <li key={task.taskId}>{task.done ? "☑" : "☐"} {task.title}{task.assigneeName ? ` – ${task.assigneeName}` : ""}</li>)}
              </ul>}
            </article>)}
          </li>;
        })}
      </ol>
    </>}
  </section>;
}
