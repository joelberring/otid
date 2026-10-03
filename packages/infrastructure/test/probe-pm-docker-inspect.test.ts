import { mkdtemp, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expected } from "./fixtures/pm-docker-inspect";

const { inspect } = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("../src/pm-docker-inspect", () => ({ inspectPmDockerPrestartConfiguration: inspect }));
const input = { socketPath: "/synthetic/private/api.sock", expected };
let directory: string;
const createdFiles: string[] = [];

beforeEach(async () => {
  inspect.mockReset();
  inspect.mockResolvedValue({ status: "configuration-mismatch" });
  directory = await mkdtemp(join(tmpdir(), "otid-inspect-cli-"));
});
afterEach(async () => {
  for (const path of createdFiles.splice(0).reverse()) await unlink(path);
  await rmdir(directory);
});

async function file(content: string | Buffer) {
  const path = join(directory, `input-${createdFiles.length}.json`);
  await writeFile(path, content, { flag: "wx", mode: 0o600 });
  createdFiles.push(path);
  return path;
}

async function run(args: string[], platform = "linux", uid: number | null = 1000) {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const originalUid = Object.getOwnPropertyDescriptor(process, "getuid");
  const argv = process.argv, exitCode = process.exitCode;
  const stdout: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation(chunk => { stdout.push(String(chunk)); return true; });
  try {
    Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
    Object.defineProperty(process, "getuid", { configurable: true, value: uid === null ? undefined : () => uid });
    process.argv = ["node", "synthetic-probe", ...args];
    process.exitCode = undefined;
    vi.resetModules();
    await import("./probe-pm-docker-inspect");
    return { stdout: stdout.join(""), exitCode: process.exitCode };
  } finally {
    process.argv = argv; process.exitCode = exitCode;
    Object.defineProperty(process, "platform", originalPlatform);
    if (originalUid) Object.defineProperty(process, "getuid", originalUid);
    else Reflect.deleteProperty(process, "getuid");
    write.mockRestore();
  }
}

const invalid = { stdout: '{"status":"invalid-configuration"}\n', exitCode: 2 };
describe("opt-in inspect CLI input and output; adapter mocked, no daemon access", () => {
  it.each([["darwin", 1000], ["win32", 1000], ["linux", 0], ["linux", null]] as const)(
    "rejects platform %s and uid %s before reaching the adapter", async (platform, uid) => {
      const path = await file(JSON.stringify(input));
      expect(await run([path], platform, uid)).toEqual(invalid);
      expect(inspect).not.toHaveBeenCalled();
    }
  );

  it.each([[], ["relative.json"], ["/private/tmp/a/../b"], ["/private//tmp/input"], ["/private/tmp/input\n.json"],
    ["/private/tmp/input\u0000.json"], ["/private/tmp/input.json", "extra"]].map(args => ({ args })))("rejects malformed argv %#", async ({ args }) => {
    expect(await run(args)).toEqual(invalid);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("rejects missing input, directories and final-component symlinks", async () => {
    const target = await file(JSON.stringify(input)), link = join(directory, "linked.json");
    await symlink(target, link); createdFiles.push(link);
    for (const path of [join(directory, "absent.json"), directory, link]) {
      expect(await run([path])).toEqual(invalid);
      expect(inspect).not.toHaveBeenCalled();
    }
  });

  it.each(["", "{", "null", "[]", "{}", JSON.stringify({ ...input, extra: "synthetic-secret" }),
    JSON.stringify({ expected }), JSON.stringify({ ...input, socketPath: "tcp://synthetic.invalid:2375" }),
    JSON.stringify({ ...input, expected: { ...expected, containerId: "synthetic-secret" } }),
    JSON.stringify({ ...input, expected: { ...expected, extra: "synthetic-secret" } }),
    Buffer.from([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x3a, 0x30, 0x7d]), " ".repeat(16 * 1024 + 1)])(
    "rejects malformed or oversized input %# without echoing its contents", async content => {
      expect(await run([await file(content)])).toEqual(invalid);
      expect(inspect).not.toHaveBeenCalled();
    }
  );

  it("accepts exactly 16 KiB and forwards only validated input to the adapter", async () => {
    const text = JSON.stringify(input), path = await file(text + " ".repeat(16 * 1024 - Buffer.byteLength(text)));
    expect(await run([path])).toEqual({ stdout: '{"status":"configuration-mismatch"}\n', exitCode: 1 });
    expect(inspect).toHaveBeenCalledExactlyOnceWith({ socketPath: input.socketPath }, expected);
  });

  it.each([
    [{ status: "configuration-matches", profileId: "pm-linux-docker-v1", profileHash: "c".repeat(64),
      imageId: expected.profile.imageId, containerId: expected.containerId, requiresRuntimeAcceptance: true }, 0],
    [{ status: "configuration-mismatch" }, 1], [{ status: "inspection-failed" }, 1], [{ status: "invalid-configuration" }, 2]
  ] as const)("emits only the adapter JSON with the corresponding exit code %#", async (result, exitCode) => {
    inspect.mockResolvedValue(result);
    expect(await run([await file(JSON.stringify(input))])).toEqual({ stdout: `${JSON.stringify(result)}\n`, exitCode });
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("sanitizes unexpected adapter rejection", async () => {
    inspect.mockRejectedValue(new Error("synthetic-secret /private/daemon.sock"));
    expect(await run([await file(JSON.stringify(input))])).toEqual(invalid);
  });
});
