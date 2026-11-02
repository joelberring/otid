"use client";

import { useCallback, useEffect, useRef } from "react";
import { coursePropertiesSv as text } from "../../i18n/course-setting-properties-sv";
import type { HistoryStep } from "../../lib/course-setting-editor";
import { historyToKeep, restoreHistory, usableHistory } from "../../lib/course-setting-history";
import type { FieldStore } from "../../lib/course-setting-offline";
import type { EditorStore } from "../../lib/course-setting-sync";

/**
 * ADR-0190 beslut 4: ångra efter omladdning. Läser sessionens ångra-historik ur telefonen när editorn öppnas och lägger
 * tillbaka de steg som fortfarande går (egna, inte ändrade av någon annan), och sparar den strax efter varje ändring av
 * historiken och när sidan göms. Inget skrivs innan den sparade historiken är läst (den skulle annars skrivas över).
 */
export function useCourseSettingHistory({ raceId, accountId, store, storage, enabled, say }: {
  raceId: string; accountId: string; store: EditorStore; storage: FieldStore; enabled: boolean;
  say: (message: { tone: "ok" | "attention"; text: string }) => void;
}): void {
  const ready = useRef(false);
  const written = useRef<{ past: readonly HistoryStep[]; future: readonly HistoryStep[] }>(undefined);
  const latest = useRef({ say });
  latest.current = { say };

  const write = useCallback(async () => {
    if (!ready.current || !enabled) return;
    const state = store.state;
    if (written.current && written.current.past === state.past && written.current.future === state.future) return;
    written.current = { past: state.past, future: state.future };
    const history = historyToKeep(raceId, accountId, state, new Date());
    try {
      if (history) await storage.writeHistory(history); else await storage.clearHistory(raceId);
    } catch (error) {
      written.current = undefined;
      console.error("Ångra-historiken kunde inte sparas i telefonen", error);
    }
  }, [raceId, accountId, store, storage, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    void storage.readHistory(raceId).then(raw => {
      if (closed) return;
      const stored = usableHistory(raw, raceId, accountId);
      if (!stored) return;
      let restored = 0, dropped = 0;
      store.update(state => {
        const result = restoreHistory(state, stored);
        restored = result.state.past.length - state.past.length;
        dropped = result.dropped;
        return result.state;
      });
      if (dropped > 0) latest.current.say({ tone: "attention", text: text.history.dropped(dropped) });
      else if (restored > 0) latest.current.say({ tone: "ok", text: text.history.restored(restored) });
    }, error => console.error("Ångra-historiken kunde inte läsas i telefonen", error)).finally(() => {
      if (closed) return;
      ready.current = true;
      void write();
    });
    return () => { closed = true; };
  }, [raceId, accountId, store, storage, enabled, write]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void write(); }, 500);
    });
    const now = () => { if (document.visibilityState === "hidden") { if (timer) clearTimeout(timer); void write(); } };
    document.addEventListener("visibilitychange", now);
    window.addEventListener("pagehide", now);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", now);
      window.removeEventListener("pagehide", now);
    };
  }, [store, write, enabled]);
}
