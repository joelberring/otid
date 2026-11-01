import type { CircleArc, DetailCircle } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import type { Bounds } from "./course-setting-viewport";

/**
 * Steg 62 (ADR-0177): banläggningens karta ritas i en Worker ur kartfilen, utsnittet som syns i den upplösning som syns.
 * Kartfilen läses en gång; varje ny vy ger en ny bild (en äldre beställning som inte hunnit ritas hoppas över).
 */
export type MapRenderRequest =
  | { readonly type: "load"; readonly bytes: ArrayBuffer; readonly fileName: string }
  | { readonly type: "render"; readonly id: number; readonly width: number; readonly height: number; readonly pxPerMm: number;
      readonly origin: Point }
  /** Ringklipp (ADR-0180 beslut 10): detaljgapen för ringarna, räknade på kartfilen som redan är inläst. */
  | { readonly type: "detailGaps"; readonly id: number; readonly circles: readonly DetailCircle[]; readonly sprint: boolean };

export type MapRenderErrorCode = "NOT_A_MAP_FILE" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "INVALID" | "EMPTY" | "NO_CANVAS" | "FAILED";

export type MapRenderResponse =
  | { readonly type: "loaded"; readonly bounds: Bounds; readonly scale: number }
  | { readonly type: "rendered"; readonly id: number; readonly bitmap: ImageBitmap }
  /** Tomt när kartan inte gick att läsa eller uträkningen misslyckades (ringarna ritas då hela). */
  | { readonly type: "detailGaps"; readonly id: number; readonly gaps: Readonly<Record<string, readonly CircleArc[]>> }
  | { readonly type: "error"; readonly code: MapRenderErrorCode };

/** Bildens största sida i pixlar (webbläsarnas gräns för en canvas med marginal). */
export const MAX_RENDER_SIDE = 4096;

/** Workern sedd från sidan: `load` en gång, sedan `render` för varje ny vy; bara det senaste svaret används. */
export class MapRenderSession {
  private readonly worker: Worker;
  private latest = 0;
  private onRendered: ((id: number, bitmap: ImageBitmap) => void) | undefined;
  private latestGaps = 0;
  private onGaps: ((gaps: Readonly<Record<string, readonly CircleArc[]>>) => void) | undefined;

  constructor(createWorker: () => Worker, private readonly onLoaded: (bounds: Bounds, scale: number) => void,
    private readonly onError: (code: MapRenderErrorCode) => void) {
    this.worker = createWorker();
    this.worker.onmessage = (event: MessageEvent<MapRenderResponse>) => {
      const message = event.data;
      if (message.type === "loaded") this.onLoaded(message.bounds, message.scale);
      else if (message.type === "error") this.onError(message.code);
      else if (message.type === "detailGaps") { if (message.id === this.latestGaps) this.onGaps?.(message.gaps); }
      else if (message.id === this.latest && this.onRendered) this.onRendered(message.id, message.bitmap);
      else message.bitmap.close();
    };
    this.worker.onerror = event => { event.preventDefault(); this.onError("FAILED"); };
  }

  load(bytes: ArrayBuffer, fileName: string) { this.worker.postMessage({ type: "load", bytes, fileName } satisfies MapRenderRequest, [bytes]); }

  render(request: Omit<Extract<MapRenderRequest, { type: "render" }>, "type" | "id">, onRendered: (id: number, bitmap: ImageBitmap) => void): number {
    const id = ++this.latest;
    this.onRendered = onRendered;
    this.worker.postMessage({ type: "render", id, ...request } satisfies MapRenderRequest);
    return id;
  }

  /** Detaljgapen för ringarna; bara svaret på den senaste beställningen används. */
  detailGaps(circles: readonly DetailCircle[], sprint: boolean, onGaps: (gaps: Readonly<Record<string, readonly CircleArc[]>>) => void): void {
    const id = ++this.latestGaps;
    this.onGaps = onGaps;
    this.worker.postMessage({ type: "detailGaps", id, circles, sprint } satisfies MapRenderRequest);
  }

  close() { this.onRendered = undefined; this.onGaps = undefined; this.worker.terminate(); }
}
