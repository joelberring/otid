"use client";

import { useEffect, useState } from "react";
import { bingoAdminViewSchema, type BingoMode } from "@o-tid/contracts";
import { courseSettingBase } from "../../lib/course-setting-api";
import { mobileExerciseApplies, mobileExerciseLink, type MobileExercise } from "../../lib/mobile-exercise";
import type { Workspace } from "./workspace-state";

/**
 * Översynen 2026-11-17: raden "Övning i mobilen" (sidopanelen och Meny). Läget hämtas en gång för administratören; utan svar
 * visar Träning ändå vägen till banläggningen.
 */
export function useMobileExercise(ws: Workspace): MobileExercise | undefined {
  const { authenticated, data, functionary, raceId } = ws;
  const raceType = data?.raceType;
  const applies = authenticated && mobileExerciseApplies(raceType, !functionary);
  const [bingo, setBingo] = useState<{ raceId: string; enabled: boolean; mode: BingoMode }>();
  useEffect(() => {
    if (!applies) return;
    const controller = new AbortController();
    void fetch(`${courseSettingBase(raceId)}/bingo`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const view = bingoAdminViewSchema.parse(await response.json());
        setBingo({ raceId, enabled: view.enabled, mode: view.mode });
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) console.warn("Övningens läge kunde inte hämtas", error); });
    return () => controller.abort();
  }, [applies, raceId]);
  if (!raceType || !authenticated) return undefined;
  return mobileExerciseLink({ raceId, raceType, admin: !functionary, bingo: bingo?.raceId === raceId ? bingo : undefined });
}
