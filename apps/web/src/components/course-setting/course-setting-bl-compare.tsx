"use client";

import { useEffect, useMemo, useState } from "react";
import { blProposalEn } from "../../i18n/course-setting-look-en";
import { useTexts } from "../language-provider";
import type { MapColorAdjust, PressNorm, PrintProfile, SheetFrame } from "@o-tid/course-setting";
import type { MapColor } from "@o-tid/map-file";
import { blProposalSv } from "../../i18n/course-setting-bl-proposal-sv";
import { afterViews, compareDpi, compareFrame, cssOfCmyk, layerStack, type Layer, type ProposalState } from "../../lib/course-setting-bl-proposal";
import type { SymbolLookup } from "../../lib/course-setting-description-draw";
import { mapRenderRequest } from "../../lib/course-setting-print";
import { FrameView, type OverBandImage } from "./course-setting-sheet";
import styles from "./course-setting-bl-proposal.module.css";

/** Jämförelsen står överst i förslaget och ritas före kartbitarna (2) och arken (0). */
const COMPARE_PRIORITY = 3;

/** En kartbild ur Workern (bild-URL) för ett utsnitt, med färgerna och eventuellt bara vissa färger. */
export interface RenderView {
  readonly width: number; readonly height: number; readonly pxPerMm: number; readonly origin: { x: number; y: number };
  readonly colorAdjust?: Readonly<Record<number, MapColorAdjust>> | undefined;
  readonly onlyColors?: readonly number[] | undefined;
  readonly background?: boolean | undefined;
}
export type RenderImage = (view: RenderView, priority: number) => Promise<string>;

/** Purple Pens lila, som banan ritas i "före" (som i dag). */
const PURPLE_PEN = { c: 20, m: 100, y: 0, k: 0 };

/**
 * Hela kartan före och efter på ett utsnitt av den riktiga kartan (första arkets ram): före = kartfilens färger med banan
 * överst, efter = BL:s färger med banan i BL:s ordning (kartan under banan, BENEATH/LOWER, bandade OVER-bilder och UPPER).
 */
export function BlCompare({ frame: sheetFrame, profile, state, colors, symbols, render, norm }: {
  frame: SheetFrame; profile: PrintProfile; state: ProposalState; colors: readonly MapColor[]; symbols: SymbolLookup; render: RenderImage; norm: PressNorm;
}) {
  const text = useTexts(blProposalSv, blProposalEn);
  // Samma utsnitt efter varje sparning (dokumentet läses om): nyckeln håller bilderna kvar.
  const frameKey = JSON.stringify([sheetFrame.mapArea, sheetFrame.clip, sheetFrame.transform, sheetFrame.figures.length,
    sheetFrame.mirror, sheetFrame.whiteAreas, sheetFrame.markingClip]);
  const frame = useMemo(() => compareFrame(sheetFrame), [frameKey]);
  const view = useMemo(() => mapRenderRequest(frame, compareDpi(frame.clip)), [frame]);
  const after = useMemo(() => afterViews(profile, state, colors, norm), [profile, state, colors, norm]);
  const afterKey = JSON.stringify(after);
  const [before, setBefore] = useState<string>();
  const [images, setImages] = useState<{ key: string; under: string; bands: readonly OverBandImage[] }>();
  const [split, setSplit] = useState(50);
  useEffect(() => {
    let live = true;
    void render(view, COMPARE_PRIORITY).then(url => { if (live) setBefore(url); }, error => console.error("Kartbiten kunde inte ritas", error));
    return () => { live = false; };
  }, [view, render]);
  useEffect(() => {
    let live = true;
    void (async () => {
      // Hela kartan underst och varje OVER-band i exakt rank-ordning (som SheetView och PDF:en).
      const under = await render({ ...view, colorAdjust: after.adjust }, COMPARE_PRIORITY);
      const bands: OverBandImage[] = [];
      for (const band of after.overBands) {
        if (!live) return;
        const url = await render({ ...view, colorAdjust: after.adjust, onlyColors: band.ids, background: false }, COMPARE_PRIORITY);
        bands.push({ kind: band.kind, url });
      }
      if (live) setImages({ key: afterKey, under, bands });
    })().catch(error => console.error("Kartbiten kunde inte ritas", error));
    return () => { live = false; };
  }, [view, after, afterKey, render]);
  const { clip } = frame;
  const viewBox = `${clip.x} ${clip.y} ${clip.width} ${clip.height}`;
  const afterLayers = after.overBands.length > 0 ? { norm, numbersOnTop: profile.numbersOnTop ?? false } : undefined;
  const ready = before && images;
  return <section className={styles.compare} aria-labelledby="bl-compare">
    <h3 id="bl-compare">{text.compare}</h3>
    <p className={styles.muted}>{text.compareHelp}</p>
    <div className={styles.stageLabels}><span>{text.showBefore}</span><span>{text.showAfter}</span></div>
    <div className={styles.stage} style={{ aspectRatio: `${clip.width} / ${clip.height}` }} data-testid="bl-compare" data-ready={ready ? "yes" : "no"}>
      <svg viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true" data-testid="bl-compare-before">
        <FrameView id="bl-before" frame={frame} symbols={symbols} image={before} courseColor={cssOfCmyk(PURPLE_PEN)} markTestIds={false} />
      </svg>
      {images && <div className={styles.after} style={{ clipPath: `inset(0 0 0 ${split}%)` }} data-testid="bl-compare-after">
        <svg viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
          <FrameView id="bl-after" frame={frame} symbols={symbols} image={images.under} overBandImages={images.bands} layers={afterLayers}
            courseColor={cssOfCmyk(profile.course.cmyk)} markTestIds={false} />
        </svg>
      </div>}
      {images && <span className={styles.divider} style={{ left: `${split}%` }} title={text.compareDivider} aria-hidden="true" />}
    </div>
    {!ready && <p role="status" className={styles.muted}>{text.compareWaiting}</p>}
    <input className={styles.slider} type="range" min={0} max={100} value={split} aria-label={text.compareSlider} onChange={event => setSplit(Number(event.target.value))}
      data-testid="bl-compare-slider" />
  </section>;
}

function LayerList({ title, layers, wrong }: { title: string; layers: readonly Layer[]; wrong: ReadonlySet<string> }) {
  const text = useTexts(blProposalSv, blProposalEn);
  if (layers.length === 0) return null;
  return <>
    <li className={styles.group}>{title}</li>
    {layers.map((layer, index) => <li key={layer.ocadId !== undefined ? `${layer.ocadId}-${index}` : `${index}-${layer.name}`}
      data-wrong={wrong.has(layer.name) ? "yes" : undefined}>
      <span className={styles.band} style={{ background: layer.css }} aria-hidden="true" />{layer.name}
      {wrong.has(layer.name) && <span className={styles.wrong}>{text.layerWrongSide}</span>}</li>)}
  </>;
}

/**
 * Ordningen som en enkel bild: lagren uppifrån (det som ritas sist överst) och en liten figur med en ring som korsas av
 * en höjdkurva och en blå sjö, så som trycket blir.
 */
export function BlLayers({ profile, state, norm }: { profile: PrintProfile; state: ProposalState; norm: PressNorm }) {
  const text = useTexts(blProposalSv, blProposalEn);
  const stack = useMemo(() => layerStack(profile, state, norm), [profile, state, norm]);
  const find = (layers: readonly Layer[], row: string, fallback: string) => layers.find(layer => layer.row === row)?.css ?? fallback;
  const all = [...stack.over, ...stack.under];
  const brown = find(all, "brown-contours", find(all, "brown", "rgb(183, 92, 34)"));
  const lake = find(all, "blue-50", find(all, "blue-70", "rgb(135, 196, 236)"));
  const ground = find(all, "yellow-100", find(all, "yellow", "rgb(253, 191, 37)"));
  const ring = <circle cx="90" cy="60" r="26" fill="none" stroke={stack.course.css} strokeWidth="6" />;
  const contour = <path d="M0 60 C40 48 70 72 180 58" fill="none" stroke={brown} strokeWidth="5" />;
  const wrong = new Set(stack.conflicts);
  const help = text.layersHelp(cmykLabel(profile), norm, Boolean(profile.numbersOnTop));
  return <section aria-labelledby="bl-layers" data-testid="bl-layers" data-on-top={stack.onTop ? "yes" : "no"}>
    <h3 id="bl-layers">{text.layers}</h3>
    <p className={styles.muted}>{help}</p>
    {stack.onTop && <p className={styles.muted}>{text.layersOnTop}</p>}
    <div className={styles.layers}>
      <ol className={styles.stack} aria-label={text.layers}>
        <LayerList title={text.layerOver} layers={stack.over} wrong={wrong} />
        <li className={styles.course} data-testid="bl-layer-course"><span className={styles.band} style={{ background: stack.course.css }} aria-hidden="true" />
          {text.layerCourse}: {stack.course.name}</li>
        <LayerList title={text.layerUnder} layers={stack.under} wrong={wrong} />
      </ol>
      <svg className={styles.figure} viewBox="0 0 180 120" role="img" aria-label={stack.onTop ? text.layersOnTop : help}>
        <rect width="180" height="120" fill={ground} />
        <rect x="100" y="70" width="80" height="50" fill={lake} />
        {stack.onTop ? <>{contour}{ring}</> : <>{ring}{contour}</>}
      </svg>
    </div>
    {stack.conflicts.length > 0 && <p className={styles.muted}>{text.layerConflicts(stack.conflicts.join(", "))}</p>}
  </section>;
}

const cmykLabel = (profile: PrintProfile) => [profile.course.cmyk.c, profile.course.cmyk.m, profile.course.cmyk.y, profile.course.cmyk.k].join("/");
