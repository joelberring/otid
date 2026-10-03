"use client";

import React, { useState } from "react";
import { fixedStartSlotPlanResponseSchema, type FixedStartSlotPlanResponse } from "@o-tid/contracts";
import { formatStartListTime } from "../lib/start-list-time";
import { fixedStartSlotPlanSv as text } from "../i18n/fixed-start-slot-plan-sv";
import styles from "./race-administrator-workspace.module.css";

const PAGE_SIZE = 20;

export function FixedStartSlotPlans({ raceId, disabled }: { raceId: string; disabled: boolean }) {
  const [data, setData] = useState<FixedStartSlotPlanResponse>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<Record<string, number>>({});
  async function load() {
    if (loading || disabled) return;
    setLoading(true); setError(false);
    try {
      const response = await fetch(`/api/admin/races/${raceId}/administrator/fixed-start-slot-plans`, { cache: "no-store" });
      if (!response.ok) throw new Error("Startplansrapporten kunde inte läsas");
      setData(fixedStartSlotPlanResponseSchema.parse(await response.json()));
      setPages({});
    } catch { setError(true); } finally { setLoading(false); }
  }
  return <details className={styles.startSlotPlans}>
    <summary>{text.title}</summary>
    <p>{text.help}</p>
    <button type="button" className="secondary" disabled={disabled || loading} onClick={() => void load()}>{loading ? text.loading : text.load}</button>
    {error && <p className={styles.warning} role="status">{text.error}</p>}
    {data?.classes.length === 0 && <p>{text.empty}</p>}
    {data?.classes.map((raceClass) => <section className={styles.startSlotClass} key={raceClass.classId}>
      <h3>{raceClass.className}</h3>
      <p>{text.capacity}: {raceClass.maxEntries === null ? text.unlimited : `${raceClass.entryCount}/${raceClass.maxEntries} · ${raceClass.capacityRemaining} ${text.remaining}`}</p>
      {raceClass.plan.status === "UNAVAILABLE" ? <p className={styles.warning}>{raceClass.plan.reason === "NO_SAVED_DRAW" ? text.noSavedDraw : text.changed}</p>
        : hasAvailablePlan(raceClass) && <SlotTable raceClass={raceClass} timeZone={data.timeZone} page={pages[raceClass.classId] ?? 0}
          setPage={(page) => setPages(current => ({ ...current, [raceClass.classId]: page }))} />}
    </section>)}
  </details>;
}

type AvailableClass = Omit<FixedStartSlotPlanResponse["classes"][number], "plan"> & {
  plan: Extract<FixedStartSlotPlanResponse["classes"][number]["plan"], { status: "AVAILABLE" }>;
};
function hasAvailablePlan(value: FixedStartSlotPlanResponse["classes"][number]): value is AvailableClass {
  return value.plan.status === "AVAILABLE";
}

function SlotTable({ raceClass, timeZone, page, setPage }: {
  raceClass: AvailableClass;
  timeZone: string; page: number; setPage: (page: number) => void;
}) {
  const plan = raceClass.plan;
  const lastPage = Math.max(0, Math.ceil(plan.slots.length / PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  const rows = plan.slots.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return <>
    <p>{text.plan}: <time dateTime={plan.drawnAt}>{formatStartListTime(plan.drawnAt, timeZone)}</time> · {plan.slots.filter(slot => slot.state === "VACANT").length} {text.vacant.toLocaleLowerCase()}</p>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text.slots}>
      <table className={styles.table}><thead><tr><th>{text.slots}</th><th>{text.occupied}</th></tr></thead><tbody>
        {rows.map((slot) => <tr key={slot.fixedStartTime}><td><time dateTime={slot.fixedStartTime}>{formatStartListTime(slot.fixedStartTime, timeZone)}</time></td>
          <td>{slot.state === "OCCUPIED" ? slot.entry.displayName : text.vacant}</td></tr>)}
      </tbody></table>
    </div>
    <div className={styles.toolbar}>
      <button type="button" className="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>{text.previous}</button>
      <span>{text.page} {current + 1}/{lastPage + 1} · {text.shown} {rows.length}/{plan.slots.length}</span>
      <button type="button" className="secondary" disabled={current === lastPage} onClick={() => setPage(current + 1)}>{text.next}</button>
    </div>
    {plan.unassignedEntries.length > 0 && <p>{text.unassigned}: {plan.unassignedEntries.map(entry => entry.displayName).join(", ")}</p>}
  </>;
}
