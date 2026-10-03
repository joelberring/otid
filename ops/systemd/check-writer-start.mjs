import { lstatSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const WRITER_STOP_FILE = "/var/lib/o-tid/controller/closed";

function safeRootOwnedChain(directory, lstat) {
  let current = directory;
  while (true) {
    const state = lstat(current);
    if (!state.isDirectory() || state.uid !== 0 || (state.mode & 0o022) !== 0) return false;
    const parent = dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

/** Start admission only. A controller must still drain work accepted before closure. */
export function writerStartOpen({ platform, profile, markerPath, lstat = lstatSync }) {
  if (platform !== "linux" || profile !== "systemd-v1" || markerPath !== WRITER_STOP_FILE || !isAbsolute(markerPath)) return false;
  const directory = dirname(markerPath);
  try {
    if (!safeRootOwnedChain(directory, lstat)) return false;
    const before = lstat(directory);
    try {
      // A file, directory or dangling symlink at the marker path all mean closed.
      lstat(markerPath);
      return false;
    } catch (error) {
      if (error?.code !== "ENOENT") return false;
    }
    if (!safeRootOwnedChain(directory, lstat)) return false;
    const after = lstat(directory);
    return before.dev === after.dev && before.ino === after.ino;
  } catch {
    return false;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!writerStartOpen({
    platform: process.platform,
    profile: process.env.OTID_WRITER_STOP_PROFILE,
    markerPath: process.env.OTID_WRITER_STOP_FILE
  })) {
    process.stderr.write("OTID_WRITER_START_CLOSED\n");
    process.exitCode = 78;
  }
}
