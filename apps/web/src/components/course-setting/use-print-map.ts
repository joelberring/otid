"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_PRINT_PROFILES, mapColorAdjust, MAP_OWN_PRINT_PROFILE_ID, type CourseSettingDocument, type MapColorAdjust, type MapRect, type Sheet
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor, MapGeoreference } from "@o-tid/map-file";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { mapRenderRequest } from "../../lib/course-setting-print";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchMapSource } from "../../lib/route-choice-api";
import { cachedMapFile, mapFileCache } from "../../lib/map-file-cache";
import { cssOfCmyk, RenderQueue } from "../../lib/course-setting-bl-proposal";
import { overBandImageKey, pressLayersFor, pressNormOf } from "../../lib/course-setting-press-layers";
import type { RenderImage, RenderView } from "./course-setting-bl-compare";
import { frameImageKey } from "./course-setting-sheet";
import { inLanguage } from "../../lib/in-language";

/**
 * Kartan och färgerna för arken, gemensamt för Utskrift och Layout (ADR-0217): kartfilen i en Worker, bilderna per utsnitt i
 * profilens färger och normens ordning (ADR-0211 beslut 3), en bild i taget genom en kö.
 */
// Steg 67: styrd av service workern när banläggningen är sparad för offline (`controlledWorker`).
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));

/** En kartbild som bild-URL (ritad och PNG-kodad direkt i Workern med `drawMap` + `convertToBlob`). */
export async function renderPrintView(session: Pick<MapRenderSession, "renderPng">, request: RenderView): Promise<string> {
  const blob = await new Promise<Blob>(resolve => session.renderPng(request, (_id, png) => resolve(png)));
  return URL.createObjectURL(blob);
}

/** Startar kartworkern parallellt med karthämtningen/cachen så att workerns uppstart och filhämtningen överlappar. */
export function startPrintMapSession<S extends Pick<MapRenderSession, "load" | "close">>(input: {
  readonly createSession: (
    onLoaded: (bounds: MapRect, scale: number, georeference: MapGeoreference | null, colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>) => void,
    onError: () => void
  ) => S;
  readonly fetchFile: (signal: AbortSignal) => Promise<{ readonly bytes: ArrayBuffer; readonly fileName: string }>;
  readonly onReady: (session: S, loaded: {
    readonly bounds: MapRect; readonly scale: number; readonly colors: readonly MapColor[]; readonly usage: ReadonlyMap<number, ColorUsage>;
  }) => void;
  readonly onFailed: () => void;
}): () => void {
  const controller = new AbortController();
  let closed = false;
  const created = input.createSession((bounds, scale, _georeference, colors, usage) => {
    if (closed) return;
    input.onReady(created, { bounds, scale, colors, usage });
  }, () => { if (!closed) input.onFailed(); });
  void input.fetchFile(controller.signal).then(file => {
    if (closed) return;
    created.load(file.bytes, file.fileName);
  }, () => { if (!closed && !controller.signal.aborted) input.onFailed(); });
  return () => { closed = true; controller.abort(); created.close(); };
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
    if (!session) return Promise.reject(new Error(inLanguage("Kartan är inte inläst", "The map is not loaded")));
    return queue.current.add(() => renderPrintView(session, view), priority);
  }, [session]);
  useEffect(() => {
    if (!hasMap) return;
    setMapState("reading");
    return startPrintMapSession({
      createSession: (onLoaded, onError) => new MapRenderSession(createMapWorker, onLoaded, onError),
      fetchFile: signal => cachedMapFile(mapFileCache, sha256, known => fetchMapSource(raceId, signal, { sha256: known }), signal),
      onReady: (created, loaded) => {
        boundsRef.current(loaded.bounds); setColors(loaded.colors); setUsage(loaded.usage); setMapScale(loaded.scale); setSession(created); setMapState("ready");
      },
      onFailed: () => setMapState("failed")
    });
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
  // Normens färgordning (ADR-0211 beslut 3): hela kartan, banans undre lila, kartans färger över banan en gång till (Darken), övre lila.
  const pressLayers = useMemo(() => pressLayersFor(profile, map.colors, map.usage, map.mapScale), [profile, map.colors, map.usage, map.mapScale]);
  const pressNorm = pressNormOf(profile, map.mapScale, map.usage);
  const colorsKey = useMemo(() => JSON.stringify(adjust)
    + (pressLayers ? `|${pressLayers.overBands.map(band => `${band.kind}:${band.ids.join(",")}`).join(";")}` : ""), [adjust, pressLayers]);
  return { savedProfiles, profile, adjust, pressLayers, pressNorm, colorsKey, courseColor: cssOfCmyk(profile.course.cmyk) };
}

/**
 * Ritar kartbilder (hela kartan + varje OVER-band i exakt rank-ordning) för ramar som ännu inte påbörjats.
 * När en nyckel väl påbörjats (`started.add(key)`) slutförs alla band och `onFrame` anropas även om en ny
 * effektkörning hunnit starta för samma `session` (t.ex. när `paper-clip-outside` växlar till `FADED` och
 * dokumentet sparas/läses om medan första bilden ritas — den nya körningen hoppar då över nyckeln via `started`).
 */
export async function renderMissingSheetImages(input: {
  readonly sheets: readonly { readonly sheet: Sheet }[];
  readonly adjust: Readonly<Record<number, MapColorAdjust>>;
  readonly colorsKey: string;
  readonly pressLayers: ReturnType<typeof usePrintColors>["pressLayers"];
  readonly started: Set<string>;
  readonly renderImage: RenderImage;
  readonly isCancelled: () => boolean;
  readonly isSameSession: () => boolean;
  readonly onUrl: (url: string) => void;
  readonly onFrame: (entries: Readonly<Record<string, string>>) => void;
}): Promise<void> {
  const { sheets, adjust, colorsKey, pressLayers, started, renderImage, isCancelled, isSameSession, onUrl, onFrame } = input;
  for (const { sheet } of sheets) for (const frame of sheet.frames) {
    const key = frameImageKey(frame, colorsKey);
    if (isCancelled()) return;
    if (started.has(key)) continue;
    started.add(key);
    try {
      const request = { ...mapRenderRequest(frame), ...(Object.keys(adjust).length > 0 ? { colorAdjust: adjust } : {}) };
      // Normens ordning: hela kartan underst och varje OVER-band i exakt rank-ordning (INK med Darken, WHITE som slår ut).
      const url = await renderImage(request, 0);
      onUrl(url);
      const bandUrls: Record<string, string> = {};
      if (pressLayers) {
        for (let i = 0; i < pressLayers.overBands.length; i += 1) {
          const band = pressLayers.overBands[i]!;
          if (!isSameSession()) return;
          const bandUrl = await renderImage({ ...request, onlyColors: band.ids, background: false }, 0);
          onUrl(bandUrl);
          bandUrls[overBandImageKey(key, i)] = bandUrl;
        }
      }
      if (!isSameSession()) return;
      // Bilden gäller sin nyckel även om arken ändrats under tiden (en senare körning hoppar över nyckeln medan den ritas).
      onFrame({ ...bandUrls, [key]: url });
    } catch (error) {
      if (isSameSession()) started.delete(key);
      console.error("Kartan kunde inte ritas", error);
    }
  }
}

/** Kartbilderna per utsnitt och färger (samma utsnitt, skala och profil ritas en gång). */
export function useSheetImages(map: PrintMap, sheets: readonly { readonly sheet: Sheet }[], colors: ReturnType<typeof usePrintColors>): Readonly<Record<string, string>> {
  const { session, renderImage } = map;
  const { adjust, colorsKey, pressLayers } = colors;
  const [images, setImages] = useState<Readonly<Record<string, string>>>({});
  const urls = useRef<string[]>([]);
  const started = useRef(new Set<string>());
  const sessionRef = useRef(session);
  useEffect(() => {
    if (sessionRef.current !== session) {
      sessionRef.current = session;
      started.current.clear();
      setImages({});
    }
    if (!session) return;
    let cancelled = false;
    void renderMissingSheetImages({
      sheets, adjust, colorsKey, pressLayers, started: started.current, renderImage,
      isCancelled: () => cancelled || sessionRef.current !== session,
      isSameSession: () => sessionRef.current === session,
      onUrl: url => { urls.current.push(url); },
      onFrame: entries => setImages(current => ({ ...current, ...entries }))
    });
    return () => { cancelled = true; };
  }, [session, sheets, adjust, colorsKey, renderImage, pressLayers]);
  useEffect(() => () => { for (const url of urls.current) if (url.startsWith("blob:")) URL.revokeObjectURL(url); }, []);
  return images;
}
