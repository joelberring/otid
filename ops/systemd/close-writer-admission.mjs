import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { WRITER_STOP_FILE } from "./check-writer-start.mjs";

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

async function validateOwnedChain(directory, ownerUid) {
  let current = directory;
  while (true) {
    const state = await lstat(current);
    if (!state.isDirectory() || (state.uid !== 0 && state.uid !== ownerUid) || (state.mode & 0o022) !== 0) {
      throw new Error("WRITER_MARKER_DIRECTORY_UNSAFE");
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Only closes admission. The caller must separately drain and prove all writers stopped. */
export async function closeWriterAdmissionMarker(markerPath, ownerUid) {
  if (!isAbsolute(markerPath) || resolve(markerPath) !== markerPath || basename(markerPath) !== "closed" ||
    !Number.isSafeInteger(ownerUid) || ownerUid < 0) {
    throw new Error("WRITER_MARKER_TARGET_INVALID");
  }
  const directory = dirname(markerPath);
  await validateOwnedChain(directory, ownerUid);
  const before = await lstat(directory);
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let marker;
  try {
    const openedParent = await parent.stat();
    if (!sameFile(before, openedParent) || openedParent.uid !== ownerUid ||
      !openedParent.isDirectory() || (openedParent.mode & 0o022) !== 0) {
      throw new Error("WRITER_MARKER_DIRECTORY_UNSAFE");
    }
    let created = false;
    try {
      marker = await open(markerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      await marker.chmod(0o600);
    } catch (error) {
      if (created || error?.code !== "EEXIST") throw error;
      marker = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    const markerState = await marker.stat();
    const namedMarker = await lstat(markerPath);
    if (!markerState.isFile() || markerState.uid !== ownerUid || markerState.nlink !== 1 || markerState.size !== 0 ||
      (markerState.mode & 0o777) !== 0o600 || !sameFile(markerState, namedMarker)) {
      throw new Error("WRITER_MARKER_UNSAFE");
    }
    await marker.sync();
    await parent.sync();
    await validateOwnedChain(directory, ownerUid);
    const after = await lstat(directory);
    if (!sameFile(before, after) || !sameFile(markerState, await lstat(markerPath))) {
      throw new Error("WRITER_MARKER_CHANGED");
    }
    return created ? "closed" : "already-closed";
  } finally {
    if (marker) await marker.close();
    await parent.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.argv.length !== 2) {
    process.stderr.write("WRITER_ADMISSION_CLOSE_REQUIRES_LINUX_ROOT; NOT_DRAINED\n");
    process.exitCode = 1;
  } else {
    closeWriterAdmissionMarker(WRITER_STOP_FILE, 0).then(() => {
      process.stdout.write("WRITER_ADMISSION_CLOSED_ONLY; NOT_DRAINED\n");
    }).catch(() => {
      process.stderr.write("WRITER_ADMISSION_CLOSE_FAILED; NOT_DRAINED\n");
      process.exitCode = 1;
    });
  }
}
