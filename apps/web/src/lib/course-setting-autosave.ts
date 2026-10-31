/**
 * Steg 62: autosparandet i banläggningen. En ändring sparas efter en kort paus (1,5 s), högst ett sparande åt gången, och
 * alltid den senaste versionen av dokumentet. Varje sparande bygger på versionen som servern gav förra gången; har någon
 * annan sparat (409) slutar autosparandet och editorn visar konflikten tills banläggaren laddar om. Ett nätfel försöker
 * igen efter en stund. Ren klass utan React; tiden och anropet ges utifrån (tester).
 */
export type AutosaveStatus = "saved" | "pending" | "saving" | "conflict" | "failed" | "too-large";

export type SaveOutcome<C> = { readonly kind: "saved"; readonly version: number } | { readonly kind: "conflict"; readonly conflict: C }
  | { readonly kind: "too-large" };

export interface AutosaveOptions<D, C> {
  readonly save: (document: D, expectedVersion: number) => Promise<SaveOutcome<C>>;
  readonly onStatus: (status: AutosaveStatus, detail?: { version?: number; conflict?: C }) => void;
  readonly delayMs?: number;
  readonly retryMs?: number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export class Autosaver<D, C = unknown> {
  private version: number;
  private pending: D | undefined;
  private timer: unknown;
  private inFlight = false;
  private running: Promise<void> | undefined;
  private stopped = false;
  private readonly delayMs: number;
  private readonly retryMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(version: number, private readonly options: AutosaveOptions<D, C>) {
    this.version = version;
    this.delayMs = options.delayMs ?? 1500;
    this.retryMs = options.retryMs ?? 5000;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  /** Versionen som nästa sparande bygger på. */
  get currentVersion(): number { return this.version; }
  /** Det finns ändringar som inte är sparade. */
  get dirty(): boolean { return this.pending !== undefined || this.inFlight; }

  /** Dokumentet har ändrats: spara det efter pausen (en ny ändring skjuter upp sparandet). */
  change(document: D) {
    if (this.stopped) return;
    this.pending = document;
    this.options.onStatus("pending");
    this.schedule(this.delayMs);
  }

  /** Spara nu (t.ex. innan överföringen); väntar in ett pågående sparande. */
  async flush(): Promise<void> {
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    while (this.running) await this.running;
    await this.run();
  }

  /** Ett nytt dokument från servern (inläsning, återställning, omladdning): sparandet börjar om från den versionen. */
  reset(version: number) {
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
    this.version = version; this.pending = undefined; this.stopped = false;
    this.options.onStatus("saved", { version });
  }

  stop() {
    this.stopped = true;
    if (this.timer !== undefined) { this.clearTimer(this.timer); this.timer = undefined; }
  }

  private schedule(ms: number) {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = undefined; void this.run(); }, ms);
  }

  private run(): Promise<void> {
    if (this.inFlight || this.stopped || this.pending === undefined) return this.running ?? Promise.resolve();
    this.running = this.save().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async save(): Promise<void> {
    if (this.pending === undefined) return;
    const document = this.pending;
    this.pending = undefined;
    this.inFlight = true;
    this.options.onStatus("saving");
    try {
      const outcome = await this.options.save(document, this.version);
      if (outcome.kind === "conflict") {
        this.stopped = true;
        this.options.onStatus("conflict", { conflict: outcome.conflict });
        return;
      }
      if (outcome.kind === "too-large") {
        this.options.onStatus("too-large");
        return;
      }
      this.version = outcome.version;
      if (this.pending === undefined) this.options.onStatus("saved", { version: outcome.version });
    } catch {
      // Nätet: samma dokument igen om en stund (om inget nyare kommit).
      this.pending ??= document;
      this.options.onStatus("failed");
      this.schedule(this.retryMs);
      return;
    } finally {
      this.inFlight = false;
    }
    if (this.pending !== undefined && !this.stopped) this.schedule(this.delayMs);
  }
}
