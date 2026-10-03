import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OperationalBackupTargetBindingFileError,
  readOperationalBackupTargetBinding,
  writeOperationalBackupTargetBinding
} from "../src/operational-backup-target-binding";

const roots: string[] = [];
const backupId = "a0000000-0000-4000-8000-000000000001";
const targetId = "b0000000-0000-4000-8000-000000000002";
const storeId = "c0000000-0000-4000-8000-000000000003";
const manifestSha256 = createHash("sha256").update("manifest").digest("hex");

async function privateRoot(): Promise<string> {
  const root = await mkdtemp("/private/tmp/otid-target-binding-");
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function validBinding(root: string, overrides: Record<string, unknown> = {}) {
  const selectedBackupId = typeof overrides.backupId === "string" ? overrides.backupId : backupId;
  const selectedTargetId = typeof overrides.targetId === "string" ? overrides.targetId : targetId;
  const dataAreaPath = join(root, `${selectedBackupId}.${selectedTargetId}.data`);
  await mkdir(dataAreaPath, { mode: 0o700 });
  const dataArea = await stat(dataAreaPath);
  return {
    formatVersion: 2,
    backupId: selectedBackupId,
    manifestSha256,
    targetId: selectedTargetId,
    targetEndpoint: "http://127.0.0.1:9400",
    targetMode: "loopback-development",
    dataAreaPath,
    dataAreaIdentity: { dev: dataArea.dev, ino: dataArea.ino },
    credentialFileIdentity: { dev: dataArea.dev, ino: dataArea.ino },
    credentialFileSha256: createHash("sha256").update("synthetic-private-credential-bytes").digest("hex"),
    credentialRef: "file:/private/otid-backup/credentials/target-a",
    stores: [{ storeId, sourceEndpoint: "https://source.example.test", sourceBucket: "otid-pm", targetBucket: "otid-pm" }],
    ...overrides
  };
}

async function expectGeneric(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toEqual(expect.objectContaining({
    name: "OperationalBackupTargetBindingFileError",
    message: "OPERATIONAL_BACKUP_TARGET_BINDING_INVALID"
  } satisfies Partial<OperationalBackupTargetBindingFileError>));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("private operational backup target binding", () => {
  it("writes once atomically and reloads the exact binding after a new adapter is created", async () => {
    const directory = await privateRoot();
    const binding = await validBinding(directory);
    const persisted = await writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding });
    expect(persisted.formatVersion).toBe(2);
    const file = join(directory, `${backupId}.target.json`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const raw = await readFile(file, "utf8");
    expect(raw).toContain("credentialRef");
    expect(raw).not.toMatch(/synthetic-secret|accessKey|secretKey|credential\s*:/i);
    expect(persisted.stores.map(store => store.storeId)).toEqual([storeId]);

    const reloaded = await readOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), backupId });
    expect(reloaded).toEqual(persisted);
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding }));
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding: { ...binding, formatVersion: 1 } }));
    await expectGeneric(() => readOperationalBackupTargetBinding({
      directory,
      repositoryRoot: process.cwd(),
      backupId,
      expected: { ...binding, manifestSha256: "d".repeat(64) }
    }));
  });

  it("rejects reused target ids, credential material, endpoint credentials and bucket mismatches", async () => {
    const directory = await privateRoot();
    const first = await validBinding(directory);
    await writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding: first });
    const secondBackup = "d0000000-0000-4000-8000-000000000004";
    const secondTarget = "e0000000-0000-4000-8000-000000000005";
    const second = await validBinding(directory, {
      backupId: secondBackup,
      targetId: secondTarget,
    });
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding: { ...second, targetId } }));
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding: { ...second, credential: "must-not-persist" } }));
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding: { ...second, targetEndpoint: "https://user:secret@target.example.test" } }));
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding: {
      ...second,
      stores: [{ ...second.stores[0], targetBucket: "different-bucket" }]
    } }));
  });

  it("rejects symlinked or hardlinked binding files and replaced data-area identity", async () => {
    const directory = await privateRoot();
    const binding = await validBinding(directory);
    await writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding });
    const file = join(directory, `${backupId}.target.json`);
    const linked = join(directory, "hardlink.target.json");
    await link(file, linked);
    await expectGeneric(() => readOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), backupId }));
    await rm(linked);
    const areaPath = binding.dataAreaPath;
    await rm(areaPath, { recursive: true });
    await mkdir(areaPath, { mode: 0o700 });
    await expectGeneric(() => readOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), backupId }));

    const otherId = "f0000000-0000-4000-8000-000000000006";
    await symlink(file, join(directory, `${otherId}.target.json`));
    await expectGeneric(() => readOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), backupId: otherId }));
  });

  it("rejects unsafe private paths and noncanonical data-area paths before creating a binding", async () => {
    const directory = await privateRoot();
    const binding = await validBinding(directory);
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding: { ...binding, dataAreaPath: "/tmp/elsewhere" } }));
    await chmod(directory, 0o755);
    await expectGeneric(() => writeOperationalBackupTargetBinding({ directory, repositoryRoot: process.cwd(), binding }));
  });
});
