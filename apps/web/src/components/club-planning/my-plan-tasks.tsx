"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MyPlanTasksResponse } from "@o-tid/contracts";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { planFailure, planRequest, shortDate } from "../../lib/club-planning-client";
import { useLanguage, useTexts } from "../language-provider";
import { Notice } from "../ui";
import styles from "./club-planning.module.css";
import { RacePrintFiles } from "../race-print-files";

/**
 * ADR-0221 beslut 3: Mina uppgifter på Mina tävlingar – bara de egna uppgifterna ur klubbarnas terminsplanering, med
 * träningens tid och plats, den ansvarige, de andra uppgifterna (utan personer) och banläggningen när träningen finns.
 * Visas inte alls utan uppgifter.
 */
export function MyPlanTasks() {
  const text = useTexts(clubPlanningSv, clubPlanningEn);
  const language = useLanguage();
  const [tasks, setTasks] = useState<MyPlanTasksResponse["tasks"]>();
  const [problem, setProblem] = useState<string>();
  const load = useCallback(async () => {
    const result = await planRequest("/api/organizer/plan-tasks");
    if (result.status === 200) { setTasks((result.json as MyPlanTasksResponse).tasks); setProblem(undefined); }
    else if (result.status !== 401) setProblem(text.mine.failed);
  }, [text]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(taskId: string, done: boolean) {
    setTasks(current => current?.map(task => task.taskId === taskId ? { ...task, done } : task));
    const result = await planRequest(`/api/organizer/plan-tasks/${taskId}`, "PUT", { formatVersion: 1, done });
    if (result.status !== 200) setProblem(planFailure(result.status, result.json, text));
    await load();
  }

  if (problem && !tasks) return <Notice tone="error" role="alert">{problem}</Notice>;
  if (!tasks || tasks.length === 0) return null;
  return <section className={styles.mine} aria-labelledby="my-plan-tasks-heading" data-testid="my-plan-tasks">
    <h2 id="my-plan-tasks-heading">{text.mine.title}</h2>
    <p className={styles.muted}>{text.mine.help}</p>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    <ul className={styles.mineList}>
      {tasks.map(task => <li key={task.taskId} data-testid="my-plan-task">
        <label className={styles.check}><input type="checkbox" checked={task.done} aria-label={`${text.mine.markDone}: ${task.title}`}
          onChange={event => void toggle(task.taskId, event.target.checked)} /><strong>{task.title}</strong></label>
        <p>{shortDate(task.sessionDate, language)}{task.startTime ? ` · ${task.startTime}` : ""} · {task.sessionTitle}
          {task.place ? ` · ${task.place}` : ""} · {task.clubName}</p>
        <p className={styles.small}>{[task.responsibleName ? text.mine.responsible(task.responsibleName) : "", task.mapName ?? ""].filter(Boolean).join(" · ")}</p>
        {task.otherTasks.length > 0 && <p className={styles.small}>{text.mine.otherTasks}: {task.otherTasks.map(other =>
          `${other.title}${other.done ? " ✓" : ""}`).join(", ")}</p>}
        {task.raceId ? <>
          <Link className={styles.link} href={`/admin/${task.raceId}/course-setting`}>{text.mine.courseSetting}</Link>
          {/* Ägaren 2026-11-10: de sparade utskrifterna, t.ex. för den som ska skriva ut kartorna. */}
          <RacePrintFiles raceId={task.raceId} canEdit={false} compact />
        </> : <p className={styles.small}>{text.mine.notCreated}</p>}
      </li>)}
    </ul>
  </section>;
}
