import { lstatSync } from "node:fs";
import { dirname } from "node:path";

export const WRITER_STOP_FILE = "/var/lib/o-tid/controller/closed";

type FileState = { isDirectory(): boolean; uid: number; mode: number; dev: number; ino: number };
type AdmissionInspection = { platform?: NodeJS.Platform; lstat?: (path: string) => FileState };

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function safeRootOwnedChain(directory: string, lstat: (path: string) => FileState): boolean {
  let current = directory;
  while (true) {
    const state = lstat(current);
    if (!state.isDirectory() || state.uid !== 0 || (state.mode & 0o022) !== 0) return false;
    const parent = dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

/** Admission only; it cannot drain an accepted request or prove a backup stop. */
export function writerAdmissionClosed(profile: string | undefined, markerPath: string | undefined,
  inspection: AdmissionInspection = {}): boolean {
  if (profile === undefined) return markerPath !== undefined;
  if (profile !== "systemd-v1" || markerPath !== WRITER_STOP_FILE ||
    (inspection.platform ?? process.platform) !== "linux") return true;

  const lstat = inspection.lstat ?? lstatSync;
  const directory = dirname(WRITER_STOP_FILE);
  try {
    if (!safeRootOwnedChain(directory, lstat)) return true;
    const before = lstat(directory);
    try {
      // lstat also treats a dangling symlink as a present, closed marker.
      lstat(WRITER_STOP_FILE);
      return true;
    } catch (error) {
      if (!isMissing(error)) return true;
    }
    if (!safeRootOwnedChain(directory, lstat)) return true;
    const after = lstat(directory);
    return before.dev !== after.dev || before.ino !== after.ino;
  } catch {
    return true;
  }
}
