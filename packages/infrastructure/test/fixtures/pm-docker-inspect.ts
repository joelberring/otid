import { createHash } from "node:crypto";
import { canonicalJsonBytes } from "@o-tid/contracts";

// Entirely synthetic API 1.53-shaped metadata. These are not captured runtime
// observations or approved release pins, and cannot establish Linux isolation.
export const profile = { attemptId: "12345678-1234-4234-8234-123456789abc",
  imageId: `sha256:${"a".repeat(64)}`, platform: "linux/amd64", stagingRoot: "/srv/otid-synthetic" };
export const containerId = "b".repeat(64);
export const maskedPaths = ["/proc/kcore", "/proc/keys", "/sys/firmware"];
export const readonlyPaths = ["/proc/sys", "/proc/sysrq-trigger", "/proc/irq", "/proc/bus", "/proc/fs"];
export const pathHash = (paths: string[]) => createHash("sha256").update(canonicalJsonBytes([...paths].sort())).digest("hex");
export const expected = { profile, containerId, maskedPathsHash: pathHash(maskedPaths), readonlyPathsHash: pathHash(readonlyPaths) };
export const env = ["PATH=/usr/bin:/bin", "LC_ALL=C", "TZ=UTC", "TMPDIR=/tmp"];
export const tmpfs = "rw,nosuid,nodev,noexec,size=268435456,mode=0700,uid=10001,gid=10001";

export function fixture() {
  const config = { User: "10001:10001", Env: [...env], Entrypoint: ["/opt/otid/bin/pm-scan"],
    Cmd: ["/input/input.pdf", "/signatures"], WorkingDir: "/tmp", Volumes: {}, ExposedPorts: {},
    Healthcheck: { Test: ["NONE"] }, OnBuild: [], Shell: [], ArgsEscaped: false, Labels: {}, StopSignal: "SIGTERM" };
  return {
    image: { Id: profile.imageId, Os: "linux", Architecture: "amd64", Variant: "", Config: structuredClone(config),
      RepoDigests: [`synthetic.invalid/scanner@sha256:${"c".repeat(64)}`] },
    container: { Id: containerId, Name: `/otid-pm-scan-${profile.attemptId}`, Image: profile.imageId, Platform: "linux",
      Path: "/opt/otid/bin/pm-scan", Args: ["/input/input.pdf", "/signatures"],
      Config: { ...config, Image: profile.imageId, Hostname: containerId.slice(0, 12), Domainname: "",
        AttachStdin: false, AttachStdout: true, AttachStderr: true, OpenStdin: false, StdinOnce: false, Tty: false,
        StopTimeout: 5, Labels: { "io.otid.pm.scan-attempt": profile.attemptId, "io.otid.pm.scan-profile": "pm-linux-docker-v1" } },
      HostConfig: { Privileged: false, ReadonlyRootfs: true, AutoRemove: false, PublishAllPorts: false,
        NetworkMode: "none", IpcMode: "none", CgroupnsMode: "private", CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"],
        Memory: 2147483648, MemorySwap: 2147483648, NanoCpus: 1000000000, PidsLimit: 64,
        Ulimits: [{ Name: "core", Soft: 0, Hard: 0 }, { Name: "nofile", Soft: 256, Hard: 256 }], Init: false,
        Runtime: "runc", OomKillDisable: false, Mounts: ["input", "signatures"].map(name => ({ Type: "bind",
          Source: `${profile.stagingRoot}/${profile.attemptId}/${name}`, Target: `/${name}`, ReadOnly: true,
          BindOptions: { Propagation: "rprivate", NonRecursive: true } })),
        Tmpfs: { "/tmp": tmpfs }, RestartPolicy: { Name: "no", MaximumRetryCount: 0 }, LogConfig: { Type: "none", Config: {} },
        MaskedPaths: [...maskedPaths], ReadonlyPaths: [...readonlyPaths] },
      Mounts: ["input", "signatures"].map(name => ({ Type: "bind", Source: `${profile.stagingRoot}/${profile.attemptId}/${name}`,
        Destination: `/${name}`, RW: false, Propagation: "rprivate", Mode: "ro" })),
      State: { Status: "created", Running: false, Paused: false, Restarting: false, Dead: false, OOMKilled: false,
        Pid: 0, ExitCode: 0, Error: "", StartedAt: "0001-01-01T00:00:00Z", FinishedAt: "0001-01-01T00:00:00Z" },
      RestartCount: 0, ExecIDs: [], LogPath: "", AppArmorProfile: "docker-default",
      NetworkSettings: { Ports: {}, Networks: { none: { NetworkID: "d".repeat(64) } } }
    }
  };
}
