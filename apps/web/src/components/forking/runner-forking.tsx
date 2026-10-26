"use client";

import { useMemo } from "react";
import type { CourseForkingView } from "@o-tid/contracts";
import { forkingLetters } from "@o-tid/domain";
import { forkingSv as text } from "../../i18n/forking-sv";
import { ForkingDiagram } from "./forking-diagram";

/** Steg 49: liten banbild med löparens variant markerad (vilka grenar och i vilken ordning slingorna sprangs). */
export function RunnerForking({ view, code, name, compact = true }: { view: CourseForkingView; code: string; name: string; compact?: boolean }) {
  const letters = useMemo(() => forkingLetters({ items: view.items }), [view.items]);
  const variant = view.variants.find(row => row.code === code);
  const lengths = view.variants.map(row => row.lengthMeters);
  const shortest = lengths.every((value): value is number => value !== null) && lengths.length > 0 ? Math.min(...lengths) : null;
  if (!variant) return null;
  const difference = shortest === null || variant.lengthMeters === null ? null : variant.lengthMeters - shortest;
  return <ForkingDiagram items={view.items} letters={letters} choices={variant.choices} compact={compact}
    label={text.runnerDiagram(name, code)}
    caption={compact ? undefined : <><strong>{text.variantLength(code, variant.lengthMeters, difference)}</strong>
      {view.items.some(item => item.kind === "LOOP") && <span>{text.loopOrder}</span>}</>} />;
}
