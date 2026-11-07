/** Steg 35: ljud vid avläsning (på som standard, sparas per webbläsare), ett ljud per besked. */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ReadoutPackage } from "@o-tid/contracts";
import type { LocalVerdict } from "./evaluate";
import { loadSoundEnabled, ReadoutSound, soundForVerdict } from "./sound";
import type { Current } from "./verdict-panel";

export function useReadoutSound() {
  const sound = useRef(new ReadoutSound());
  const [soundOn, setSoundOn] = useState(() => loadSoundEnabled());
  const [soundUnlocked, setSoundUnlocked] = useState(false);

  // Webbläsaren spelar ljud först efter ett klick på sidan; vilket klick som helst låser upp det.
  useEffect(() => {
    if (soundUnlocked) return;
    const unlock = () => { void sound.current.unlock().then(setSoundUnlocked); };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => { document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock); };
  }, [soundUnlocked]);

  return { sound, soundOn, setSoundOn, soundUnlocked, setSoundUnlocked };
}

export function useVerdictSound({ sound, soundOn, current, verdict, pkgRef }: { sound: MutableRefObject<ReadoutSound>; soundOn: boolean;
  current: Current | undefined; verdict: LocalVerdict | undefined; pkgRef: MutableRefObject<ReadoutPackage | undefined> }) {
  // Ett ljud per besked: dur när det är godkänt, moll vid felstämplat, maxtid, okänd bricka och fel i avläsningen.
  const played = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!current || current.phase === "reading") return;
    const key = current.phase === "done" ? `done:${current.localSequence}` : `failed:${current.at}`;
    if (played.current === key) return;
    played.current = key;
    const kind = soundForVerdict(current.phase === "failed" || (current.phase === "done" && current.invalid) ? "FAILED" : verdict?.status);
    // Bardisken (steg 40) spelar sina egna ljud; bara fel i avläsningen låter här.
    if (pkgRef.current?.party && current.phase !== "failed") return;
    if (soundOn && kind) sound.current.play(kind);
  }, [current, verdict, soundOn, sound, pkgRef]);
}
