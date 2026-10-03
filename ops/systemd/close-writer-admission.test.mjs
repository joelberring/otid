import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { closeWriterAdmissionMarker } from "./close-writer-admission.mjs";

async function privateDirectory(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "otid-writer-close-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("creates and syncs a private empty marker, then closes idempotently without replacing it", async (t) => {
  const directory = await privateDirectory(t);
  const path = join(directory, "closed");
  const uid = process.getuid();
  assert.equal(await closeWriterAdmissionMarker(path, uid), "closed");
  const first = await lstat(path);
  assert.equal(first.uid, uid);
  assert.equal(first.mode & 0o777, 0o600);
  assert.equal((await readFile(path)).byteLength, 0);
  assert.equal(await closeWriterAdmissionMarker(path, uid), "already-closed");
  const second = await lstat(path);
  assert.equal(second.ino, first.ino);
});

test("rejects unsafe parent and leaves an existing nonempty marker untouched", async (t) => {
  const directory = await privateDirectory(t);
  const path = join(directory, "closed");
  const uid = process.getuid();
  await chmod(directory, 0o777);
  await assert.rejects(closeWriterAdmissionMarker(path, uid));
  await assert.rejects(lstat(path), { code: "ENOENT" });
  await chmod(directory, 0o700);
  await writeFile(path, "existing", { mode: 0o600 });
  await assert.rejects(closeWriterAdmissionMarker(path, uid));
  assert.equal(await readFile(path, "utf8"), "existing");
});

test("rejects a marker symlink without following or replacing it", async (t) => {
  const directory = await privateDirectory(t);
  const path = join(directory, "closed");
  await symlink(join(directory, "missing"), path);
  await assert.rejects(closeWriterAdmissionMarker(path, process.getuid()));
  assert.equal((await lstat(path)).isSymbolicLink(), true);
});
