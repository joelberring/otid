import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const dockerignore = readFileSync(path.join(repoRoot, ".dockerignore"), "utf8");
const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
const compose = readFileSync(path.join(repoRoot, "docker-compose.prod.yml"), "utf8");

function postgresServiceBlock(): string {
  const match = /^ {2}postgres:[^\n]*\n((?:(?: {4}|\s*#)[^\n]*\n|\n)*)/m.exec(compose);
  if (!match) throw new Error("Hittar inte postgres-tjänsten i docker-compose.prod.yml");
  return match[1]!;
}

describe("Docker-bygge, .dockerignore och PostgreSQL 17 NVMe-tuning", () => {
  it("utesluter tunga volymer, SSH-nycklar och icke-byggmappar ur Docker-kontexten", () => {
    const lines = dockerignore.split(/\r?\n/).map(line => line.trim());
    for (const entry of [
      "map-cache", "media", "status", "deploy/backup-ssh",
      "fixtures", "docs", "tests", "captures", "coverage",
      ".pnpm-store", ".DS_Store", "*.partial"
    ]) {
      expect(lines, `.dockerignore saknar ${entry}`).toContain(entry);
    }
    const gitLines = gitignore.split(/\r?\n/).map(line => line.trim());
    for (const entry of ["map-cache/", "media/", "status/", "deploy/backup-ssh/"]) {
      expect(gitLines, `.gitignore saknar ${entry}`).toContain(entry);
    }
  });

  it("kopierar alla workspace-package.json före pnpm install och COPY . . efteråt för lagercachning", () => {
    const installIdx = dockerfile.indexOf("pnpm install --frozen-lockfile");
    const canvasIdx = dockerfile.indexOf("@napi-rs/canvas@");
    const copyAllIdx = dockerfile.indexOf("COPY . .");
    const buildIdx = dockerfile.indexOf("pnpm --filter @o-tid/web build");
    expect(installIdx).toBeGreaterThan(0);
    expect(canvasIdx).toBeGreaterThan(installIdx);
    expect(copyAllIdx).toBeGreaterThan(canvasIdx);
    expect(buildIdx).toBeGreaterThan(copyAllIdx);

    const beforeInstall = dockerfile.slice(0, installIdx);
    expect(beforeInstall).toContain("COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./");

    for (const group of ["apps", "packages"] as const) {
      for (const name of readdirSync(path.join(repoRoot, group))) {
        const pkgPath = path.join(repoRoot, group, name, "package.json");
        if (!existsSync(pkgPath)) continue;
        expect(beforeInstall, `Dockerfile saknar ${group}/${name}/package.json före pnpm install`)
          .toContain(`COPY ${group}/${name}/package.json ${group}/${name}/`);
      }
    }
  });

  it("ställer in ACID-säker NVMe-tuning för PostgreSQL 17 med synchronous_commit=on", () => {
    const pg = postgresServiceBlock();
    for (const flag of [
      "random_page_cost=1.1",
      "effective_io_concurrency=100",
      "shared_buffers=192MB",
      "effective_cache_size=768MB",
      "work_mem=8MB",
      "maintenance_work_mem=128MB",
      "jit=off",
      "wal_compression=zstd",
      "synchronous_commit=on"
    ]) {
      expect(pg, `postgres saknar ${flag}`).toContain(flag);
    }
    expect(pg).not.toMatch(/synchronous_commit\s*=\s*off/i);
    expect(pg).not.toMatch(/fsync\s*=\s*off/i);
    expect(pg).toContain("shm_size: 256m");
  });
});
