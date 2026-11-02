import { documentChanges, editTouches, type CourseSettingDocument } from "@o-tid/course-setting";
import type { EditorState, HistoryStep } from "./course-setting-editor";

/**
 * ADR-0190 beslut 4: ångra efter omladdning. Editorns ångra-historik för sessionen sparas i telefonen (IndexedDB, bredvid
 * offline-posten, `FieldStore.writeHistory`) med dokumentet som stegen gäller för och kontot som gjorde dem. När sidan
 * öppnas igen läggs stegen tillbaka, men bara
 *
 * - för samma konto (egna ändringar; en annan inloggning i samma webbläsare får ingen historik), och
 * - de steg vars objekt ingen annan har ändrat sedan dess: det som ett steg sätter tillbaka jämförs mellan det sparade
 *   dokumentet och det som editorn öppnas med (`documentChanges`, samma regel som när andras ändringar kommer in medan
 *   sidan är öppen). Egna sparade ändringar är desamma i båda och krockar inte.
 *
 * Högst `HISTORY_LIMIT` steg bakåt och framåt. Historiken tas bort vid utloggning (`clearAll`), när tillgången försvinner
 * och när dokumentet byts (inläst .ppen, återställd version). Förslagsläget sparar ingen historik (förslaget är inte sparat).
 * Ren logik; lagringen finns i `course-setting-offline-idb.ts`.
 */
export const HISTORY_LIMIT = 200;

export interface StoredHistory {
  readonly formatVersion: 1;
  readonly raceId: string;
  readonly accountId: string;
  /** Dokumentet som stegen gäller för (editorns, med osparade ändringar). */
  readonly document: CourseSettingDocument;
  readonly past: readonly HistoryStep[];
  readonly future: readonly HistoryStep[];
  /** Nästa löpnummer, så att nya åtgärder inte får samma som de sparade stegens. */
  readonly nextSeq: number;
  readonly savedAt: string;
}

/** Historiken att spara; undefined = inget att spara (tom, eller förslagsläget). */
export function historyToKeep(raceId: string, accountId: string, state: EditorState, now: Date): StoredHistory | undefined {
  if (state.suggesting) return undefined;
  const keep = (step: HistoryStep) => step.undo !== undefined;
  const past = state.past.filter(keep).slice(-HISTORY_LIMIT), future = state.future.filter(keep).slice(0, HISTORY_LIMIT);
  if (past.length === 0 && future.length === 0) return undefined;
  return { formatVersion: 1, raceId, accountId, document: state.dragBase ?? state.document, past, future, nextSeq: state.nextSeq,
    savedAt: now.toISOString() };
}

/** Den sparade historiken går att använda: rätt format, tävling och konto. */
export function usableHistory(stored: StoredHistory | undefined, raceId: string, accountId: string): StoredHistory | undefined {
  if (!stored || stored.formatVersion !== 1 || stored.raceId !== raceId || stored.accountId !== accountId) return undefined;
  if (!stored.document || !Array.isArray(stored.past) || !Array.isArray(stored.future)) return undefined;
  return stored;
}

/**
 * Lägger tillbaka de sparade stegen i editorn (före de steg som gjorts sedan sidan öppnades). Steg vars objekt någon annan
 * har ändrat sedan historiken sparades tas bort; `dropped` = hur många.
 */
export function restoreHistory(state: EditorState, stored: StoredHistory): { state: EditorState; dropped: number } {
  if (state.suggesting) return { state, dropped: 0 };
  const conflict = documentChanges(stored.document, state.document);
  let dropped = 0;
  const usable = (step: HistoryStep) => {
    if (!step.undo) return false;
    if (editTouches(step.undo).some(touch => conflict(touch, touch))) { dropped += 1; return false; }
    return true;
  };
  const past = stored.past.filter(usable);
  // Har något ändrats sedan sidan öppnades finns inget att göra om.
  const future = state.past.length > 0 ? [] : stored.future.filter(usable);
  if (past.length === 0 && future.length === 0) return { state, dropped };
  const seqs = [...past, ...future].flatMap(step => step.entries.map(entry => entry.seq));
  return {
    state: { ...state, past: [...past, ...state.past].slice(-HISTORY_LIMIT), future: [...state.future, ...future].slice(0, HISTORY_LIMIT),
      nextSeq: Math.max(state.nextSeq, stored.nextSeq, ...seqs.map(seq => seq + 1)) },
    dropped
  };
}
