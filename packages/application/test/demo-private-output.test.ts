import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, chmod, stat, realpath, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DemoPrivateOutputError, reserveDemoPrivateOutput } from "../src/demo-private-output";

const ownedRoots: string[] = [];

async function privateDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "otid-demo-private-output-"));
  ownedRoots.push(root);
  await chmod(root, 0o700);
  return realpath(root);
}

afterEach(async () => {
  await Promise.all(ownedRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function expectGeneric(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toEqual(expect.objectContaining({
    name: "DemoPrivateOutputError", message: "DEMO_PRIVATE_OUTPUT_INVALID"
  } satisfies Partial<DemoPrivateOutputError>));
}

describe("private synthetic-demo output", () => {
  it("creates a new 0600 file outside the repository and writes valid JSON once", async () => {
    const root = await privateDirectory();
    const output = join(root, "credentials.json");
    const writer = await reserveDemoPrivateOutput(output, process.cwd());

    expect((await stat(output)).mode & 0o777).toBe(0o600);
    await writer.write({ token: "test-only", scopes: ["VIEW_RACE_OVERVIEW"] });
    await expectGeneric(() => writer.write({ another: "value" }));
    await writer.close();
    await writer.close();
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual({ token: "test-only", scopes: ["VIEW_RACE_OVERVIEW"] });
  });

  it("rejects unsafe targets without altering the existing target", async () => {
    const root = await privateDirectory();
    const existing = join(root, "existing.json");
    await writeFile(existing, "keep", { mode: 0o600 });
    const symlinkedParent = join(root, "linked");
    await symlink(root, symlinkedParent);
    const symlinkedTarget = join(root, "linked-target.json");
    await symlink(existing, symlinkedTarget);
    const permissive = join(root, "permissive");
    await mkdir(permissive, { mode: 0o755 });
    await chmod(permissive, 0o755);

    await expectGeneric(() => reserveDemoPrivateOutput(existing, process.cwd()));
    await expectGeneric(() => reserveDemoPrivateOutput(symlinkedTarget, process.cwd()));
    await expectGeneric(() => reserveDemoPrivateOutput(join(symlinkedParent, "new.json"), process.cwd()));
    await expectGeneric(() => reserveDemoPrivateOutput(join(permissive, "new.json"), process.cwd()));
    await expectGeneric(() => reserveDemoPrivateOutput("relative.json", process.cwd()));
    await expectGeneric(() => reserveDemoPrivateOutput(`${root}/../credentials.json`, process.cwd()));
    await expectGeneric(() => reserveDemoPrivateOutput("/private/tmp/otid-must-not-create-private-output.json", process.cwd()));
    await expectGeneric(() => reserveDemoPrivateOutput(join(process.cwd(), "private.json"), process.cwd()));
    expect(await readFile(existing, "utf8")).toBe("keep");
  });

  it("keeps write and close failures generic and never retries a failed write", async () => {
    const root = await privateDirectory();
    const output = join(root, "credentials.json");
    const writer = await reserveDemoPrivateOutput(output, process.cwd());
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expectGeneric(() => writer.write(circular));
    await expectGeneric(() => writer.write({ valid: false }));
    await writer.close();
    await expectGeneric(() => writer.write({ after: "close" }));
  });

  it("rejects changed permissions or hardlinked output before writing private material", async () => {
    const root = await privateDirectory();
    for (const kind of ["permissions", "hardlink"] as const) {
      const output = join(root, `${kind}.json`), writer = await reserveDemoPrivateOutput(output, process.cwd());
      if (kind === "permissions") await chmod(output, 0o644);
      else await link(output, join(root, "second-link.json"));
      await expectGeneric(() => writer.write({ token: "must-not-be-written" }));
      await writer.close(); expect(await readFile(output, "utf8")).toBe("");
    }
  });
});
