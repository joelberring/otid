/**
 * Förslag (ADR-0181 beslut 3): ett förslag granskas ovanpå banan (förhandsvisning och banpåtryck), godkänns helt eller delvis
 * eller avböjs; den med SUGGEST skickar sina ändringar som ett förslag.
 */
import { useMemo, useState } from "react";
import { layoutOverprint, type CourseSettingDocument, type OverprintOptions, type OverprintPrimitive } from "@o-tid/course-setting";
import type { CourseSettingSuggestionDecided } from "@o-tid/contracts";
import { createCourseSettingSuggestion, decideCourseSettingSuggestion } from "../../lib/course-setting-api";
import { endSuggestion, wireCreated } from "../../lib/course-setting-editor";
import { previewSuggestion, suggestionOverlay } from "../../lib/course-setting-suggestion";
import { safely } from "../../lib/course-setting-safely";
import type { CourseSettingSync, EditorStore } from "../../lib/course-setting-sync";
import type { useCourseSettingCollaboration } from "./use-course-setting-collaboration";

export function useSuggestionReview({ raceId, document, options, radiusMm, view, variant, store, sync, collaboration }: {
  raceId: string; document: CourseSettingDocument; options: OverprintOptions; radiusMm: number; view: string; variant: string | undefined;
  store: EditorStore; sync: CourseSettingSync; collaboration: ReturnType<typeof useCourseSettingCollaboration>;
}) {
  const [reviewing, setReviewing] = useState<string>();
  const [skip, setSkip] = useState<ReadonlySet<number>>(new Set());
  const [decision, setDecision] = useState<{ suggestion: string; decided: CourseSettingSuggestionDecided } | { suggestion: string; failed: true }>();
  const reviewed = collaboration.suggestions.find(row => row.id === reviewing);
  const preview = useMemo(() => reviewed ? safely("Förslaget", () => previewSuggestion(document, reviewed, skip), () => undefined) : undefined,
    [reviewed, document, skip]);
  const suggestionDrawing = useMemo(() => {
    if (!preview) return undefined;
    const overlay = suggestionOverlay(document, preview.document);
    return { ...overlay, primitives: safely("Förslagets banpåtryck", () => layoutOverprint(preview.document, options), () => [] as readonly OverprintPrimitive[]),
      radiusMm };
  }, [preview, document, view, variant, radiusMm]);
  const rejectedInPreview = useMemo(() => new Set(preview?.rejected.map(row => row.index) ?? []), [preview]);
  async function decide(id: string, choice: "APPROVE" | "DECLINE", comment: string) {
    try {
      await sync.flush();
      const decided = await decideCourseSettingSuggestion(raceId, id, { decision: choice, ...(choice === "APPROVE" ? { skip: [...skip] } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setDecision({ suggestion: id, decided });
      if (decided.saved && decided.saved.applied > 0) sync.remote(decided.saved.version);
      setSkip(new Set());
      await collaboration.reloadSuggestions();
    } catch (error) { console.error("Beslutet sparades inte", error); setDecision({ suggestion: id, failed: true }); }
  }
  async function sendSuggestion(comment: string): Promise<boolean> {
    const current = store.state;
    if (!current.suggesting || current.log.length === 0) return false;
    try {
      await createCourseSettingSuggestion(raceId, { requestId: crypto.randomUUID(), baseVersion: current.suggesting.baseVersion,
        edits: current.log.map(entry => entry.edit) as never, created: current.log.map(entry => wireCreated(entry.created)), comment });
      store.update(next => endSuggestion(next, true));
      await collaboration.reloadSuggestions();
      return true;
    } catch (error) { console.error("Förslaget skickades inte", error); return false; }
  }
  return { reviewing, setReviewing, skip, setSkip, decision, setDecision, reviewed, suggestionDrawing, rejectedInPreview, decide, sendSuggestion };
}
