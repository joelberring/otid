/**
 * Steg 35: ett kort glatt ljud (tre toner i dur, uppåt) när avläsningen är godkänd och ett lika kort moll-ljud (tre
 * toner i moll, nedåt) vid felstämplat, maxtid, okänd bricka eller fel i avläsningen. Tonerna görs med Web Audio
 * (OscillatorNode), utan ljudfil. Webbläsaren spelar inget förrän användaren har klickat på sidan, så ljudet låses upp
 * vid första klicket (anslutknappen räcker). Valet "Ljud vid avläsning" sparas per webbläsare.
 */
/** "neutral" (steg 40, bardisken): två lika toner när inget nytt hänt, t.ex. "Inga nya köp". */
export type ReadoutSoundKind = "ok" | "fail" | "neutral";

export interface Tone { readonly frequency: number; readonly start: number; readonly duration: number }

const NOTE = 0.1;
/** C-dur uppåt (C5, E5, G5) och a-moll nedåt (E5, C5, A4): 3 × 0,1 s. */
const TONES: Record<ReadoutSoundKind, readonly number[]> = {
  ok: [523.25, 659.25, 783.99],
  fail: [659.25, 523.25, 440],
  neutral: [587.33, 587.33]
};

export function soundTones(kind: ReadoutSoundKind): Tone[] {
  return TONES[kind].map((frequency, index) => ({ frequency, start: index * NOTE, duration: NOTE }));
}

/** Ljudet för ett besked: godkänt låter glatt; felstämplat, maxtid, okänd bricka och fel låter moll. Annars inget. */
export function soundForVerdict(status: string | undefined): ReadoutSoundKind | undefined {
  if (status === "OK") return "ok";
  if (status === "MP" || status === "OVERTIME" || status === "UNKNOWN_CARD" || status === "FAILED") return "fail";
  return undefined;
}

const KEY = "otid.readout.sound.v1";
type SoundStorage = Pick<Storage, "getItem" | "setItem">;

export function loadSoundEnabled(storage?: SoundStorage): boolean {
  try { return (storage ?? window.localStorage).getItem(KEY) !== "off"; }
  catch (error) { console.warn("Ljudvalet kunde inte läsas; ljudet är på", error); return true; }
}

export function saveSoundEnabled(enabled: boolean, storage?: SoundStorage): void {
  try { (storage ?? window.localStorage).setItem(KEY, enabled ? "on" : "off"); }
  catch (error) { console.warn("Ljudvalet kunde inte sparas i webbläsaren", error); }
}

type AudioContextConstructor = new () => AudioContext;

/** Ett AudioContext för sidan, skapat eller återupptaget vid användarens klick. */
export class ReadoutSound {
  #context: AudioContext | undefined;

  /** Sant när webbläsaren låter sidan spela (efter ett klick). */
  get unlocked(): boolean { return this.#context?.state === "running"; }

  /** Anropas vid ett klick: skapar ljudet eller återupptar det. Ger sant om ljudet kan spelas. */
  async unlock(): Promise<boolean> {
    const Context = typeof window === "undefined" ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext);
    if (!Context) return false;
    try {
      this.#context ??= new Context();
      if (this.#context.state === "suspended") await this.#context.resume();
      return this.#context.state === "running";
    } catch (error) {
      console.warn("Ljudet kunde inte startas", error);
      return false;
    }
  }

  play(kind: ReadoutSoundKind): void {
    const context = this.#context;
    if (!context || context.state !== "running") return;
    const now = context.currentTime + 0.01;
    for (const tone of soundTones(kind)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = tone.frequency;
      // Kort in- och urtoning så att det inte knäpper.
      const start = now + tone.start, end = start + tone.duration;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
      gain.gain.setValueAtTime(0.25, end - 0.02);
      gain.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end);
    }
  }
}
