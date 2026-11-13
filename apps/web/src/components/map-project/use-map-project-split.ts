"use client";

import { useState } from "react";
import type { MapProjectAreaView, MapProjectView } from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import { mapProjectSplitEn } from "../../i18n/map-project-split-en";
import { mapProjectSplitSv } from "../../i18n/map-project-split-sv";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { nextPartNumber, planAreaSplit } from "../../lib/map-project-area-split";
import { mapProjectBase, mapProjectFailure } from "../../lib/map-project-client";
import { useTexts } from "../language-provider";

/**
 * Ägaren 2026-11-13: dela kartområdet (eller en del) med ett streck. Geometrin räknas i `map-project-area-split.ts`; här
 * sparas resultatet som vanliga delområden: det delade området krymper till sin största del (och behåller namn, kartritare
 * och läge) och de andra delarna blir nya områden "Del N" med samma kartritare och läge. De nya skapas först; går något
 * steg fel tas de bort igen och krympta områden får tillbaka sin form, så att inget överlappar eller saknas.
 */
export function useMapProjectSplit(input: { view: MapProjectView; areas: readonly MapProjectAreaView[]; bounds: Bounds | undefined;
  /** Delen som är vald i listan: då delas bara den. */
  only: string | undefined; reload: () => Promise<void>; say: (message: string) => void; done: () => void }) {
  const text = useTexts(mapProjectSplitSv, mapProjectSplitEn);
  const [busy, setBusy] = useState(false);
  const base = `${mapProjectBase(input.view.projectId)}/areas`;

  async function split(line: readonly Point[]): Promise<void> {
    if (busy) return;
    if (line.length < 2) { input.say(text.tooShort); return; }
    const { bounds, areas } = input;
    // Kartområdet: den nya kartans område, annars kartbladets utsträckning.
    const whole = input.view.area?.[0] && input.view.area[0].length >= 3 ? input.view.area
      : bounds ? [[{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }]] : undefined;
    const plan = planAreaSplit(areas, whole, line, areas.some(area => area.areaId === input.only) ? input.only : undefined);
    if (plan.status !== "split") {
      input.say(plan.status === "not-across" ? text.notAcross : plan.status === "too-complex" ? text.tooComplex
        : whole || areas.length ? text.outside : text.noMapArea);
      return;
    }
    const first = nextPartNumber(areas.map(area => area.name), text.partPrefix);
    const created: string[] = [], changed: MapProjectAreaView[] = [], names: string[] = [];
    const ok = (status: number) => status >= 200 && status < 300;
    setBusy(true);
    let failed: number | undefined;
    try {
      for (const [index, part] of plan.added.entries()) {
        const from = areas.find(area => area.areaId === part.from);
        const name = `${text.partPrefix} ${first + index}`;
        const result = await clubRequest(base, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), name, polygon: part.polygon,
          ...(from?.assignee ? { assigneeAccountId: from.assignee.accountId } : {}), ...(from ? { status: from.status } : {}) });
        if (!ok(result.status)) { failed = result.status; break; }
        created.push((result.json as { area: MapProjectAreaView }).area.areaId);
        names.push(name);
      }
      for (const change of failed === undefined ? plan.changed : []) {
        const before = areas.find(area => area.areaId === change.areaId)!;
        const result = await clubRequest(`${base}/${encodeURIComponent(change.areaId)}`, "PUT", { formatVersion: 1, polygon: change.polygon });
        if (!ok(result.status)) { failed = result.status; break; }
        changed.push(before);
        names.unshift(before.name);
      }
    } catch { failed = 0; }
    if (failed !== undefined) {
      // Ångra det som hann sparas (så gott det går; listan läses om och visar vad som gäller).
      for (const area of changed) await clubRequest(`${base}/${encodeURIComponent(area.areaId)}`, "PUT", { formatVersion: 1, polygon: area.polygon }).catch(() => undefined);
      for (const areaId of created) await clubRequest(`${base}/${encodeURIComponent(areaId)}`, "DELETE").catch(() => undefined);
    }
    await input.reload();
    setBusy(false);
    if (failed !== undefined) { input.say(mapProjectFailure(failed)); return; }
    input.say(text.done(names));
    input.done();
  }

  return { busy, split, hint: text.hint };
}
