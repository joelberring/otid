"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  clampZoom, fitBoundsView, MAX_ZOOM, MIN_ZOOM, project, projectMapFeatures, SWEDEN_BOUNDS, TILE_SIZE,
  unproject, viewportBounds, visibleTiles, type OsmBounds, type OsmMapFeature, type OsmView
} from "../../lib/osm-tiles";
import { useTexts } from "../language-provider";
import styles from "./osm-map.module.css";

export type { OsmBounds, OsmMapFeature, OsmMapFeatureTone } from "../../lib/osm-tiles";

const TEXTS_SV = {
  mapLabel: "Karta med orienteringskartor",
  zoomIn: "Zooma in",
  zoomOut: "Zooma ut",
  resetSweden: "Hela Sverige",
  searchArea: "Sök i detta kartutsnitt",
  clusterLabel: (count: number) => `${count} kartor i området – zooma in`,
  tones: {
    open: "Öppen nedladdning",
    otid: "Använd i O-Tid",
    info: "Endast information"
  }
} as const;

const TEXTS_EN = {
  mapLabel: "Map of orienteering maps",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  resetSweden: "All of Sweden",
  searchArea: "Search this map area",
  clusterLabel: (count: number) => `${count} maps in this area – zoom in`,
  tones: {
    open: "Open download",
    otid: "Use in O-Tid",
    info: "Information only"
  }
} as const;

export interface OsmCatalogMapProps {
  readonly features: readonly OsmMapFeature[];
  readonly selectedId?: string;
  readonly hoveredId?: string;
  readonly focusBounds?: OsmBounds | null;
  readonly initialBounds?: OsmBounds;
  readonly height?: number | string;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly testId?: string;
  readonly onSelect?: (id: string) => void;
  readonly onHover?: (id: string | undefined) => void;
  readonly onBoundsChange?: (bounds: OsmBounds) => void;
}

function boundsKey(bounds: OsmBounds | null | undefined): string {
  if (!bounds) return "";
  return `${bounds.minLon.toFixed(5)},${bounds.minLat.toFixed(5)},${bounds.maxLon.toFixed(5)},${bounds.maxLat.toFixed(5)}`;
}

/**
 * Delad OpenStreetMap-karta med drag-panorering, zoom (+/−/hjul/nyp), klickbara kartområden,
 * markörer/kluster vid låg zoom, tangentbordsfokus och valfri "Sök i detta kartutsnitt".
 */
export function OsmCatalogMap({
  features,
  selectedId,
  hoveredId,
  focusBounds,
  initialBounds,
  height,
  className,
  ariaLabel,
  testId = "osm-catalog-map",
  onSelect,
  onHover,
  onBoundsChange
}: OsmCatalogMapProps) {
  const text = useTexts(TEXTS_SV, TEXTS_EN);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 640,
    height: typeof height === "number" ? height : 440
  });
  const [view, setView] = useState<OsmView>(() =>
    fitBoundsView(initialBounds ?? SWEDEN_BOUNDS, 640, typeof height === "number" ? height : 440, { paddingPx: initialBounds ? 36 : 20 })
  );
  const [dragging, setDragging] = useState(false);
  const [boundsDirty, setBoundsDirty] = useState(false);
  const [focusedAreaId, setFocusedAreaId] = useState<string>();

  const dragRef = useRef<{ pointerId: number; x: number; y: number; cx: number; cy: number; moved: boolean }>(undefined);
  const didDragRef = useRef(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDistRef = useRef<number | undefined>(undefined);
  const appliedFocusKeyRef = useRef<string>("");

  const focusKey = boundsKey(focusBounds);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => {
      const nextW = element.clientWidth || 640;
      const nextH = element.clientHeight || (typeof height === "number" ? height : 440);
      setSize(prev => (prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    observer?.observe(element);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const step = event.deltaY < 0 ? 1 : -1;
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView(current => {
        const nextZoom = clampZoom(current.zoom + step);
        if (nextZoom === current.zoom) return current;
        const w = element.clientWidth || 640;
        const h = element.clientHeight || 440;
        const center = project(current.lon, current.lat, current.zoom);
        const cursorWorld = unproject(center.x - w / 2 + px, center.y - h / 2 + py, current.zoom);
        const cursorAtNext = project(cursorWorld.lon, cursorWorld.lat, nextZoom);
        const nextCenter = unproject(cursorAtNext.x - (px - w / 2), cursorAtNext.y - (py - h / 2), nextZoom);
        return { lon: nextCenter.lon, lat: nextCenter.lat, zoom: nextZoom };
      });
      setBoundsDirty(true);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer?.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, [height]);

  useEffect(() => {
    if (!focusBounds || !focusKey || focusKey === appliedFocusKeyRef.current) return;
    appliedFocusKeyRef.current = focusKey;
    setView(fitBoundsView(focusBounds, size.width, size.height));
    setBoundsDirty(false);
  }, [focusBounds, focusKey, size.width, size.height]);

  const normalizedFeatures = useMemo<readonly OsmMapFeature[]>(
    () =>
      features.map(feature => ({
        ...feature,
        selected: Boolean(feature.selected || (selectedId !== undefined && feature.id === selectedId)),
        hovered: Boolean(feature.hovered || (hoveredId !== undefined && feature.id === hoveredId))
      })),
    [features, selectedId, hoveredId]
  );

  const tiles = useMemo(() => visibleTiles(view, size.width, size.height), [view, size.width, size.height]);
  const projected = useMemo(
    () => projectMapFeatures(normalizedFeatures, view, size.width, size.height),
    [normalizedFeatures, view, size.width, size.height]
  );

  function zoomBy(step: number) {
    setView(current => {
      const nextZoom = clampZoom(current.zoom + step);
      return nextZoom === current.zoom ? current : { ...current, zoom: nextZoom };
    });
    setBoundsDirty(true);
  }

  function resetToSweden() {
    setView(fitBoundsView(SWEDEN_BOUNDS, size.width, size.height, { paddingPx: 20 }));
    setBoundsDirty(true);
  }

  function zoomToCluster(bounds: OsmBounds) {
    setView(current => {
      const fitted = fitBoundsView(bounds, size.width, size.height, { paddingPx: 44 });
      if (fitted.zoom <= current.zoom) {
        return { lon: fitted.lon, lat: fitted.lat, zoom: clampZoom(current.zoom + 2) };
      }
      return fitted;
    });
    setBoundsDirty(true);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      pinchDistRef.current = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      dragRef.current = undefined;
      setDragging(false);
      return;
    }
    const center = project(view.lon, view.lat, view.zoom);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cx: center.x, cy: center.y, moved: false };
    didDragRef.current = false;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointersRef.current.size === 2 && pinchDistRef.current) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      if (dist > 0) {
        const ratio = dist / pinchDistRef.current;
        if (ratio >= 1.35) {
          pinchDistRef.current = dist;
          zoomBy(1);
        } else if (ratio <= 0.74) {
          pinchDistRef.current = dist;
          zoomBy(-1);
        }
      }
      return;
    }

    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      current.moved = true;
      didDragRef.current = true;
      setDragging(true);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    if (current.moved) {
      setView(previous => ({ ...previous, ...unproject(current.cx - dx, current.cy - dy, previous.zoom) }));
      setBoundsDirty(true);
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchDistRef.current = undefined;
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = undefined;
      setDragging(false);
    }
  }

  function handleFeatureClick(id: string) {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    onSelect?.(id);
  }

  function handleFeatureKeyDown(event: ReactKeyboardEvent<SVGElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(id);
    }
  }

  const shellStyle = height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : undefined;

  return (
    <div
      ref={boxRef}
      className={className ? `${styles.shell} ${className}` : styles.shell}
      style={shellStyle}
      data-testid={testId}
      data-dragging={dragging ? "true" : undefined}
      role="region"
      aria-label={ariaLabel ?? text.mapLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div className={styles.tiles} aria-hidden="true">
        {tiles.map(tile => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            draggable={false}
            referrerPolicy="strict-origin-when-cross-origin"
            className={styles.tile}
            style={{ left: tile.x, top: tile.y }}
          />
        ))}
      </div>

      <svg width={size.width} height={size.height} className={styles.overlay}>
        {projected.areas.map(item => {
          const { feature } = item;
          const label = `${feature.title} (${text.tones[feature.tone]})`;
          const isFocused = focusedAreaId === feature.id;
          const polygonPoints = item.points?.map(([px, py]) => `${px},${py}`).join(" ");
          return (
            <g key={feature.id}>
              {item.points ? (
                <polygon
                  points={polygonPoints}
                  className={styles.area}
                  data-tone={feature.tone}
                  data-selected={feature.selected ? "true" : undefined}
                  data-hovered={feature.hovered ? "true" : undefined}
                  data-feature-id={feature.id}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={Boolean(feature.selected)}
                  onClick={() => handleFeatureClick(feature.id)}
                  onKeyDown={event => handleFeatureKeyDown(event, feature.id)}
                  onMouseEnter={() => onHover?.(feature.id)}
                  onMouseLeave={() => onHover?.(undefined)}
                  onFocus={() => { setFocusedAreaId(feature.id); onHover?.(feature.id); }}
                  onBlur={() => { setFocusedAreaId(prev => (prev === feature.id ? undefined : prev)); onHover?.(undefined); }}
                />
              ) : (
                <rect
                  x={item.x}
                  y={item.y}
                  width={Math.max(item.width, 4)}
                  height={Math.max(item.height, 4)}
                  rx={2}
                  className={styles.area}
                  data-tone={feature.tone}
                  data-selected={feature.selected ? "true" : undefined}
                  data-hovered={feature.hovered ? "true" : undefined}
                  data-feature-id={feature.id}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={Boolean(feature.selected)}
                  onClick={() => handleFeatureClick(feature.id)}
                  onKeyDown={event => handleFeatureKeyDown(event, feature.id)}
                  onMouseEnter={() => onHover?.(feature.id)}
                  onMouseLeave={() => onHover?.(undefined)}
                  onFocus={() => { setFocusedAreaId(feature.id); onHover?.(feature.id); }}
                  onBlur={() => { setFocusedAreaId(prev => (prev === feature.id ? undefined : prev)); onHover?.(undefined); }}
                />
              )}
              {isFocused && (
                item.points ? (
                  <>
                    <polygon points={polygonPoints} className={styles.areaFocusHalo} />
                    <polygon points={polygonPoints} className={styles.areaFocusRing} />
                  </>
                ) : (
                  <>
                    <rect x={item.x} y={item.y} width={Math.max(item.width, 4)} height={Math.max(item.height, 4)} rx={2} className={styles.areaFocusHalo} />
                    <rect x={item.x} y={item.y} width={Math.max(item.width, 4)} height={Math.max(item.height, 4)} rx={2} className={styles.areaFocusRing} />
                  </>
                )
              )}
            </g>
          );
        })}
      </svg>

      <div className={styles.markers}>
        {projected.markers.map(item => {
          const { feature } = item;
          const label = `${feature.title} (${text.tones[feature.tone]})`;
          return (
            <button
              key={feature.id}
              type="button"
              className={styles.markerButton}
              style={{ left: item.x, top: item.y }}
              data-tone={feature.tone}
              data-selected={feature.selected ? "true" : undefined}
              data-hovered={feature.hovered ? "true" : undefined}
              data-feature-id={feature.id}
              aria-label={label}
              aria-pressed={Boolean(feature.selected)}
              onPointerDown={event => event.stopPropagation()}
              onClick={() => onSelect?.(feature.id)}
              onMouseEnter={() => onHover?.(feature.id)}
              onMouseLeave={() => onHover?.(undefined)}
              onFocus={() => onHover?.(feature.id)}
              onBlur={() => onHover?.(undefined)}
            >
              <span className={styles.markerChip} aria-hidden="true">
                <span className={styles.markerDot} />
              </span>
            </button>
          );
        })}

        {projected.clusters.map(cluster => (
          <button
            key={cluster.key}
            type="button"
            className={styles.clusterButton}
            style={{ left: cluster.x, top: cluster.y }}
            data-cluster-count={cluster.count}
            data-selected={cluster.hasSelected ? "true" : undefined}
            data-hovered={cluster.hasHovered ? "true" : undefined}
            aria-label={text.clusterLabel(cluster.count)}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => zoomToCluster(cluster.bounds)}
          >
            <span className={styles.clusterBadge} aria-hidden="true">{cluster.count}</span>
          </button>
        ))}
      </div>

      {onBoundsChange && boundsDirty && (
        <div className={styles.searchAreaWrap} onPointerDown={event => event.stopPropagation()}>
          <button
            type="button"
            className={styles.searchAreaButton}
            onClick={() => {
              onBoundsChange(viewportBounds(view, size.width, size.height));
              setBoundsDirty(false);
            }}
          >
            {text.searchArea}
          </button>
        </div>
      )}

      <div className={styles.controls} onPointerDown={event => event.stopPropagation()}>
        <div className={styles.zoomGroup}>
          <button
            type="button"
            className={styles.controlButton}
            aria-label={text.zoomIn}
            disabled={view.zoom >= MAX_ZOOM}
            onClick={() => zoomBy(1)}
          >
            +
          </button>
          <button
            type="button"
            className={styles.controlButton}
            aria-label={text.zoomOut}
            disabled={view.zoom <= MIN_ZOOM}
            onClick={() => zoomBy(-1)}
          >
            −
          </button>
        </div>
        <button
          type="button"
          className={`${styles.controlButton} ${styles.resetButton}`}
          onClick={resetToSweden}
        >
          {text.resetSweden}
        </button>
      </div>

      <small className={styles.credit} onPointerDown={event => event.stopPropagation()}>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
      </small>
    </div>
  );
}
