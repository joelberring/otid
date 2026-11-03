"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyEdit, controlsOnlyIn, nextFreeCode, unusedControls, type CourseSettingEdit, type OverprintPrimitive
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { courseSettingUxSv as ux } from "../../i18n/course-setting-ux-sv";
import {
  addPoint, addSplit, applySteps, beginDrag, dragTo, insertExisting, setTool, setView, toolControlKind, workInBranch, type EditorState, type Tool
} from "../../lib/course-setting-editor";
import { drawBranchLabels, drawRotateHandle, drawSnapHint, drawUnused } from "../../lib/course-setting-draw-ux";
import { allBranches, branchLabels, branchOf, branchVariant, courseTree, forkOfBranch, type TreeBranch } from "../../lib/course-setting-forks";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import type { PaletteItem } from "../../lib/course-setting-palette";
import {
  angleTowards, nearHandle, orientationAlongLeg, rotatableOf, rotateEdit, type Rotatable
} from "../../lib/course-setting-rotate";
import { ghostPrimitives, otherCoursesPrimitives, snapAt, snapCandidates, snapTolerancePx, type Snap } from "../../lib/course-setting-snap";
import { controlLabel } from "../../lib/course-setting-text";
import type { Viewport } from "../../lib/course-setting-viewport";
import type { PointerModifiers } from "./course-setting-map";
import type { DrawerTab } from "./course-setting-workspace";
import { Dialog } from "./course-setting-workspace";
import styles from "./course-setting.module.css";
import { ConfirmList, ForceNew, ForkBar, ForkPicker, ObjectPalette, RotateControls, ViewOptions, type PendingImage } from "./course-setting-ux";

const srOnly = styles.srOnly;
type Change = (change: (current: EditorState) => EditorState) => void;
type Say = (message: { tone: "ok" | "error" | "attention"; text: string; list?: readonly string[] | undefined }) => void;

const ADD_TOOLS: readonly Tool[] = ["ADD_CONTROL", "ADD_START", "ADD_FINISH", "ADD_CROSSING", "ADD_MAP_EXCHANGE", "INSERT_EXISTING"];
const UNUSED_KEY = "otid.course-setting.show-unused", OTHERS_KEY = "otid.course-setting.show-others";
/** Markeringarna på kartan som kan släckas (per webbläsare, alla på som förval; fältläget i telefonen också). */
const MARKS = { inspected: "otid.course-setting.show-inspected", notes: "otid.course-setting.show-notes", warnings: "otid.course-setting.show-warnings" } as const;
export type MapMarks = Record<keyof typeof MARKS, boolean>;

function readFlag(key: string, fallback: boolean): boolean {
  try { const value = window.localStorage.getItem(key); return value === null ? fallback : value === "1"; } catch { return fallback; }
}
function writeFlag(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* bara bekvämlighet i den här webbläsaren */ }
}

/**
 * ADR-0180 beslut 14: banläggningens nya arbetssätt samlat utanför editorn – paletten med objekt, vridhandtaget,
 * befintliga kontroller som syns svagt och snäpper, andra banor svagt, gafflingens grenar, kopia och borttagning av bana
 * och de oanvända kontrollerna. Editorn kopplar in hanterarna för kartan och visar elementen.
 */
export function useCourseSettingUx({ editor, store, apply, edit, readOnly, radiusMm, say, setTab }: {
  editor: EditorState; store: { readonly state: EditorState; update: (change: (current: EditorState) => EditorState) => void };
  apply: Change; edit: Change; readOnly: boolean; radiusMm: number; say: Say; setTab: (tab: DrawerTab) => void;
}) {
  const { document, view, selection, tool } = editor;
  const [palette, setPalette] = useState(false);
  const [forkPicker, setForkPicker] = useState(false);
  const [forceNew, setForceNew] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [showUnused, setShowUnused] = useState(true);
  const [marks, setMarks] = useState<MapMarks>({ inspected: true, notes: true, warnings: true });
  useEffect(() => {
    setShowOthers(readFlag(OTHERS_KEY, false)); setShowUnused(readFlag(UNUSED_KEY, true));
    setMarks({ inspected: readFlag(MARKS.inspected, true), notes: readFlag(MARKS.notes, true), warnings: readFlag(MARKS.warnings, true) });
  }, []);
  const markToggle = (key: keyof MapMarks) => ({ label: ux.view[key], on: marks[key],
    onChange: (on: boolean) => { setMarks(current => ({ ...current, [key]: on })); writeFlag(MARKS[key], on); } });
  const [hover, setHover] = useState<Snap>();
  const [confirm, setConfirm] = useState<{ title: string; body: ReactNode }>();
  const rotating = useRef<Rotatable | undefined>(undefined);
  const [rotatingOn, setRotatingOn] = useState(false);

  const inCourse = view !== ALL_CONTROLS && document.courses.some(course => course.id === view);
  const tree = useMemo(() => inCourse ? safe(() => courseTree(document, view), []) : [], [document, view, inCourse]);
  const branches = useMemo(() => allBranches(tree), [tree]);
  const active = editor.branch !== undefined ? branches.find(branch => branch.start === editor.branch) : undefined;
  /** Varianten som visas: den valda, annars den första genom grenen man arbetar i. */
  const variant = editor.variant ?? (active ? branchVariant(document, view, active.start) : undefined);

  const adding = inCourse && ADD_TOOLS.includes(tool) && !readOnly;
  const ghosts = useMemo(() => adding ? safe(() => ghostPrimitives(document, view), [] as OverprintPrimitive[]) : [], [document, view, adding]);
  const others = useMemo(() => showOthers && inCourse ? safe(() => otherCoursesPrimitives(document, view), [] as OverprintPrimitive[]) : [],
    [document, view, showOthers, inCourse]);
  const unused = useMemo(() => safe(() => unusedControls(document), [] as string[]), [document]);
  const unusedShown = showUnused && view === ALL_CONTROLS && unused.length > 0;
  const unusedRefs = useMemo(() => new Set(unusedShown ? unused : []), [unusedShown, unused]);
  const snapKind = tool === "INSERT_EXISTING" ? "ANY" as const : toolControlKind(tool);
  const candidates = useMemo(() => adding && snapKind ? snapCandidates(document, view, snapKind) : [], [document, view, adding, snapKind]);
  const rotatable = tool === "SELECT" && !readOnly ? rotatableOf(document, selection) : undefined;
  const labels = useMemo(() => tree.some(row => row.kind === "fork") ? safe(() => branchLabels(document, view, tree), []) : [], [document, view, tree]);

  const snapFor = (point: Point, modifiers: PointerModifiers): Snap | undefined => {
    if (!adding || (forceNew && tool !== "INSERT_EXISTING") || (modifiers.alt && tool !== "INSERT_EXISTING")) return undefined;
    return snapAt(document, candidates, point, radiusMm, snapTolerancePx(modifiers.pointerType) / modifiers.pxPerMm);
  };

  /** Ett klick med ett lägg-till-verktyg i en bana: befintlig kontroll om klicket träffar en, annars en ny. Sant = hanterat. */
  function tap(point: Point, modifiers: PointerModifiers): boolean {
    setHover(undefined);
    if (!adding) return false;
    const snap = snapFor(point, modifiers);
    if (tool === "INSERT_EXISTING") {
      if (snap) edit(next => insertExisting(next, snap.control, applyEdit));
      return snap !== undefined;
    }
    edit(next => addPoint(next, tool, point, applyEdit, nextFreeCode, snap?.control));
    return true;
  }

  function hoverAt(point: Point | undefined, modifiers: PointerModifiers) {
    const next = point ? snapFor(point, modifiers) : undefined;
    setHover(current => current?.control === next?.control ? current : next);
  }

  /** Dragningen börjar på vridhandtaget? */
  function startRotate(point: Point, pxPerMm: number, pointerType: string): boolean {
    if (!rotatable || !nearHandle(rotatable, point, pxPerMm, pointerType)) return false;
    rotating.current = rotatable;
    setRotatingOn(true);
    store.update(beginDrag);
    return true;
  }
  function moveRotate(point: Point, modifiers: PointerModifiers) {
    const target = rotating.current;
    if (!target) return;
    const orientation = angleTowards(target.at, point, modifiers.free);
    rotating.current = { ...target, orientation };
    store.update(next => dragTo(next, rotateEdit(target, orientation), applyEdit));
  }
  const endRotate = () => { const was = rotating.current !== undefined; rotating.current = undefined; setRotatingOn(false); return was; };

  function along() {
    const target = rotatableOf(store.state.document, store.state.selection);
    if (!target) return;
    const orientation = orientationAlongLeg(store.state.document, store.state.view, target, store.state.selection, radiusMm * 6);
    if (orientation === undefined) { say({ tone: "attention", text: ux.rotate.noLeg }); return; }
    edit(next => applySteps(next, [rotateEdit(target, orientation)], applyEdit));
  }

  function pick(item: PaletteItem, image?: PendingImage) {
    setPalette(false);
    if (item.kind === "tool") { apply(current => setTool(current, item.tool)); return; }
    setTab("objects");
    apply(current => ({ ...setTool(current, "SPECIAL", item.special),
      specialImage: image ? { format: image.format, data: image.data, aspect: image.aspect } : undefined }));
    if (image) say({ tone: "ok", text: ux.palette.imageReady(image.name) });
  }

  function forkHere(kind: "FORK" | "LOOP", count: number) {
    setForkPicker(false);
    edit(next => addSplit(next, kind, count, applyEdit));
    setTab("courses");
  }
  const openForkPicker = () => {
    const at = store.state.selection?.kind === "control" ? store.state.selection.courseControl : undefined;
    if (!at || store.state.view === ALL_CONTROLS) { say({ tone: "attention", text: text.tools.forkNeedsSelection }); return; }
    setForkPicker(true);
  };
  const workIn = (branch: TreeBranch) => apply(current => workInBranch(current, branch.start, branch.last));
  function nextBranch() {
    if (!active) return;
    const found = forkOfBranch(tree, active.start);
    const next = found ? found.fork.branches[(found.index + 1) % found.fork.branches.length] : undefined;
    if (next) workIn(next);
  }

  function duplicate(course: string) {
    const name = document.courses.find(row => row.id === course)?.name ?? "";
    edit(current => {
      const next = applySteps(current, [{ type: "DUPLICATE_COURSE", course, name: ux.courses.copyName(name) }], applyEdit);
      const created = next.document.courses.find(row => !current.document.courses.some(old => old.id === row.id));
      return created ? setView(next, created.id) : next;
    });
  }

  /** Ta bort banan: kontrollerna som bara den använder listas, och tas bort i samma ångra-steg om man vill. */
  function requestDelete(course: string) {
    const found = document.courses.find(row => row.id === course);
    if (!found) return;
    const orphans = safe(() => controlsOnlyIn(document, course), [] as string[]);
    const remove = (withControls: boolean) => {
      setConfirm(undefined);
      edit(current => setView(applySteps(current, [{ type: "DELETE_COURSE", course } as CourseSettingEdit,
        ...(withControls ? orphans.filter(id => current.document.controls[id]).map(control => ({ type: "DELETE_CONTROL", control }) as CourseSettingEdit) : [])],
      applyEdit), ALL_CONTROLS));
    };
    setConfirm({ title: ux.courses.removeHeading(found.name), body: <ConfirmList testId="course-setting-delete-course"
      intro={orphans.length > 0 ? ux.courses.removeOrphans(orphans.length) : ux.courses.removeNone}
      items={orphans.map(id => controlLabel(document, id))}
      actions={[...(orphans.length > 0 ? [{ label: ux.courses.removeWithControls(orphans.length), onClick: () => remove(true) }] : []),
        { label: ux.courses.removeOnly, onClick: () => remove(false), variant: orphans.length > 0 ? "secondary" as const : "primary" as const },
        { label: ux.courses.cancel, onClick: () => setConfirm(undefined), variant: "quiet" as const }]} /> });
  }

  function requestRemoveUnused() {
    const ids = [...unused];
    if (ids.length === 0) return;
    const labels = ids.map(id => controlLabel(document, id));
    setConfirm({ title: ux.controls.removeUnused, body: <ConfirmList testId="course-setting-remove-unused"
      intro={ux.controls.removeUnusedConfirm(labels)} items={labels}
      actions={[{ label: ux.controls.removeUnused, onClick: () => {
        setConfirm(undefined);
        edit(current => applySteps(current, ids.filter(id => current.document.controls[id]).map(control => ({ type: "DELETE_CONTROL", control }) as CourseSettingEdit),
          applyEdit, () => undefined));
        say({ tone: "ok", text: ux.controls.removed(ids.length) });
      } }, { label: ux.courses.cancel, onClick: () => setConfirm(undefined), variant: "quiet" as const }]} /> });
  }

  /** Det som ritas ovanpå banpåtrycket (bara på skärmen). */
  const rotateTarget = rotatable ? `${rotatable.kind}:${rotatable.id}:${rotatable.at.x},${rotatable.at.y}:${rotatable.orientation}` : "";
  const draw = useCallback((ctx: CanvasRenderingContext2D, mapView: Viewport) => {
    if (unusedShown) drawUnused(ctx, mapView, unused.flatMap(id => document.controls[id] ? [{ at: document.controls[id].at, label: controlLabel(document, id) }] : []),
      radiusMm);
    if (labels.length > 0) drawBranchLabels(ctx, mapView, labels, active?.start);
    if (rotatable) drawRotateHandle(ctx, mapView, rotating.current ?? rotatable, rotating.current !== undefined);
    if (hover) drawSnapHint(ctx, mapView, { at: hover.at, radiusMm, text: ux.snap.insert(controlLabel(document, hover.control).replace(/^kontroll /, "")) });
    // `rotateTarget` och `rotatingOn` står för vridhandtaget (objektet räknas om vid varje ritning).
  }, [unusedShown, unused, document, radiusMm, labels, active?.start, rotateTarget, rotatingOn, hover]);

  const selectedCourseControl = selection?.kind === "control" ? selection.courseControl : undefined;
  const branchOfSelection = selectedCourseControl ? branchOf(tree, selectedCourseControl) : undefined;
  const forkInfo = active ? forkOfBranch(tree, active.start) : undefined;
  const elements = <>
    {palette && <ObjectPalette active={tool === "SPECIAL" ? editor.specialKind : tool} onPick={pick} onClose={() => setPalette(false)} />}
    {forkPicker && <ForkPicker onFork={forkHere} onClose={() => setForkPicker(false)} />}
    <ViewOptions others={showOthers} onOthers={on => { setShowOthers(on); writeFlag(OTHERS_KEY, on); }}
      unused={view === ALL_CONTROLS ? { count: unused.length, on: showUnused, onChange: on => { setShowUnused(on); writeFlag(UNUSED_KEY, on); } } : undefined}
      toggles={[markToggle("inspected"), markToggle("notes"), markToggle("warnings")]} />
    {confirm && <Dialog title={confirm.title} onClose={() => setConfirm(undefined)}>{confirm.body}</Dialog>}
  </>;
  /** I beskedens stapel uppe till höger: grenen man arbetar i och "Alltid ny". */
  const toasts = <>
    {active && forkInfo && <ForkBar letter={active.letter} count={forkInfo.fork.branches.length} onNext={nextBranch}
      onDone={() => apply(current => ({ ...current, branch: undefined }))} />}
    {adding && tool !== "INSERT_EXISTING" && candidates.length > 0 && <ForceNew on={forceNew} onChange={setForceNew} />}
    {hover && <p className={srOnly} role="status" data-testid="course-setting-snap">{ux.snap.insert(controlLabel(document, hover.control))}</p>}
  </>;
  const rotateControls = (target: Rotatable | undefined) => target
    ? <RotateControls orientation={target.orientation} readOnly={readOnly} onSet={value => edit(next => applySteps(next, [rotateEdit(target, value)], applyEdit))}
      onAlong={along} /> : null;

  return {
    variant, ghosts, others, unused, unusedRefs, tree, active, branchOfSelection, palette, setPalette, openForkPicker,
    tap, hoverAt, startRotate, moveRotate, endRotate, isRotating: () => rotating.current !== undefined, along, workIn, duplicate, requestDelete,
    requestRemoveUnused, draw, elements, toasts, rotateControls, rotatable: rotatableOf(document, selection), marks
  };
}

function safe<T>(compute: () => T, fallback: T): T {
  try { return compute(); } catch (error) { console.error("Banläggningen", error); return fallback; }
}

export type CourseSettingUx = ReturnType<typeof useCourseSettingUx>;
