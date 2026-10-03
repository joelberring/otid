import { describe, expect, it } from "vitest";
import { checkPmDockerPrestartConfiguration } from "../src/pm-docker-prestart";

import { profile, containerId, maskedPaths, readonlyPaths, pathHash, expected, env, tmpfs, fixture } from "./fixtures/pm-docker-inspect";

function change(target: unknown, path: string, value: unknown) {
  const parts = path.split(".");
  let object = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) object = object[part] as Record<string, unknown>;
  if (value === undefined) delete object[parts.at(-1)!];
  else object[parts.at(-1)!] = value;
}

describe("synthetic Docker prestart configuration; never runtime acceptance", () => {
  it("matches independently specified metadata and returns only bound identifiers", () => {
    const observations = fixture(), before = structuredClone(observations);
    const result = checkPmDockerPrestartConfiguration(expected, observations);
    expect(result.profileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toEqual({ status: "configuration-matches",
      profileId: "pm-linux-docker-v1", profileHash: result.profileHash,
      imageId: profile.imageId, containerId, requiresRuntimeAcceptance: true });
    expect(observations).toEqual(before);
  });

  it("accepts harmless order variation, optional neutral metadata and arm64 v8", () => {
    const observations = fixture();
    observations.image.Architecture = "arm64"; observations.image.Variant = "v8";
    observations.image.Config.Env = ["TZ=UTC"];
    observations.container.Config.Env.reverse(); observations.container.HostConfig.Mounts.reverse();
    observations.container.Mounts.reverse(); observations.container.HostConfig.Ulimits.reverse();
    observations.container.HostConfig.MaskedPaths.reverse(); observations.container.HostConfig.ReadonlyPaths.reverse();
    observations.container.HostConfig.Tmpfs["/tmp"] = tmpfs.split(",").reverse().join(",");
    observations.container.HostConfig.SecurityOpt = ["no-new-privileges"];
    observations.container.Name = observations.container.Name.slice(1);
    for (const [key, value] of Object.entries({ Binds: null, CapAdd: [], UsernsMode: "", CpuQuota: 0, Sysctls: null })) {
      change(observations, `container.HostConfig.${key}`, value);
    }
    expect(checkPmDockerPrestartConfiguration({ ...expected, profile: { ...profile, platform: "linux/arm64" } }, observations).status)
      .toBe("configuration-matches");
  });

  const mutations: [string, unknown][] = [
    ["image.Id", `sha256:${"e".repeat(64)}`], ["image.Os", "windows"], ["image.Architecture", "arm64"], ["image.Variant", "v8"],
    ["container.Id", "e".repeat(64)], ["container.Name", "/unrelated"], ["container.Image", "scanner:latest"],
    ["container.Config.Image", "scanner:latest"], ["container.Platform", "linux/amd64"], ["container.Config.Hostname", "wrong"],
    ["container.Path", "/bin/sh"], ["container.Args", ["-c", "echo synthetic"]],
    ["container.Config.Labels", {}], ["image.Config.Labels", { "io.otid.pm.scan-attempt": profile.attemptId }],
    ["container.Config.StopTimeout", 0], ["container.Config.AttachStdin", true], ["container.Config.OpenStdin", true],
    ["container.Config.StdinOnce", true], ["container.Config.Tty", true], ["container.Config.Domainname", "host.invalid"],
    ["container.HostConfig.Privileged", true], ["container.HostConfig.ReadonlyRootfs", false], ["container.HostConfig.AutoRemove", true],
    ["container.HostConfig.PublishAllPorts", true], ["container.HostConfig.NetworkMode", "host"], ["container.HostConfig.IpcMode", "private"],
    ["container.HostConfig.CgroupnsMode", "host"], ["container.HostConfig.CapDrop", []], ["container.HostConfig.CapDrop", ["ALL", "ALL"]],
    ["container.HostConfig.SecurityOpt", []], ["container.HostConfig.SecurityOpt", ["no-new-privileges=false"]],
    ["container.HostConfig.SecurityOpt", ["no-new-privileges", "seccomp=unconfined"]], ["container.HostConfig.Init", true],
    ["container.HostConfig.Runtime", "custom"], ["container.HostConfig.OomKillDisable", true], ["container.HostConfig.MemorySwappiness", 100],
    ["container.HostConfig.Memory", 0], ["container.HostConfig.MemorySwap", -1], ["container.HostConfig.MemorySwap", 4294967296],
    ["container.HostConfig.NanoCpus", 0], ["container.HostConfig.PidsLimit", null], ["container.HostConfig.PidsLimit", -1],
    ["container.HostConfig.PidsLimit", 0], ["container.HostConfig.ShmSize", 268435456],
    ["container.HostConfig.Ulimits", [{ Name: "core", Soft: 0, Hard: 0 }, { Name: "core", Soft: 0, Hard: 0 }]],
    ["container.HostConfig.Ulimits.1.Hard", 65535], ["container.HostConfig.Ulimits.1.Soft", 0],
    ["container.HostConfig.RestartPolicy.Name", "always"], ["container.HostConfig.RestartPolicy.MaximumRetryCount", 3],
    ["container.HostConfig.LogConfig.Type", "json-file"], ["container.HostConfig.LogConfig.Config", { secret: "synthetic" }],
    ["container.HostConfig.Tmpfs", { "/tmp": tmpfs, "/run": "rw" }],
    ["container.HostConfig.Tmpfs./tmp", `${tmpfs},rw`], ["container.HostConfig.Tmpfs./tmp", `${tmpfs},exec`],
    ["container.HostConfig.Tmpfs./tmp", tmpfs.replace("size=268435456", "size=536870912")],
    ["container.HostConfig.Tmpfs./tmp", tmpfs.replace("uid=10001", "uid=0")],
    ["container.HostConfig.Tmpfs./tmp", tmpfs.replace("mode=0700", "mode=0777")],
    ["container.RestartCount", 1], ["container.ExecIDs", ["synthetic-exec"]], ["container.LogPath", "/host/private.log"],
    ["container.AppArmorProfile", "unconfined"], ["container.NetworkSettings.Ports", { "80/tcp": [] }],
    ["container.NetworkSettings.SandboxID", "synthetic-sandbox"], ["container.NetworkSettings.SandboxKey", "/host/netns"],
    ["container.NetworkSettings.UnknownNetworkSwitch", true],
    ["container.NetworkSettings.Networks", { bridge: {} }], ["container.NetworkSettings.Networks.none.IPAddress", "10.0.0.2"],
    ["container.NetworkSettings.Networks.none.DriverOpts", { custom: "yes" }], ["container.State.Status", "exited"],
    ["container.State.Pid", 42], ["container.State.ExitCode", 1], ["container.State.Error", "synthetic-secret"],
    ["container.State.StartedAt", "2026-09-08T00:00:00Z"], ["container.State.FinishedAt", "2026-09-08T00:00:01Z"],
    ["container.State.Health", { Status: "healthy" }], ["container.HostConfig.UnknownSecuritySwitch", true]
  ];
  for (const owner of ["image", "container"]) {
    for (const [field, value] of [["Env", [...env, "SECRET=synthetic-secret"]], ["Env", [...env, env[0]]],
      ["Env", ["PATH"]], ["Env", ["PATH=unexpected"]], ["Volumes", { "/private": {} }],
      ["Healthcheck", { Test: ["CMD-SHELL", "echo synthetic"] }], ["Healthcheck", { Test: [] }],
      ["User", "0:0"], ["Entrypoint", ["/bin/sh"]], ["Cmd", ["unexpected"]], ["WorkingDir", "/"],
      ["Shell", ["/bin/sh", "-c"]], ["OnBuild", ["RUN echo synthetic"]], ["StopSignal", "SIGSTOP"],
      ["ExposedPorts", { "80/tcp": {} }], ["ArgsEscaped", true]] as [string, unknown][]) mutations.push([`${owner}.Config.${field}`, value]);
  }
  for (const field of ["Running", "Paused", "Restarting", "Dead", "OOMKilled"]) mutations.push([`container.State.${field}`, true]);
  for (const field of ["CpuShares", "BlkioWeight", "CpuPeriod", "CpuQuota", "CpuRealtimePeriod", "CpuRealtimeRuntime",
    "MemoryReservation", "CpuCount", "CpuPercent", "IOMaximumIOps", "IOMaximumBandwidth", "OomScoreAdj"]) {
    mutations.push([`container.HostConfig.${field}`, 1]);
  }
  for (const field of ["Binds", "VolumesFrom", "CapAdd", "Capabilities", "Devices", "DeviceRequests", "DeviceCgroupRules", "GroupAdd",
    "Links", "ExtraHosts", "Dns", "DnsOptions", "DnsSearch", "BlkioWeightDevice", "BlkioDeviceReadBps", "BlkioDeviceWriteBps",
    "BlkioDeviceReadIOps", "BlkioDeviceWriteIOps"]) mutations.push([`container.HostConfig.${field}`, ["synthetic-extra"]]);
  for (const field of ["PidMode", "UTSMode", "UsernsMode", "Cgroup", "CgroupParent", "ContainerIDFile", "VolumeDriver", "CpusetCpus",
    "CpusetMems", "Isolation"]) mutations.push([`container.HostConfig.${field}`, "host"]);
  for (const field of ["PortBindings", "Annotations", "Sysctls", "StorageOpt"]) mutations.push([`container.HostConfig.${field}`, { custom: "1" }]);
  for (const prefix of ["container.HostConfig.Mounts", "container.Mounts"]) {
    mutations.push([`${prefix}.0.Source`, "/host/private"], [`${prefix}.0.Type`, "volume"], [`${prefix}.1`, fixture().container.Mounts[0]]);
    mutations.push([`${prefix}.0.${prefix.includes("HostConfig") ? "Target" : "Destination"}`, "/other"]);
  }
  for (const [field, value] of [["NonRecursive", false], ["ReadOnlyNonRecursive", true], ["ReadOnlyForceRecursive", true],
    ["CreateMountpoint", true], ["Propagation", "rshared"]] as [string, unknown][]) mutations.push([`container.HostConfig.Mounts.0.BindOptions.${field}`, value]);
  mutations.push(["container.HostConfig.Mounts.0.ReadOnly", false], ["container.Mounts.0.RW", true], ["container.Mounts.0.Propagation", "rshared"]);

  it.each(mutations)("rejects changed inspect field %s (%#)", (path, value) => {
    const observations = fixture(); change(observations, path, value);
    expect(checkPmDockerPrestartConfiguration(expected, observations)).toEqual({ status: "configuration-mismatch" });
  });

  it.each(["container.Id", "container.State", "container.Config.Env", "container.Config.Healthcheck", "container.HostConfig.Init",
    "container.HostConfig.OomKillDisable", "container.Config.Labels", "container.HostConfig.Mounts.0.BindOptions.NonRecursive",
    "container.HostConfig.MaskedPaths", "container.HostConfig.ReadonlyPaths"])("rejects absent required evidence %s", path => {
    const observations = fixture(); change(observations, path, undefined);
    expect(checkPmDockerPrestartConfiguration(expected, observations).status).toBe("configuration-mismatch");
  });

  it("checks each mount collection independently, including count and repeated targets", () => {
    for (const path of ["container.HostConfig.Mounts", "container.Mounts"]) {
      const mounts = path.includes("HostConfig") ? fixture().container.HostConfig.Mounts : fixture().container.Mounts;
      for (const value of [[], [mounts[0]], [...mounts, mounts[0]], [mounts[0], mounts[0]]]) {
        const observations = fixture(); change(observations, path, value);
        expect(checkPmDockerPrestartConfiguration(expected, observations).status).toBe("configuration-mismatch");
      }
    }
  });

  it("requires independent matching pins plus baseline protections even when altered lists are repinned", () => {
    for (const [field, pin, paths] of [["MaskedPaths", "maskedPathsHash", maskedPaths], ["ReadonlyPaths", "readonlyPathsHash", readonlyPaths]] as const) {
      expect(checkPmDockerPrestartConfiguration({ ...expected, [pin]: "f".repeat(64) }, fixture()).status).toBe("configuration-mismatch");
      for (const candidate of [[], paths.slice(1), [...paths, paths[0]!], [...paths, "/proc/../private"], [...paths, "/proc//keys"]]) {
        const observations = fixture(); change(observations, `container.HostConfig.${field}`, candidate);
        expect(checkPmDockerPrestartConfiguration({ ...expected, [pin]: pathHash(candidate) }, observations).status).toBe("configuration-mismatch");
      }
    }
  });

  it.each([null, [], {}, { ...expected, containerId: "short" }, { ...expected, maskedPathsHash: "" },
    { ...expected, readonlyPathsHash: null }, { ...expected, profile: { ...profile, imageId: "latest" } },
    { ...expected, secret: "synthetic-secret" }])("rejects malformed trusted input %#", input => {
    expect(checkPmDockerPrestartConfiguration(input, fixture())).toEqual({ status: "invalid-configuration" });
  });
  it.each([null, [], {}, { image: null, container: null }, { ...fixture(), extra: "synthetic-secret" }])("rejects malformed observations without echoing data %#", observations => {
    expect(checkPmDockerPrestartConfiguration(expected, observations)).toEqual({ status: "configuration-mismatch" });
  });
  it("does not leak ignored top-level metadata or promote it to evidence", () => {
    const observations = fixture();
    change(observations, "image.Comment", "synthetic-secret"); change(observations, "container.ResolvConfPath", "/private/synthetic-secret");
    const result = checkPmDockerPrestartConfiguration(expected, observations);
    expect(result.status).toBe("configuration-matches");
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    expect(result).not.toHaveProperty("publishable"); expect(result).not.toHaveProperty("executionProfile");
  });
});
