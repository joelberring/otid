import { describe, expect, it, vi } from "vitest";
import { panBy, zoomAt, type Viewport } from "../../lib/course-setting-viewport";
import { createViewScheduler, syncCanvasSize } from "./course-setting-map";

describe("course-setting-map: GPU-vakt och rAF-batchning", () => {
  it("tilldelar bara canvas.width och canvas.height när pixelmåttet faktiskt ändrats", () => {
    let widthWrites = 0, heightWrites = 0;
    let width = 0, height = 0;
    const canvas = {
      get width() { return width; },
      set width(value: number) { widthWrites += 1; width = value; },
      get height() { return height; },
      set height(value: number) { heightWrites += 1; height = value; }
    };

    expect(syncCanvasSize(canvas, 1200, 800, 2)).toBe(true);
    expect(width).toBe(2400);
    expect(height).toBe(1600);
    expect(widthWrites).toBe(1);
    expect(heightWrites).toBe(1);

    // Samma CSS-storlek och DPR (pan/zoom/drag-bildrutor): noll omallokeringar.
    for (let frame = 0; frame < 60; frame += 1) {
      expect(syncCanvasSize(canvas, 1200, 800, 2)).toBe(false);
    }
    expect(widthWrites).toBe(1);
    expect(heightWrites).toBe(1);

    // Ny storlek eller ny DPR tilldelar igen.
    expect(syncCanvasSize(canvas, 1201, 800, 2)).toBe(true);
    expect(width).toBe(2402);
    expect(widthWrites).toBe(2);
    expect(heightWrites).toBe(2);
  });

  it("samlar flera wheel-/pan-uppdateringar till en rAF-flush och tillämpar dem i exakt ordning", () => {
    let current: Viewport | undefined = { centerX: 100, centerY: 100, pxPerMm: 4, width: 800, height: 600 };
    const frames: (() => void)[] = [];
    const cancelled: number[] = [];
    const apply = vi.fn((transform: (previous: Viewport | undefined) => Viewport | undefined) => {
      current = transform(current);
    });
    const scheduler = createViewScheduler(
      apply,
      callback => { frames.push(callback); return frames.length; },
      id => { cancelled.push(id); }
    );

    scheduler.schedule(previous => panBy(previous, 20, -10));
    scheduler.schedule(previous => panBy(previous, 12, 6));
    scheduler.schedule(previous => zoomAt(previous, 1.25, { x: 400, y: 300 }));
    expect(frames).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();

    frames[0]!();
    expect(apply).toHaveBeenCalledTimes(1);
    const expected = zoomAt(panBy(panBy({ centerX: 100, centerY: 100, pxPerMm: 4, width: 800, height: 600 }, 20, -10), 12, 6), 1.25, { x: 400, y: 300 });
    expect(current).toEqual(expected);

    // flush() tömmer direkt (t.ex. vid pointerup) och avbokar väntande bildruta.
    scheduler.schedule(previous => panBy(previous, 8, 0));
    expect(frames).toHaveLength(2);
    scheduler.flush();
    expect(cancelled).toEqual([2]);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(current).toEqual(panBy(expected, 8, 0));

    // cancel() kastar väntande arbete utan att anropa apply.
    scheduler.schedule(previous => panBy(previous, 100, 100));
    scheduler.cancel();
    expect(cancelled).toEqual([2, 3]);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
