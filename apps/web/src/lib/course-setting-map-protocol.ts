import type { CircleArc, DescriptionSuggestion, DetailCircle, NumberObstaclesData, SuggestOptions, SymbolCatalogEntry, TrainingMapPass } from "@o-tid/course-setting";
import type { ColorAdjust, ColorUsage, MapColor, MapGeoreference, Point } from "@o-tid/map-file";
import type { Bounds } from "./course-setting-viewport";

/**
 * Steg 62 (ADR-0177): banläggningens karta ritas i en Worker ur kartfilen, utsnittet som syns i den upplösning som syns.
 * Kartfilen läses en gång; varje ny vy ger en ny bild (en äldre beställning som inte hunnit ritas hoppas över).
 */
export type MapRenderRequest =
  | { readonly type: "load"; readonly bytes: ArrayBuffer; readonly fileName: string }
  | { readonly type: "render"; readonly id: number; readonly width: number; readonly height: number; readonly pxPerMm: number;
      readonly origin: Point;
      /** Steg 64: kartans färger enligt utskriftsprofilen (kartfilen ändras inte). */
      readonly colorAdjust?: Readonly<Record<number, ColorAdjust>> | undefined;
      /** BL-förslaget: bara dessa färger (id), och utan vit bakgrund (kartan över banan i tabellens ordning). */
      readonly onlyColors?: readonly number[] | undefined;
      readonly background?: boolean | undefined;
      /** Träningsläget (ADR-0192 beslut 9): kartan i pass med klippning och filter. */
      readonly passes?: readonly TrainingMapPass[] | undefined }
  /** Träningsläget: kartans symboler med grupp och antal (symbolfiltrets val per symbol). */
  | { readonly type: "symbols"; readonly id: number }
  /** Ringklipp (ADR-0180 beslut 10): detaljgapen för ringarna, räknade på kartfilen som redan är inläst. */
  | { readonly type: "detailGaps"; readonly id: number; readonly circles: readonly DetailCircle[]; readonly sprint: boolean;
      /** ADR-0211 beslut 4: kontrollerna vars nummer placeras; svaret får kartans hinder för numren. */
      readonly points?: readonly { readonly id: string; readonly at: Point }[] | undefined }
  /** ADR-0180 beslut 13: förslag på kontrollbeskrivning för punkterna (kontrollens id och läge). */
  | { readonly type: "suggest"; readonly id: number; readonly points: readonly SuggestPoint[]; readonly options: SuggestOptions };

export interface SuggestPoint { readonly id: string; readonly at: Point }
export type SuggestionsByControl = Readonly<Record<string, readonly DescriptionSuggestion[]>>;

export type MapRenderErrorCode = "NOT_A_MAP_FILE" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "INVALID" | "EMPTY" | "NO_CANVAS" | "FAILED";

export type MapRenderResponse =
  | { readonly type: "loaded"; readonly bounds: Bounds; readonly scale: number; readonly georeference: MapGeoreference | null;
      /** Steg 64: kartfilens färger (utskriftsprofilen och förhandskontrollen). */
      readonly colors: readonly MapColor[];
      /** BL-förslaget: vad varje färg används till (`colorUsage`). */
      readonly usage?: ReadonlyMap<number, ColorUsage> | undefined }
  | { readonly type: "rendered"; readonly id: number; readonly bitmap: ImageBitmap }
  /** Tomt när kartan inte är inläst; `failed` när uträkningen misslyckades (ringarna ritas då hela och editorn säger det). */
  | { readonly type: "detailGaps"; readonly id: number; readonly gaps: Readonly<Record<string, readonly CircleArc[]>>; readonly failed?: boolean;
      readonly obstacles?: Readonly<Record<string, NumberObstaclesData>> | undefined }
  /** Tomt när kartan inte är inläst; `failed` när uträkningen misslyckades (editorn säger det). */
  | { readonly type: "suggestions"; readonly id: number; readonly suggestions: SuggestionsByControl; readonly failed?: boolean }
  | { readonly type: "symbols"; readonly id: number; readonly symbols: readonly SymbolCatalogEntry[] }
  | { readonly type: "error"; readonly code: MapRenderErrorCode };

/** Bildens största sida i pixlar (webbläsarnas gräns för en canvas med marginal). */
export const MAX_RENDER_SIDE = 4096;

/** Workern sedd från sidan: `load` en gång, sedan `render` för varje ny vy; bara det senaste svaret används. */
export class MapRenderSession {
  private readonly worker: Worker;
  private latest = 0;
  private onRendered: ((id: number, bitmap: ImageBitmap) => void) | undefined;
  private latestGaps = 0;
  private onGaps: ((gaps: Readonly<Record<string, readonly CircleArc[]>>, failed: boolean, obstacles: Readonly<Record<string, NumberObstaclesData>>) => void) | undefined;
  private latestSuggest = 0;
  private onSuggestions: ((suggestions: SuggestionsByControl, failed: boolean) => void) | undefined;
  private latestSymbols = 0;
  private onSymbols: ((symbols: readonly SymbolCatalogEntry[]) => void) | undefined;

  constructor(createWorker: () => Worker, private readonly onLoaded: (bounds: Bounds, scale: number, georeference: MapGeoreference | null,
    colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>) => void,
    private readonly onError: (code: MapRenderErrorCode) => void) {
    this.worker = createWorker();
    this.worker.onmessage = (event: MessageEvent<MapRenderResponse>) => {
      const message = event.data;
      if (message.type === "loaded") this.onLoaded(message.bounds, message.scale, message.georeference, message.colors, message.usage ?? new Map());
      else if (message.type === "error") this.onError(message.code);
      else if (message.type === "detailGaps") { if (message.id === this.latestGaps) this.onGaps?.(message.gaps, message.failed === true, message.obstacles ?? {}); }
      else if (message.type === "suggestions") { if (message.id === this.latestSuggest) this.onSuggestions?.(message.suggestions, message.failed === true); }
      else if (message.type === "symbols") { if (message.id === this.latestSymbols) this.onSymbols?.(message.symbols); }
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

  /** Detaljgapen för ringarna och hindren för numren; bara svaret på den senaste beställningen används. */
  detailGaps(circles: readonly DetailCircle[], sprint: boolean,
    onGaps: (gaps: Readonly<Record<string, readonly CircleArc[]>>, failed: boolean, obstacles: Readonly<Record<string, NumberObstaclesData>>) => void,
    points?: readonly { readonly id: string; readonly at: Point }[]): void {
    const id = ++this.latestGaps;
    this.onGaps = onGaps;
    this.worker.postMessage({ type: "detailGaps", id, circles, sprint, ...(points ? { points } : {}) } satisfies MapRenderRequest);
  }

  /** Förslag på kontrollbeskrivning för punkterna; bara svaret på den senaste beställningen används. */
  suggest(points: readonly SuggestPoint[], options: SuggestOptions, onSuggestions: (suggestions: SuggestionsByControl, failed: boolean) => void): void {
    const id = ++this.latestSuggest;
    this.onSuggestions = onSuggestions;
    this.worker.postMessage({ type: "suggest", id, points, options } satisfies MapRenderRequest);
  }

  /** Kartans symboler (träningslägets symbolfilter); bara svaret på den senaste beställningen används. */
  symbols(onSymbols: (symbols: readonly SymbolCatalogEntry[]) => void): void {
    const id = ++this.latestSymbols;
    this.onSymbols = onSymbols;
    this.worker.postMessage({ type: "symbols", id } satisfies MapRenderRequest);
  }

  close() { this.onSymbols = undefined; this.onRendered = undefined; this.onGaps = undefined; this.onSuggestions = undefined; this.worker.terminate(); }
}
