"use client";

import { useEffect, useState } from "react";
import type { NormResult } from "@o-tid/map-revision";
import type { MapProjectSession } from "../../lib/map-project-protocol";

/** Väntetiden efter en ändring innan kontrollen körs igen. */
const DEBOUNCE_MS = 500;

/** Normkontrollen: körs i Workern när den är påslagen och igen efter ändringar på kartan. */
export function useMapProjectNorm(session: MapProjectSession | undefined, renderKey: unknown) {
  const [active, setActive] = useState(false);
  const [result, setResult] = useState<NormResult>();
  useEffect(() => {
    if (!active || !session) return;
    const timer = setTimeout(() => session.norm(setResult), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, session, renderKey]);
  return { active, setActive: (value: boolean) => { setActive(value); if (!value) setResult(undefined); }, result: active ? result : undefined };
}
