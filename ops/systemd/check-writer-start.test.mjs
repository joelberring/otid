import assert from "node:assert/strict";
import test from "node:test";
import { WRITER_STOP_FILE, writerStartOpen } from "./check-writer-start.mjs";

const safeDirectory = { isDirectory: () => true, uid: 0, mode: 0o40755, dev: 1, ino: 1 };
const missing = () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; };
const input = { platform: "linux", profile: "systemd-v1", markerPath: WRITER_STOP_FILE };

test("opens only when root-owned directory chain is safe and marker is absent", () => {
  assert.equal(writerStartOpen({ ...input, lstat: (path) => path === WRITER_STOP_FILE ? missing() : safeDirectory }), true);
});

test("rejects a present marker and missing or invalid profile", () => {
  const lstat = () => safeDirectory;
  assert.equal(writerStartOpen({ ...input, lstat }), false);
  assert.equal(writerStartOpen({ ...input, profile: undefined, lstat }), false);
  assert.equal(writerStartOpen({ ...input, markerPath: "/var/lib/o-tid/other/closed", lstat }), false);
  assert.equal(writerStartOpen({ ...input, platform: "darwin", lstat }), false);
});

test("rejects unsafe ancestor, symlink-like directory and changing marker parent", () => {
  const absentMarker = (path) => path === WRITER_STOP_FILE ? missing() : safeDirectory;
  assert.equal(writerStartOpen({ ...input, lstat: (path) => path === "/var/lib" ?
    { ...safeDirectory, mode: 0o40777 } : absentMarker(path) }), false);
  assert.equal(writerStartOpen({ ...input, lstat: (path) => path === "/var/lib/o-tid" ?
    { ...safeDirectory, isDirectory: () => false } : absentMarker(path) }), false);
  assert.equal(writerStartOpen({ ...input, lstat: () => { throw new Error("unreadable"); } }), false);
  let parentReads = 0;
  assert.equal(writerStartOpen({ ...input, lstat: (path) => {
    if (path === WRITER_STOP_FILE) return missing();
    if (path === "/var/lib/o-tid/controller" && ++parentReads >= 3) return { ...safeDirectory, ino: 2 };
    return safeDirectory;
  } }), false);
});
