"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { publicMapSv as text } from "../i18n/public-map-sv";

const maximumZoom = 4;
const zoomStep = 0.5;
const keyboardPanPixels = 80;

type PublicMapViewerProps = { raceId: string; title: string };

export function PublicMapViewer({ raceId, title }: PublicMapViewerProps) {
  return <PublicMapViewerForRace key={raceId} raceId={raceId} title={title} />;
}

function PublicMapViewerForRace({ raceId, title }: PublicMapViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pendingCenterRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setImageLoaded(true);
  }, []);

  useLayoutEffect(() => {
    const center = pendingCenterRef.current;
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!center || !viewport || !image) return;
    pendingCenterRef.current = null;
    if (zoom === 1) {
      viewport.scrollTo(0, 0);
      return;
    }
    const bounds = image.getBoundingClientRect();
    viewport.scrollTo(
      Math.max(0, center.x * bounds.width - viewport.clientWidth / 2),
      Math.max(0, center.y * bounds.height - viewport.clientHeight / 2)
    );
  }, [zoom]);

  const changeZoom = (next: number) => {
    if (!imageLoaded) return;
    const level = Math.max(1, Math.min(maximumZoom, next));
    if (level === zoom) return;
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return;
    const bounds = image.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    pendingCenterRef.current = {
      x: Math.max(0, Math.min(1, (viewport.scrollLeft + viewport.clientWidth / 2) / bounds.width)),
      y: Math.max(0, Math.min(1, (viewport.scrollTop + viewport.clientHeight / 2) / bounds.height))
    };
    setZoom(level);
  };

  const panWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    let left = 0;
    let top = 0;
    switch (event.key) {
      case "ArrowLeft": left = -keyboardPanPixels; break;
      case "ArrowRight": left = keyboardPanPixels; break;
      case "ArrowUp": top = -keyboardPanPixels; break;
      case "ArrowDown": top = keyboardPanPixels; break;
      default: return;
    }
    const maximumLeft = viewport.scrollWidth - viewport.clientWidth;
    const maximumTop = viewport.scrollHeight - viewport.clientHeight;
    if ((left < 0 && viewport.scrollLeft <= 0) || (left > 0 && viewport.scrollLeft >= maximumLeft - 1) ||
        (top < 0 && viewport.scrollTop <= 0) || (top > 0 && viewport.scrollTop >= maximumTop - 1)) return;
    event.preventDefault();
    viewport.scrollBy({ left, top, behavior: "auto" });
  };

  if (imageFailed) return <p role="alert" className="public-map-error">{text.imageUnavailable}</p>;

  return <section className="public-map-viewer" aria-label={title}>
    <div className="public-map-controls" role="group" aria-label={text.zoomControls}>
      <button type="button" onClick={() => changeZoom(zoom + zoomStep)} disabled={!imageLoaded || zoom >= maximumZoom}>{text.zoomIn}</button>
      <button type="button" onClick={() => changeZoom(zoom - zoomStep)} disabled={!imageLoaded || zoom <= 1}>{text.zoomOut}</button>
      <button type="button" onClick={() => changeZoom(1)} disabled={!imageLoaded || zoom <= 1}>{text.zoomReset}</button>
      <output aria-live="polite">{text.zoomLevel}: {Math.round(zoom * 100)} %</output>
    </div>
    {!imageLoaded && <p role="status" className="public-map-pan-hint">{text.imageLoading}</p>}
    <p className="public-map-pan-hint" id="public-map-pan-hint">{text.panHint}</p>
    <div ref={viewportRef} className="public-map-viewport" data-zoomed={zoom > 1} role="region" aria-label={text.mapViewport} aria-describedby="public-map-pan-hint" tabIndex={0} onKeyDown={panWithKeyboard}>
      <img ref={imageRef} src={`/api/public/races/${raceId}/map`} alt={title} draggable={false} style={{ inlineSize: `${zoom * 100}%` }} onLoad={() => setImageLoaded(true)} onError={() => setImageFailed(true)} />
    </div>
  </section>;
}
