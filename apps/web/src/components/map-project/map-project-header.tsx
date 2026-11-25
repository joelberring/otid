"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MapProjectMode, MapProjectView } from "@o-tid/contracts";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import { mapProjectKeysEn, mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { keyLabel, type KeyMap } from "../../lib/map-project-keys";
import { useTexts } from "../language-provider";
import { AccountMenu } from "../account-menu";
import { HelpButton } from "../help/help-panel";
import { MapProjectPrintButton } from "./map-project-print-button";
import { SyncBadge } from "./map-project-sync-badge";
import type { useMapProjectEditor } from "./use-map-project-editor";
import styles from "./map-project-editor.module.css";

/**
 * Editorns rubrikrad (utbruten ur `map-project-editor.tsx`): tillbakalänk som sparar först, lägesmärke för förslag/huvudkartritare,
 * tydlig synkstatus, vy-meny (inkl. inställningen för åtgärdsraden vid det markerade), bara kartan, PDF, hjälp och konto.
 */
export function MapProjectHeader({ view, sync, pending, flush, collabMode, onOpenReview, bare, onToggleBare, keys, contextRow, onContextRow }: {
  view: MapProjectView;
  sync: ReturnType<typeof useMapProjectEditor>["sync"];
  pending: number;
  flush: () => Promise<void>;
  collabMode: MapProjectMode;
  onOpenReview: () => void;
  bare: boolean;
  onToggleBare: () => void;
  keys: KeyMap;
  contextRow: boolean;
  onContextRow: (on: boolean) => void;
}) {
  const router = useRouter();
  const text = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const quick = useTexts(mapProjectQuickSv, mapProjectQuickEn);
  const keysText = useTexts(mapProjectKeysSv, mapProjectKeysEn);
  const [viewOpen, setViewOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setViewOpen(false); } };
    const onDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setViewOpen(false); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onDown, true); };
  }, [viewOpen]);

  const backHref = `/organizer/map-projects/${encodeURIComponent(view.projectId)}`;
  const proposeOnly = view.viewer.canPropose && !view.viewer.canEdit;
  const showModePill = proposeOnly || collabMode === "LEAD";
  const modePillLabel = proposeOnly ? text.collab.proposePill : text.collab.modes.LEAD;
  const modePillTitle = proposeOnly ? text.collab.suggestHint : text.collab.modeHelp.LEAD;

  return <header className={styles.header}>
    <div className={styles.title}>
      <Link className={styles.back} href={backHref} data-testid="map-project-back"
        onClick={event => {
          if (pending === 0) return;
          event.preventDefault();
          void flush().finally(() => router.push(backHref));
        }}>
        <span aria-hidden="true">‹</span> <span className={styles.backText}>{text.back}</span>
      </Link>
      <h1>{view.name}</h1>
    </div>
    {showModePill && <button type="button" className={styles.modePill} title={modePillTitle} data-testid="map-project-mode-pill"
      onClick={onOpenReview}>{modePillLabel}</button>}
    <SyncBadge sync={sync} pending={pending} />
    <div className={styles.viewMenu} ref={menuRef}>
      <button type="button" className={styles.bareToggle} aria-haspopup="true" aria-expanded={viewOpen} data-testid="map-project-view-menu"
        onClick={() => setViewOpen(open => !open)}>{quick.viewMenu} <span aria-hidden="true">▾</span></button>
      {viewOpen && <div className={styles.viewMenuList} role="group" aria-label={quick.viewMenu}>
        <label className={styles.viewMenuItem}>
          <input type="checkbox" checked={contextRow} onChange={event => onContextRow(event.target.checked)} data-testid="map-project-context-setting" />
          <span>{keysText.contextRow}</span>
        </label>
        <p className={styles.viewMenuHelp}>{keysText.contextRowHelp}</p>
      </div>}
    </div>
    <button type="button" className={styles.bareToggle} aria-pressed={bare}
      title={keys.bare ? `${quick.bareHelp} (${keyLabel(keys.bare, keysText.space, keysText.section)})` : quick.bareHelp}
      data-testid="map-project-bare" onClick={onToggleBare}>{bare ? quick.showPanels : quick.hidePanels}</button>
    <MapProjectPrintButton projectId={view.projectId} pending={pending} />
    <HelpButton view="MAP_EDITOR" compact />
    <AccountMenu />
  </header>;
}
