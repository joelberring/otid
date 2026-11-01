/**
 * Steg 65: innehållsströmmen (PDF-operatorer som text) med färgerna och övertrycket. Färgrymderna och ExtGState delas av
 * alla sidor (`Resources`); här får de korta namn (/CS0 …, /GOP och /GKO) och skrivs som objekt i `write-pdf.ts`.
 */
import type { Cmyk, Ink, Paint } from "./paint";

/** Tal i PDF: högst tre decimaler (tusendels punkt), aldrig exponentform. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded === 0) return "0";
  const text = rounded.toFixed(3);
  return text.replace(/\.?0+$/, "");
}

/** En färgrymd för dekorfärger: plåtarnas namn och CMYK-alternativ (en plåt = /Separation, flera = /DeviceN). */
export interface SpotSpace { readonly names: readonly string[]; readonly alternates: readonly Cmyk[] }

/** Färgrymderna i dokumentet, en per unik uppsättning plåtar. */
export class ColorSpaces {
  readonly spaces: { readonly key: string; readonly name: string; readonly space: SpotSpace }[] = [];
  private readonly byKey = new Map<string, string>();
  nameFor(ink: Extract<Ink, { kind: "SPOT" }>): string {
    const key = ink.names.map((name, index) => `${name}=${cmykKey(ink.alternates[index]!)}`).join("|");
    const known = this.byKey.get(key);
    if (known) return known;
    const name = `CS${this.spaces.length}`;
    this.byKey.set(key, name);
    this.spaces.push({ key, name, space: { names: ink.names, alternates: ink.alternates } });
    return name;
  }
  /** Plåtarna som används (för rapporten). */
  plates(): string[] {
    return [...new Set(this.spaces.flatMap(entry => entry.space.names))];
  }
}

const cmykKey = (cmyk: Cmyk) => [cmyk.c, cmyk.m, cmyk.y, cmyk.k].map(value => num(value)).join(",");

/** Övertryck på (/OP /op true, /OPM 1) och av (knockout). */
export const GS_OVERPRINT = "GOP";
export const GS_KNOCKOUT = "GKO";

interface State { fill: string; stroke: string; gs: string; width: string; cap: string; join: string; dash: string; miter: string }
const INITIAL: State = { fill: "0 g", stroke: "0 G", gs: GS_KNOCKOUT, width: "1", cap: "0", join: "0", dash: "[] 0", miter: "10" };

/** Operatorer för en innehållsström med enkel tillståndsföljning (q/Q sparar och återställer). */
export class Content {
  private readonly parts: string[] = [];
  private state: State = { ...INITIAL };
  private readonly stack: State[] = [];
  /** Används någon färg med övertryck. */
  overprintUsed = false;
  constructor(readonly spaces: ColorSpaces) {}

  op(text: string): void { this.parts.push(text); }
  save(): void { this.parts.push("q"); this.stack.push({ ...this.state }); }
  restore(): void {
    const previous = this.stack.pop();
    if (!previous) return;
    this.parts.push("Q");
    this.state = previous;
  }
  get depth(): number { return this.stack.length; }

  private colorOps(ink: Ink, stroke: boolean): string {
    if (ink.kind === "CMYK") {
      const { c, m, y, k } = ink.cmyk;
      return `${num(c)} ${num(m)} ${num(y)} ${num(k)} ${stroke ? "K" : "k"}`;
    }
    const name = this.spaces.nameFor(ink);
    const tints = ink.tints.map(value => num(Math.min(1, Math.max(0, value)))).join(" ");
    return stroke ? `/${name} CS ${tints} SCN` : `/${name} cs ${tints} scn`;
  }

  private gs(overprint: boolean): void {
    const wanted = overprint ? GS_OVERPRINT : GS_KNOCKOUT;
    if (overprint) this.overprintUsed = true;
    if (this.state.gs === wanted) return;
    this.parts.push(`/${wanted} gs`);
    this.state.gs = wanted;
  }

  fill(paint: Paint): void {
    this.gs(paint.overprint);
    const ops = this.colorOps(paint.ink, false);
    if (this.state.fill !== ops) { this.parts.push(ops); this.state.fill = ops; }
  }

  stroke(paint: Paint): void {
    this.gs(paint.overprint);
    const ops = this.colorOps(paint.ink, true);
    if (this.state.stroke !== ops) { this.parts.push(ops); this.state.stroke = ops; }
  }

  lineStyle(width: number, cap: 0 | 1 | 2, join: 0 | 1 | 2, dash: readonly number[] = [], miterLimit = 10): void {
    const w = num(width), c = String(cap), j = String(join), ml = num(miterLimit);
    if (this.state.miter !== ml) { this.parts.push(`${ml} M`); this.state.miter = ml; }
    const d = dash.length > 0 ? `[${dash.map(num).join(" ")}] 0` : "[] 0";
    if (this.state.width !== w) { this.parts.push(`${w} w`); this.state.width = w; }
    if (this.state.cap !== c) { this.parts.push(`${c} J`); this.state.cap = c; }
    if (this.state.join !== j) { this.parts.push(`${j} j`); this.state.join = j; }
    if (this.state.dash !== d) { this.parts.push(`${d} d`); this.state.dash = d; }
  }

  /** Strömmen som text (ASCII; texter skrivs som hex). */
  text(): string {
    while (this.stack.length > 0) this.restore();
    return this.parts.join("\n");
  }
}
