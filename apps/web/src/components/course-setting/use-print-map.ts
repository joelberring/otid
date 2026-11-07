"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_PRINT_PROFILES, cmykToCss, mapColorAdjust, MAP_OWN_PRINT_PROFILE_ID, type CourseSettingDocument, type MapColorAdjust, type MapRect, type Sheet
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { mapRenderRequest } from "../../lib/course-setting-print";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchMapSource } from "../../lib/route-choice-api";
import { cachedMapFile, mapFileCache } from "../../lib/map-file-cache";
import { RenderQueue } from "../../lib/course-setting-bl-proposal";
import { pressLayersFor, pressNormOf } from "../../lib/course-setting-press-layers";
import type { RenderImage, RenderView } from "./course-setting-bl-compare";
import { frameImageKey } from "./course-setting-sheet";

/**
 * Kartan och färgerna för arken, gemensamt för Utskrift och Layout (ADR-0217): kartfilen i en Worker, bilderna per utsnitt i
 * profilens färger och normens ordning (ADR-0211 beslut 3), en bild i taget genom en kö.
 */
// Steg 67: styrd av service workern när banläggningen är sparad för offline (`controlledWorker`).
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));

/** En kartbild som bild-URL (ritad av Workern med `drawMap`). */
async function renderView(session: MapRenderSession, request: RenderView): Promise<string> {
  const bitmap = await new Promise<ImageBitmap>(resolve => session.render(request, (_id, image) => resolve(image)));
  const canvas = window.document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
}

export interface PrintMap {
  readonly session: MapRenderSession | undefined;
  readonly mapState: "none" | "reading" | "ready" | "failed";
  readonly colors: readonly MapColor[];
  readonly usage: ReadonlyMap<number, ColorUsage>;
  readonly mapScale: number | undefined;
  readonly renderImage: RenderImage;
}

/**
 * Kartfilen i en Worker (kartans gränser till `onBounds` när de inte är kända). `map` är kartfilens sha256 ur banläggningens
 * tillstånd (filen hämtas då ur webbläsarens lager eller en gång per sha256, ADR-0218), `true` för en karta med okänd sha256
 * (hämtas utan cache) eller `false` för ingen karta.
 */
export function usePrintMap(raceId: string, map: boolean | string, onBounds: (bounds: MapRect) => void): PrintMap {
  const hasMap = map !== false && map !== "";
  const sha256 = typeof map === "string" ? map : undefined;
  const [session, setSession] = useState<MapRenderSession>();
  const [mapState, setMapState] = useState<PrintMap["mapState"]>("none");
  const [colors, setColors] = useState<readonly MapColor[]>([]);
  const [usage, setUsage] = useState<ReadonlyMap<number, ColorUsage>>(new Map());
  const [mapScale, setMapScale] = useState<number>();
  const queue = useRef(new RenderQueue());
  const boundsRef = useRef(onBounds);
  boundsRef.current = onBounds;
  const renderImage = useCallback<RenderImage>((view, priority) => {
    if (!session) return Promise.reject(new Error("Kartan är inte inläst"));
    return queue.current.add(() => renderView(session, view), priority);
  }, [session]);
  useEffect(() => {
    if (!hasMap) return;
    const controller = new AbortController();
    let created: MapRenderSession | undefined;
    setMapState("reading");
    void cachedMapFile(mapFileCache, sha256, known => fetchMapSource(raceId, controller.signal, { sha256: known }), controller.signal).then(file => {
      created = new MapRenderSession(createMapWorker, (bounds, scale, _georeference, mapColors, mapUsage) => {
        boundsRef.current(bounds); setColors(mapColors); setUsage(mapUsage); setMapScale(scale); setSession(created); setMapState("ready");
      }, () => setMapState("failed"));
      created.load(file.bytes, file.fileName);
    }, () => { if (!controller.signal.aborted) setMapState("failed"); });
    return () => { controller.abort(); created?.close(); };
  }, [raceId, hasMap, sha256]);
  return { session, mapState, colors, usage, mapScale, renderImage };
}

/** Profilen för arken: vald här, annars tävlingens, annars kartans egna färger i normens ordning (ADR-0215 beslut 1). */
export function usePrintColors(document: CourseSettingDocument | null | undefined, profileId: string | undefined, map: PrintMap) {
  const savedProfiles = useMemo(() => document?.event.printProfiles ?? [], [document]);
  const activeProfileId = profileId ?? document?.event.printProfileId ?? MAP_OWN_PRINT_PROFILE_ID;
  const profile = [...BUILT_IN_PRINT_PROFILES, ...savedProfiles].find(item => item.id === activeProfileId)
    ?? BUILT_IN_PRINT_PROFILES.find(item => item.id === MAP_OWN_PRINT_PROFILE_ID)!;
  const adjust = useMemo<Readonly<Record<number, MapColorAdjust>>>(() => mapColorAdjust(profile, map.colors), [profile, map.colors]);
  // Normens färgordning (ADR-0211 beslut 3): kartan under banan, banans undre lila, kartan över (multiplicerad), övre lila.
  const pressLayers = useMemo(() => pressLayersFor(profile, map.colors, map.usage, map.mapScale), [profile, map.colors, map.usage, map.mapScale]);
  const pressNorm = pressNormOf(profile, map.mapScale, map.usage);
  const colorsKey = useMemo(() => JSON.stringify(adjust) + (pressLayers ? `|${pressLayers.over.join(",")}` : ""), [adjust, pressLayers]);
  return { savedProfiles, profile, adjust, pressLayers, pressNorm, colorsKey, courseColor: cmykToCss(profile.course.cmyk) };
}

/** Kartbilderna per utsnitt och färger (samma utsnitt, skala och profil ritas en gång). */
export function useSheetImages(map: PrintMap, sheets: readonly { readonly sheet: Sheet }[], colors: ReturnType<typeof usePrintColors>): Readonly<Record<string, string>> {
  const { session, renderImage } = map;
  const { adjust, colorsKey, pressLayers } = colors;
  const [images, setImages] = useState<Readonly<Record<string, string>>>({});
  const urls = useRef<string[]>([]);
  const started = useRef(new Set<string>());
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      for (const { sheet } of sheets) for (const frame of sheet.frames) {
        const key = frameImageKey(frame, colorsKey);
        if (cancelled) return;
        if (started.current.has(key)) continue;
        started.current.add(key);
        try {
          const request = { ...mapRenderRequest(frame), ...(Object.keys(adjust).length > 0 ? { colorAdjust: adjust } : {}) };
          // Normens ordning: två bilder, färgerna under banan och färgerna över (utan vit bakgrund).
          const url = await renderImage(pressLayers ? { ...request, onlyColors: pressLayers.under } : request, 0);
          const over = pressLayers ? await renderImage({ ...request, onlyColors: pressLayers.overInk, background: false }, 0) : undefined;
          // Vitt över banan slår ut (som i PDF:en): en egen bild utan multiplicering.
          const overWhite = pressLayers && pressLayers.overWhite.length > 0
            ? await renderImage({ ...request, onlyColors: pressLayers.overWhite, background: false }, 0) : undefined;
          urls.current.push(url, ...(over ? [over] : []), ...(overWhite ? [overWhite] : []));
          // Bilden gäller sin nyckel även om arken ändrats under tiden (en senare körning hoppar över nyckeln medan den ritas).
          setImages(current => ({ ...current, ...(over ? { [`${key}|OVER`]: over } : {}), ...(overWhite ? { [`${key}|OVERWHITE`]: overWhite } : {}), [key]: url }));
        } catch (error) { started.current.delete(key); console.error("Kartan kunde inte ritas", error); }
      }
    })();
    return () => { cancelled = true; };
  }, [session, sheets, adjust, colorsKey, renderImage, pressLayers]);
  useEffect(() => () => { for (const url of urls.current) if (url.startsWith("blob:")) URL.revokeObjectURL(url); }, []);
  return images;
}
