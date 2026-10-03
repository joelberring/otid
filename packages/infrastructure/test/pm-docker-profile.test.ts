import { describe, expect, it } from "vitest";
import { buildPmDockerCreatePlan } from "../src/pm-docker-profile";

const attemptId = "12345678-1234-4234-8234-123456789abc";
const imageId = `sha256:${"a".repeat(64)}`;
const input = { attemptId, imageId, platform: "linux/amd64", stagingRoot: "/private/tmp/otid-pm-staging" };

function values(args: string[], flag: string): string[] {
  return args.flatMap((value, index) => value === flag ? [args[index + 1]!] :
    value.startsWith(`${flag}=`) ? [value.slice(flag.length + 1)] : []);
}

describe("ADR0062 deterministic Docker create policy; not isolation acceptance", () => {
  it("builds the fixed policy, opaque identity and exact entrypoint without runtime I/O", () => {
    const plan = buildPmDockerCreatePlan(input);
    expect(plan.profileId).toBe("pm-linux-docker-v1");
    expect(plan.profileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.containerName).toBe(`otid-pm-scan-${attemptId}`);
    expect(plan.args.slice(0, 2)).toEqual(["container", "create"]);
    const fixed: Record<string, string> = {
      "--name": plan.containerName, "--platform": "linux/amd64", "--user": "10001:10001",
      "--network": "none", "--ipc": "none", "--cgroupns": "private", "--cap-drop": "ALL",
      "--memory": "2147483648", "--memory-swap": "2147483648", "--cpus": "1", "--pids-limit": "64",
      "--restart": "no", "--log-driver": "none", "--pull": "never", "--entrypoint": "/opt/otid/bin/pm-scan",
      "--init": "false", "--runtime": "runc", "--stop-signal": "SIGTERM", "--stop-timeout": "5"
    };
    for (const [flag, value] of Object.entries(fixed)) expect(values(plan.args, flag), flag).toEqual([value]);
    expect(values(plan.args, "--security-opt")).toEqual(["no-new-privileges=true"]);
    expect(values(plan.args, "--ulimit")).toEqual(expect.arrayContaining(["nofile=256:256", "core=0:0"]));
    expect(values(plan.args, "--ulimit")).toHaveLength(2);
    expect(plan.args).toContain("--read-only");
    expect(plan.args).toContain("--no-healthcheck");
    expect(plan.args.slice(-3)).toEqual([imageId, "/input/input.pdf", "/signatures"]);
    expect(values(plan.args, "--env")).toEqual(["PATH=/usr/bin:/bin", "LC_ALL=C", "TZ=UTC", "TMPDIR=/tmp"]);
    for (const flag of ["--privileged", "--rm", "--device", "--env-file", "--volumes-from", "--pid", "--cap-add"]) {
      expect(plan.args.some(value => value === flag || value.startsWith(`${flag}=`)), flag).toBe(false);
    }
  });

  it("derives only two readonly nonrecursive private mounts and bounded scratch space", () => {
    const plan = buildPmDockerCreatePlan(input);
    const mounts = values(plan.args, "--mount");
    expect(mounts).toHaveLength(2);
    for (const [index, suffix] of ["input", "signatures"].entries()) {
      const fields = mounts[index]!.split(",");
      expect(fields).toEqual(expect.arrayContaining(["type=bind", `source=${input.stagingRoot}/${attemptId}/${suffix}`,
        `target=/${suffix}`, "readonly", "bind-recursive=disabled", "bind-propagation=rprivate"]));
      expect(fields).toHaveLength(6);
    }
    const scratch = values(plan.args, "--tmpfs");
    expect(scratch).toHaveLength(1);
    expect(scratch[0]!.startsWith("/tmp:")).toBe(true);
    expect(scratch[0]!.slice(5).split(",")).toEqual(expect.arrayContaining([
      "rw", "nosuid", "nodev", "noexec", "size=268435456", "mode=0700", "uid=10001", "gid=10001"
    ]));
  });

  it("hashes the fixed policy rather than attempt, image, root or architecture", () => {
    const first = buildPmDockerCreatePlan(input);
    const alternatives = [
      { ...input, attemptId: "87654321-4321-4321-8321-cba987654321" },
      { ...input, imageId: `sha256:${"b".repeat(64)}` },
      { ...input, stagingRoot: "/srv/otid_scanner-2" },
      { ...input, platform: "linux/arm64" }
    ];
    for (const candidate of alternatives) {
      const other = buildPmDockerCreatePlan(candidate);
      expect(other.profileHash).toBe(first.profileHash);
      expect(other.args).not.toEqual(first.args);
    }
    expect(buildPmDockerCreatePlan(input)).toEqual(first);
  });

  it("returns independent arrays and never mutates caller input", () => {
    const original = { ...input }, first = buildPmDockerCreatePlan(input), second = buildPmDockerCreatePlan(input);
    first.args.push("--privileged"); first.args[0] = "run";
    expect(second.args).not.toContain("--privileged");
    expect(second.args.slice(0, 2)).toEqual(["container", "create"]);
    expect(buildPmDockerCreatePlan(input)).toEqual(second);
    expect(input).toEqual(original);
  });

  it.each([
    null, [], {}, { ...input, bypass: true }, { ...input, args: ["--privileged"] },
    { ...input, env: { SECRET: "synthetic" } }, { ...input, imageId: "scanner:latest" },
    { ...input, imageId: `sha256:${"A".repeat(64)}` }, { ...input, imageId: `sha256:${"a".repeat(63)}` },
    { ...input, imageId: `${imageId} --privileged` }, { ...input, platform: "darwin/arm64" },
    { ...input, platform: "linux/amd64 --privileged" }, { ...input, attemptId: attemptId.toUpperCase() },
    { ...input, attemptId: "../outside" }, { ...input, attemptId: "00000000-0000-0000-0000-000000000000" }
  ])("rejects invalid or expanded runtime configuration %#", candidate => {
    expect(() => buildPmDockerCreatePlan(candidate)).toThrow();
  });

  it.each([
    "/", "/tmp", "/var/tmp", "/private/tmp", "/var/lib", "/home", "/opt", "/srv", "/etc",
    "relative/path", "/single", "/private//staging", "/private/staging/", "/private/./staging",
    "/private/../staging", "/private/.hidden", "/private/-flag", "/private/_hidden",
    "/private/staging space", "/private/staging,readonly", "/private/staging:other", "/private/staging;echo",
    "/private/$(id)", "/private/`id`", "/private/staging\nnext", "/private/staging\u0000",
    "/private/stäging", "/private/staging\\other", "/private/staging/*", `/private/${"a".repeat(232)}`
  ])("rejects dangerous or ambiguous staging root %j", stagingRoot => {
    expect(() => buildPmDockerCreatePlan({ ...input, stagingRoot })).toThrow();
  });
});
