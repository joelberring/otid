import { describe, expect, it } from "vitest";
import { WRITER_STOP_FILE, writerAdmissionClosed } from "./writer-stop-admission";

const markerDirectory = "/var/lib/o-tid/controller";
const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
function directory(overrides: Partial<{ uid: number; mode: number; dev: number; ino: number; isDirectory: () => boolean }> = {}) {
  return { isDirectory: () => true, uid: 0, mode: 0o755, dev: 1, ino: 1, ...overrides };
}
function safeInspection(lstat: (path: string) => ReturnType<typeof directory> = (path) => {
  if (path === WRITER_STOP_FILE) throw missing;
  return directory();
}) {
  return { platform: "linux" as const, lstat };
}

describe("TASK195 pinned HTTP admission", () => {
  it("preserves only a fully unmanaged installation", () => {
    expect(writerAdmissionClosed(undefined, undefined)).toBe(false);
    expect(writerAdmissionClosed(undefined, WRITER_STOP_FILE)).toBe(true);
    expect(writerAdmissionClosed("unknown", WRITER_STOP_FILE, safeInspection())).toBe(true);
    expect(writerAdmissionClosed("systemd-v1", undefined, safeInspection())).toBe(true);
  });

  it("rejects a different path, aliases and a non-Linux runtime", () => {
    const inspection = safeInspection();
    for (const path of ["relative/closed", "/private/test/closed", "/var/lib/o-tid/controller/../controller/closed"]) {
      expect(writerAdmissionClosed("systemd-v1", path, inspection)).toBe(true);
    }
    expect(writerAdmissionClosed("systemd-v1", WRITER_STOP_FILE, { ...inspection, platform: "darwin" })).toBe(true);
  });

  it("opens only when the exact marker is absent under a stable root-owned chain", () => {
    const paths: string[] = [];
    const inspection = safeInspection((path) => {
      paths.push(path);
      if (path === WRITER_STOP_FILE) throw missing;
      return directory();
    });
    expect(writerAdmissionClosed("systemd-v1", WRITER_STOP_FILE, inspection)).toBe(false);
    for (const ancestor of [markerDirectory, "/var/lib/o-tid", "/var/lib", "/var", "/"]) {
      expect(paths.filter((path) => path === ancestor).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("closes on any existing marker or uncertain marker read", () => {
    const present = safeInspection((path) => path === WRITER_STOP_FILE
      ? directory({ isDirectory: () => false }) : directory());
    expect(writerAdmissionClosed("systemd-v1", WRITER_STOP_FILE, present)).toBe(true);
    const unreadable = safeInspection((path) => {
      if (path === WRITER_STOP_FILE) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return directory();
    });
    expect(writerAdmissionClosed("systemd-v1", WRITER_STOP_FILE, unreadable)).toBe(true);
  });

  it("closes for unsafe ancestors and a replaced marker directory", () => {
    for (const unsafe of [directory({ uid: 501 }), directory({ mode: 0o777 }),
      directory({ isDirectory: () => false })]) {
      const inspection = safeInspection((path) => {
        if (path === WRITER_STOP_FILE) throw missing;
        return path === "/var/lib/o-tid" ? unsafe : directory();
      });
      expect(writerAdmissionClosed("systemd-v1", WRITER_STOP_FILE, inspection)).toBe(true);
    }
    let parentReads = 0;
    const replaced = safeInspection((path) => {
      if (path === WRITER_STOP_FILE) throw missing;
      if (path === markerDirectory) return directory({ ino: ++parentReads === 4 ? 2 : 1 });
      return directory();
    });
    expect(writerAdmissionClosed("systemd-v1", WRITER_STOP_FILE, replaced)).toBe(true);
  });
});
