import type { MapColor, MapGeoreference, MapObject, Point } from "@o-tid/map-file";
import type {
  Coverage, GeneralizeOptions, GeneralizeResult, KeyedState, NormResult, ObjectKey, ObjectRef, ReconMarker, ReconSettings, TrackPoint, WarpChange, WarpOptions
} from "@o-tid/map-revision";
import type { MapRenderErrorCode, MapRenderRequest } from "./course-setting-map-protocol";
import type { Bounds } from "./course-setting-viewport";

/**
 * ADR-0219 (K1): kartprojektets karta ritas i en egen Worker (`map-project-worker.ts`). Den läser grundfilen en gång (med
 * objektens källor), lägger projektets ändringar ovanpå (`editedObjects`) och ritar vyn med samma ritare som annars. Samma
 * beställning av en bild som banläggningens (`render`), så att kartvyn (`CourseSettingMap`) kan användas som den är.
 */
export type SymbolGroup = "LANDFORMS" | "ROCK" | "WATER" | "VEGETATION" | "MANMADE" | "TECHNICAL" | "COURSE" | "OTHER";

/** En symbol i paletten: vad den ritar, gruppen (lagren) och en förenklad stil för förhandsvisningen medan man drar. */
export interface CatalogSymbol {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: MapObject["kind"];
  readonly group: SymbolGroup;
  /** Förhandsvisningen: linjens färg och bredd (mm), ytans fyllning (CSS-färg). */
  readonly stroke?: string | undefined;
  readonly width?: number | undefined;
  readonly fill?: string | undefined;
  /** Liten bild av symbolen (PNG). */
  readonly icon?: Blob | undefined;
  /** Hur många objekt i kartan som har symbolen. */
  readonly count: number;
}

export interface ProjectHit {
  readonly key: ObjectKey;
  /** Grundfilens objekt (null för ett nytt objekt). */
  readonly ref: ObjectRef | null;
  readonly object: MapObject;
  readonly distance: number;
}

export type MapProjectRequest =
  | { readonly type: "load"; readonly bytes: ArrayBuffer; readonly fileName: string; readonly sha256: string }
  | Extract<MapRenderRequest, { type: "render" }>
  /** Projektets objekt som inte är som i grundfilen (hela listan varje gång). */
  | { readonly type: "states"; readonly states: readonly (readonly [ObjectKey, KeyedState])[] }
  | { readonly type: "hit"; readonly id: number; readonly point: Point; readonly tolerance: number; readonly hidden: readonly string[] }
  | { readonly type: "catalog"; readonly id: number }
  /** K3: rekningens status för alla objekt och täckningen ur spåren (kartans mm) och de giltiga bekräftelserna. */
  | { readonly type: "recon"; readonly id: number; readonly tracks: readonly (readonly TrackPoint[])[]; readonly checked: readonly ObjectKey[];
      readonly settings: ReconSettings }
  /** Normkontrollen (ISOM 2017-2:s minimimått) för kartan med ändringarna. */
  | { readonly type: "norm"; readonly id: number }
  /** K6: generaliseringens ändringar (förenkla, ta bort det normen inte tillåter) för kartan med ändringarna. */
  | { readonly type: "generalize"; readonly id: number; readonly options: GeneralizeOptions }
  /** Lagren (ägaren 2026-11-09): objekten med en symbol, för att slå ihop symbolen med en annan. */
  | { readonly type: "bySymbol"; readonly id: number; readonly symbol: string }
  /** K6b: kartan rättad med passpunkter (likformig, affin eller gummiduk). */
  | { readonly type: "warp"; readonly id: number; readonly options: WarpOptions };

export type MapProjectResponse =
  | { readonly type: "loaded"; readonly bounds: Bounds; readonly scale: number; readonly georeference: MapGeoreference | null;
      readonly colors: readonly MapColor[]; readonly objects: number;
      /** Nordlinjernas (601) riktning i kartan, grader medurs; saknas när kartan inte har några. */
      readonly northLines?: number | undefined }
  | { readonly type: "rendered"; readonly id: number; readonly bitmap: ImageBitmap }
  | { readonly type: "hit"; readonly id: number; readonly hits: readonly ProjectHit[] }
  | { readonly type: "catalog"; readonly id: number; readonly symbols: readonly CatalogSymbol[] }
  | { readonly type: "recon"; readonly id: number; readonly result: ReconResult }
  | { readonly type: "norm"; readonly id: number; readonly result: NormResult }
  | { readonly type: "generalize"; readonly id: number; readonly result: GeneralizeResult; readonly refs: readonly (readonly [ObjectKey, ObjectRef])[] }
  | { readonly type: "bySymbol"; readonly id: number; readonly objects: readonly SymbolObject[] }
  | { readonly type: "warp"; readonly id: number; readonly changes: readonly WarpChange<ObjectKey>[]; readonly refs: readonly (readonly [ObjectKey, ObjectRef])[] }
  | { readonly type: "error"; readonly code: MapRenderErrorCode };

/** Ett objekt med sin nyckel och (för grundfilens objekt) sin referens. */
export interface SymbolObject { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }

/** Rekningens status (markörerna) och täckningen (saknas utan spår). */
export interface ReconResult { readonly markers: readonly ReconMarker[]; readonly coverage: Coverage | undefined }

/** Workern sedd från sidan. Bara det senaste svaret på varje slags fråga används. */
export class MapProjectSession {
  private readonly worker: Worker;
  private latest = 0;
  private onRendered: ((id: number, bitmap: ImageBitmap) => void) | undefined;
  private latestHit = 0;
  private onHit: ((hits: readonly ProjectHit[]) => void) | undefined;
  private latestCatalog = 0;
  private onCatalog: ((symbols: readonly CatalogSymbol[]) => void) | undefined;
  private latestRecon = 0;
  private onRecon: ((result: ReconResult) => void) | undefined;
  private latestNorm = 0;
  private onNorm: ((result: NormResult) => void) | undefined;
  private latestGeneralize = 0;
  private onGeneralize: ((result: GeneralizeResult, refs: ReadonlyMap<ObjectKey, ObjectRef>) => void) | undefined;
  private latestBySymbol = 0;
  private onBySymbol: ((objects: readonly SymbolObject[]) => void) | undefined;
  private latestWarp = 0;
  private onWarp: ((changes: readonly WarpChange<ObjectKey>[], refs: ReadonlyMap<ObjectKey, ObjectRef>) => void) | undefined;

  constructor(createWorker: () => Worker, onLoaded: (loaded: Extract<MapProjectResponse, { type: "loaded" }>) => void,
    onError: (code: MapRenderErrorCode) => void) {
    this.worker = createWorker();
    this.worker.onmessage = (event: MessageEvent<MapProjectResponse>) => {
      const message = event.data;
      if (message.type === "loaded") onLoaded(message);
      else if (message.type === "error") onError(message.code);
      else if (message.type === "hit") { if (message.id === this.latestHit) this.onHit?.(message.hits); }
      else if (message.type === "catalog") { if (message.id === this.latestCatalog) this.onCatalog?.(message.symbols); }
      else if (message.type === "recon") { if (message.id === this.latestRecon) this.onRecon?.(message.result); }
      else if (message.type === "norm") { if (message.id === this.latestNorm) this.onNorm?.(message.result); }
      else if (message.type === "generalize") { if (message.id === this.latestGeneralize) this.onGeneralize?.(message.result, new Map(message.refs)); }
      else if (message.type === "bySymbol") { if (message.id === this.latestBySymbol) this.onBySymbol?.(message.objects); }
      else if (message.type === "warp") { if (message.id === this.latestWarp) this.onWarp?.(message.changes, new Map(message.refs)); }
      else if (message.id === this.latest && this.onRendered) this.onRendered(message.id, message.bitmap);
      else message.bitmap.close();
    };
    this.worker.onerror = event => { event.preventDefault(); onError("FAILED"); };
  }

  private post(message: MapProjectRequest, transfer: Transferable[] = []) { this.worker.postMessage(message, transfer); }

  load(bytes: ArrayBuffer, fileName: string, sha256: string) { this.post({ type: "load", bytes, fileName, sha256 }, [bytes]); }

  render(request: Omit<Extract<MapRenderRequest, { type: "render" }>, "type" | "id">, onRendered: (id: number, bitmap: ImageBitmap) => void): number {
    const id = ++this.latest;
    this.onRendered = onRendered;
    this.post({ type: "render", id, ...request });
    return id;
  }

  states(states: ReadonlyMap<ObjectKey, KeyedState>) { this.post({ type: "states", states: [...states] }); }

  hit(point: Point, tolerance: number, hidden: readonly string[], onHit: (hits: readonly ProjectHit[]) => void) {
    const id = ++this.latestHit;
    this.onHit = onHit;
    this.post({ type: "hit", id, point, tolerance, hidden });
  }

  catalog(onCatalog: (symbols: readonly CatalogSymbol[]) => void) {
    const id = ++this.latestCatalog;
    this.onCatalog = onCatalog;
    this.post({ type: "catalog", id });
  }

  recon(input: { tracks: readonly (readonly TrackPoint[])[]; checked: readonly ObjectKey[]; settings: ReconSettings }, onRecon: (result: ReconResult) => void) {
    const id = ++this.latestRecon;
    this.onRecon = onRecon;
    this.post({ type: "recon", id, ...input });
  }

  norm(onNorm: (result: NormResult) => void) {
    const id = ++this.latestNorm;
    this.onNorm = onNorm;
    this.post({ type: "norm", id });
  }

  generalize(options: GeneralizeOptions, onGeneralize: (result: GeneralizeResult, refs: ReadonlyMap<ObjectKey, ObjectRef>) => void) {
    const id = ++this.latestGeneralize;
    this.onGeneralize = onGeneralize;
    this.post({ type: "generalize", id, options });
  }

  bySymbol(symbol: string, onObjects: (objects: readonly SymbolObject[]) => void) {
    const id = ++this.latestBySymbol;
    this.onBySymbol = onObjects;
    this.post({ type: "bySymbol", id, symbol });
  }

  warp(options: WarpOptions, onWarp: (changes: readonly WarpChange<ObjectKey>[], refs: ReadonlyMap<ObjectKey, ObjectRef>) => void) {
    const id = ++this.latestWarp;
    this.onWarp = onWarp;
    this.post({ type: "warp", id, options });
  }

  close() {
    this.onGeneralize = undefined; this.onBySymbol = undefined; this.onWarp = undefined;
    this.onRendered = undefined; this.onHit = undefined; this.onCatalog = undefined; this.onRecon = undefined; this.onNorm = undefined;
    this.worker.terminate();
  }
}

/** Symbolens grupp efter ISOM/ISSprOM-numret (lagren i editorn). */
export function symbolGroup(main: number): SymbolGroup {
  if (main >= 100 && main < 200) return "LANDFORMS";
  if (main >= 200 && main < 300) return "ROCK";
  if (main >= 300 && main < 400) return "WATER";
  if (main >= 400 && main < 500) return "VEGETATION";
  if (main >= 500 && main < 600) return "MANMADE";
  if (main >= 600 && main < 700) return "TECHNICAL";
  if (main >= 700 && main < 800) return "COURSE";
  return "OTHER";
}
