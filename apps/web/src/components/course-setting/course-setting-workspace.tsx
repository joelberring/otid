"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { CourseSettingDocument, CourseSummary } from "@o-tid/course-setting";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { collaborationSv as copy } from "../../i18n/course-setting-collaboration-sv";
import type { Tool } from "../../lib/course-setting-editor";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

/**
 * Steg 66 (ägaren: "kartan i så mycket helskärm som möjligt … funktionerna synliga på bättre sätt"): arbetsytan. Kartan
 * fyller fönstret under en smal rad; verktygen flyter ovanpå kartan; panelerna är en låda med flikar till höger som kan
 * fällas ihop och ändras i bredd (på smal skärm ett blad nerifrån). Sidan skrollar aldrig; varje flik skrollar för sig.
 */
export type TopBarProps = {
  raceId: string; document: CourseSettingDocument; summaries: readonly CourseSummary[]; view: string; variant: string | undefined;
  onView: (view: string, variant?: string) => void; status: ReactNode; access: ReactNode; presence: string;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; menu: readonly { label: string; onClick: () => void }[];
};

export function TopBar({ raceId, document, summaries, view, variant, onView, status, access, presence, canUndo, canRedo, onUndo, onRedo, menu }: TopBarProps) {
  const [open, setOpen] = useState(false);
  // Menyn ligger fast i fönstret under knappen, högerjusterad mot knappen så att den aldrig hamnar utanför bild.
  const [menuAt, setMenuAt] = useState<{ top: number; right: number }>();
  const [full, setFull] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const change = () => setFull(window.document.fullscreenElement !== null);
    window.document.addEventListener("fullscreenchange", change);
    return () => window.document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const courses = [...document.courses].sort((a, b) => a.order - b.order);
  const variants = summaries.find(row => row.course === view)?.variants ?? [];
  return <header className={styles.topbar}>
    <Link className={styles.back} href={`/admin/${raceId}/manage`} title={text.back}>← <span className={styles.wide}>{text.title}</span></Link>
    <label className={`${styles.inline} ${styles.viewPicker}`}><span className={styles.srOnly}>{copy.topbar.course}</span>
      <select value={view} onChange={event => onView(event.target.value)} data-testid="course-setting-view">
        <option value={ALL_CONTROLS}>{text.courses.all}</option>
        {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
      </select></label>
    {variants.length > 1 && <label className={`${styles.inline} ${styles.viewPicker}`}><span className={styles.srOnly}>{copy.topbar.variant}</span>
      <select value={variant ?? ""} onChange={event => onView(view, event.target.value || undefined)}>
        <option value="">{text.courses.allVariants}</option>
        {variants.map(row => <option key={row.code} value={row.code}>{row.code}</option>)}
      </select></label>}
    {status}
    <span className={`${styles.access} ${styles.wide}`}>{access}</span>
    {presence && <span className={`${styles.presence} ${styles.wide}`} data-testid="course-setting-presence">{presence}</span>}
    <span className={styles.spacer} />
    <Button variant="secondary" onClick={onUndo} disabled={!canUndo} title={text.tools.withKey(text.tools.undo, "Ctrl+Z")} aria-label={text.tools.undo}>
      <span aria-hidden="true">↶<span className={styles.wide}> {text.tools.undo}</span></span></Button>
    <Button variant="secondary" onClick={onRedo} disabled={!canRedo} title={text.tools.withKey(text.tools.redo, "Ctrl+Shift+Z")} aria-label={text.tools.redo}>
      <span aria-hidden="true">↷<span className={styles.wide}> {text.tools.redo}</span></span></Button>
    <div className={styles.menu} ref={menuRef}>
      <Button variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setMenuAt({ top: rect.bottom + 4, right: Math.max(4, window.innerWidth - rect.right) });
        setOpen(value => !value);
      }}>{copy.topbar.file} ▾</Button>
      {open && <div role="menu" className={styles.menuList} style={menuAt ? { top: menuAt.top, right: menuAt.right } : undefined}>
        {menu.map(item => <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onClick(); }}>{item.label}</button>)}
      </div>}
    </div>
    <Button variant="secondary" title={full ? copy.topbar.exitFullscreen : copy.topbar.fullscreen}
      aria-label={full ? copy.topbar.exitFullscreen : copy.topbar.fullscreen}
      onClick={() => {
        const request = full ? window.document.exitFullscreen?.() : window.document.documentElement.requestFullscreen?.();
        void request?.catch(() => undefined);
      }}>
      {full ? "⤡" : "⛶"}</Button>
  </header>;
}

const TOOL_ICON: Record<string, string> = { SELECT: "↖", ADD_CONTROL: "○", ADD_START: "△", ADD_FINISH: "◎", ADD_CROSSING: ")(", INSERT_EXISTING: "⊕",
  ADD_BEND: "⌒", NOTE: "✎", FORK: "⑂" };

/** Verktygen ovanpå kartan: ikon och kort etikett, tangenten i tooltip, valt läge tydligt markerat. */
export function ToolBar({ tool, tools, onTool, onFork, inCourse, help }: { tool: Tool; tools: readonly Tool[]; onTool: (tool: Tool) => void;
  onFork?: (() => void) | undefined; inCourse: boolean; help: string }) {
  return <div className={styles.toolbar} role="toolbar" aria-label={text.tools.heading} title={help}>
    {tools.map(item => <button key={item} type="button" className={styles.tool} aria-pressed={tool === item} aria-label={text.tools[item]}
      title={text.tools.withKey(text.tools[item], text.tools.shortcut[item] ?? "")}
      disabled={(item === "INSERT_EXISTING" || item === "ADD_BEND") && !inCourse} onClick={() => onTool(item)}>
      <span aria-hidden="true" className={styles.toolIcon}>{TOOL_ICON[item]}</span><span aria-hidden="true">{text.tools.short[item]}</span>
      <kbd aria-hidden="true" className={styles.key}>{text.tools.shortcut[item]}</kbd>
    </button>)}
    {onFork && <button type="button" className={styles.tool} aria-label={text.tools.forkTool} disabled={!inCourse}
      title={text.tools.withKey(text.tools.forkTool, text.tools.shortcut.FORK!)} onClick={onFork}>
      <span aria-hidden="true" className={styles.toolIcon}>{TOOL_ICON.FORK}</span><span aria-hidden="true">{text.tools.short.FORK}</span>
      <kbd aria-hidden="true" className={styles.key}>{text.tools.shortcut.FORK}</kbd></button>}
  </div>;
}

export type DrawerTab = "courses" | "description" | "selected" | "checks" | "notes" | "inspections" | "suggestions" | "settings";
const TAB_ICON: Record<DrawerTab, string> = { courses: "☰", description: "▦", selected: "◉", checks: "⚠", notes: "✎", inspections: "✓",
  suggestions: "⇄", settings: "⚙" };
const WIDTH_KEY = "otid.course-setting.drawer";

function readWidth(): number {
  try { const value = Number(window.localStorage.getItem(WIDTH_KEY)); return value >= 260 && value <= 720 ? value : 380; } catch { return 380; }
}

/** Lådan med flikar: fälls ihop till en list med ikoner, bredden dras i kanten; på smal skärm ett blad nerifrån. */
export function Drawer({ tab, onTab, counts, children, reveal }: { tab: DrawerTab; onTab: (tab: DrawerTab) => void;
  counts: Partial<Record<DrawerTab, number>>; children: ReactNode;
  /** Steg 67: räknas upp när fältraden vill visa en flik (bladet fälls upp). */
  reveal?: number | undefined }) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(380);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => { setWidth(readWidth()); }, []);
  useEffect(() => { if (reveal) { setCollapsed(false); setSheetOpen(true); } }, [reveal]);
  const drag = useRef<{ startX: number; width: number } | undefined>(undefined);
  const sheetDrag = useRef<number | undefined>(undefined);
  const tabs = Object.keys(TAB_ICON) as DrawerTab[];
  return <aside className={styles.drawer} data-collapsed={collapsed || undefined} data-sheet-open={sheetOpen || undefined}
    style={{ "--drawer-width": `${width}px` } as React.CSSProperties} aria-label={copy.drawer.label}>
    <div className={styles.resize} role="separator" aria-orientation="vertical" aria-label={copy.drawer.resize} tabIndex={0}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setWidth(value => Math.min(720, Math.max(260, value + (event.key === "ArrowLeft" ? 20 : -20))));
        }
      }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { startX: event.clientX, width }; }}
      onPointerMove={event => { if (drag.current) setWidth(Math.min(720, Math.max(260, drag.current.width + drag.current.startX - event.clientX))); }}
      onPointerUp={() => { drag.current = undefined; try { window.localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* bara bekvämlighet */ } }} />
    <button type="button" className={styles.sheetHandle} aria-label={sheetOpen ? copy.drawer.collapse : copy.drawer.expand}
      aria-expanded={sheetOpen}
      // Bladet dras upp eller ned med handtaget (eller trycks på); en kort dragning räcker.
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); sheetDrag.current = event.clientY; }}
      onPointerUp={event => {
        const start = sheetDrag.current;
        sheetDrag.current = undefined;
        if (start === undefined) return;
        const moved = event.clientY - start;
        if (moved < -24) setSheetOpen(true);
        else if (moved > 24) setSheetOpen(false);
        else setSheetOpen(value => !value);
      }}
      onClick={event => { if (event.detail === 0) setSheetOpen(value => !value); }}><span aria-hidden="true" /></button>
    <div className={styles.tabs} role="tablist" aria-label={copy.drawer.label}>
      <button type="button" className={styles.collapse} aria-label={collapsed ? copy.drawer.expand : copy.drawer.collapse}
        title={collapsed ? copy.drawer.expand : copy.drawer.collapse} onClick={() => setCollapsed(value => !value)}>{collapsed ? "«" : "»"}</button>
      {tabs.map(item => {
        const count = counts[item] ?? 0;
        const label = copy.drawer.tabs[item];
        return <button key={item} type="button" role="tab" id={`course-setting-tab-${item}`} aria-selected={tab === item}
          aria-controls="course-setting-tabpanel" title={copy.drawer.count(label, count)} className={styles.tab}
          onClick={() => { onTab(item); setCollapsed(false); setSheetOpen(true); }}>
          <span aria-hidden="true" className={styles.tabIcon}>{TAB_ICON[item]}</span>
          <span className={styles.tabLabel}>{label}</span>
          {count > 0 && <span className={styles.badge} aria-label={copy.drawer.count(label, count)}>{count}</span>}
        </button>;
      })}
    </div>
    <div className={styles.tabpanel} role="tabpanel" id="course-setting-tabpanel" aria-labelledby={`course-setting-tab-${tab}`}>{children}</div>
  </aside>;
}

/** En dialog ovanpå arbetsytan (fil och versioner, överföringen, arbetssättet). */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onClose={onClose} onCancel={onClose}>
    <div className={styles.dialogHead}><h2>{title}</h2><Button variant="quiet" onClick={onClose}>{copy.topbar.close}</Button></div>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
