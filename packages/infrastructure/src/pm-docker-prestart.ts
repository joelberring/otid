import { createHash } from "node:crypto";
import { canonicalJsonBytes } from "@o-tid/contracts";
import { z } from "zod";
import { buildPmDockerCreatePlan, pmDockerProfileInputSchema } from "./pm-docker-profile";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const pmDockerPrestartInputSchema = z.object({ profile: pmDockerProfileInputSchema, containerId: hash,
  maskedPathsHash: hash, readonlyPathsHash: hash }).strict();
const strings = z.array(z.string().max(1024)).max(128);
const emptyMap = z.object({}).strict().nullish();
const emptyList = z.array(z.never()).nullish();
const emptyString = z.literal("").nullish();
const zero = z.literal(0).nullish();
const no = z.literal(false).nullish();
const labels = z.record(z.string().max(256), z.string().max(1024));
const healthcheck = z.object({ Test: z.tuple([z.literal("NONE")]),
  Interval: zero, Timeout: zero, Retries: zero, StartPeriod: zero, StartInterval: zero }).strict();
const imageConfig = z.object({
  User: z.literal("10001:10001"), Env: strings.nullish(),
  Entrypoint: z.tuple([z.literal("/opt/otid/bin/pm-scan")]),
  Cmd: z.tuple([z.literal("/input/input.pdf"), z.literal("/signatures")]),
  WorkingDir: z.literal("/tmp"), Volumes: emptyMap, ExposedPorts: emptyMap,
  Healthcheck: healthcheck.nullish(), OnBuild: emptyList, Shell: emptyList,
  ArgsEscaped: no, Labels: labels.nullish(), StopSignal: z.union([z.literal("SIGTERM"), emptyString])
}).strict();
const containerConfig = imageConfig.extend({
  Image: z.string(), Env: strings, Healthcheck: healthcheck,
  Hostname: z.string(), Domainname: emptyString,
  AttachStdin: z.literal(false), AttachStdout: z.boolean(), AttachStderr: z.boolean(),
  OpenStdin: z.literal(false), StdinOnce: z.literal(false), Tty: z.literal(false),
  NetworkDisabled: z.boolean().nullish(), StopSignal: z.literal("SIGTERM"), StopTimeout: z.literal(5)
}).strict();
const requestedMount = z.object({
  Type: z.literal("bind"), Source: z.string(), Target: z.string(), ReadOnly: z.literal(true),
  Consistency: z.union([emptyString, z.literal("default")]),
  BindOptions: z.object({ Propagation: z.literal("rprivate"), NonRecursive: z.literal(true),
    CreateMountpoint: no, ReadOnlyNonRecursive: no, ReadOnlyForceRecursive: no }).strict()
}).strict();
const actualMount = z.object({ Type: z.literal("bind"), Source: z.string(), Destination: z.string(),
  RW: z.literal(false), Propagation: z.literal("rprivate"),
  Mode: z.union([z.literal("ro"), emptyString]), Name: emptyString, Driver: emptyString }).strict();
const ulimit = z.object({ Name: z.enum(["core", "nofile"]), Soft: z.number(), Hard: z.number() }).strict()
  .refine(value => value.Soft === (value.Name === "core" ? 0 : 256) && value.Hard === value.Soft);
const neutralNumbers = Object.fromEntries([
  "CpuShares", "BlkioWeight", "CpuPeriod", "CpuQuota", "CpuRealtimePeriod", "CpuRealtimeRuntime",
  "MemoryReservation", "CpuCount", "CpuPercent", "IOMaximumIOps", "IOMaximumBandwidth", "OomScoreAdj"
].map(key => [key, zero]));
const neutralLists = Object.fromEntries([
  "Binds", "VolumesFrom", "CapAdd", "Capabilities", "Devices", "DeviceRequests", "DeviceCgroupRules",
  "GroupAdd", "Links", "ExtraHosts", "Dns", "DnsOptions", "DnsSearch", "BlkioWeightDevice",
  "BlkioDeviceReadBps", "BlkioDeviceWriteBps", "BlkioDeviceReadIOps", "BlkioDeviceWriteIOps"
].map(key => [key, emptyList]));
const neutralStrings = Object.fromEntries([
  "PidMode", "UTSMode", "UsernsMode", "Cgroup", "CgroupParent", "ContainerIDFile", "VolumeDriver",
  "CpusetCpus", "CpusetMems", "Isolation"
].map(key => [key, emptyString]));
const hostConfig = z.object({
  ...neutralNumbers, ...neutralLists, ...neutralStrings,
  Privileged: z.literal(false), ReadonlyRootfs: z.literal(true), AutoRemove: z.literal(false),
  PublishAllPorts: z.literal(false), NetworkMode: z.literal("none"), IpcMode: z.literal("none"),
  CgroupnsMode: z.literal("private"), CapDrop: z.tuple([z.literal("ALL")]),
  SecurityOpt: z.tuple([z.enum(["no-new-privileges", "no-new-privileges=true"])]),
  Memory: z.literal(2147483648), MemorySwap: z.literal(2147483648), NanoCpus: z.literal(1000000000),
  PidsLimit: z.literal(64), Ulimits: z.array(ulimit).length(2), Init: z.literal(false),
  OomKillDisable: z.literal(false), MemorySwappiness: zero, ShmSize: z.literal(67108864).optional(),
  Runtime: z.literal("runc"), Mounts: z.array(requestedMount).length(2),
  Tmpfs: z.object({ "/tmp": z.string().max(256) }).strict(),
  RestartPolicy: z.object({ Name: z.literal("no"), MaximumRetryCount: z.literal(0) }).strict(),
  LogConfig: z.object({ Type: z.literal("none"), Config: emptyMap }).strict(),
  PortBindings: emptyMap, Annotations: emptyMap, Sysctls: emptyMap, StorageOpt: emptyMap,
  MaskedPaths: strings.min(1), ReadonlyPaths: strings.min(1),
  ConsoleSize: z.tuple([z.literal(0), z.literal(0)]).nullish()
}).strict();
const zeroTime = z.literal("0001-01-01T00:00:00Z");
const state = z.object({ Status: z.literal("created"), Running: z.literal(false),
  Paused: z.literal(false), Restarting: z.literal(false), Dead: z.literal(false), OOMKilled: z.literal(false),
  Pid: z.literal(0), ExitCode: z.literal(0), Error: z.literal(""),
  StartedAt: zeroTime, FinishedAt: zeroTime, Health: z.null().optional() }).strict();
// Non-executable top-level metadata is stripped. Security-relevant nested
// structures are closed; new runtime fields require explicit review.
const image = z.object({ Id: z.string(), Os: z.literal("linux"), Architecture: z.enum(["amd64", "arm64"]),
  Variant: z.string().nullish(), Config: imageConfig });
const container = z.object({
  Id: hash, Name: z.string(), Image: z.string(), Platform: z.literal("linux"),
  Path: z.literal("/opt/otid/bin/pm-scan"),
  Args: z.tuple([z.literal("/input/input.pdf"), z.literal("/signatures")]),
  Config: containerConfig, HostConfig: hostConfig, Mounts: z.array(actualMount).length(2), State: state,
  RestartCount: z.literal(0), ExecIDs: emptyList, LogPath: emptyString,
  AppArmorProfile: z.union([z.literal("docker-default"), emptyString]),
  NetworkSettings: z.object({ SandboxID: emptyString, SandboxKey: emptyString, Ports: emptyMap, Networks: z.object({ none: z.object({
    IPAMConfig: emptyMap, Links: emptyList, Aliases: emptyList, MacAddress: emptyString,
    DriverOpts: emptyMap, GwPriority: zero, NetworkID: z.string().regex(/^[0-9a-f]{64}$/).or(z.literal("")),
    EndpointID: emptyString, Gateway: emptyString, IPAddress: emptyString, IPPrefixLen: zero,
    IPv6Gateway: emptyString, GlobalIPv6Address: emptyString, GlobalIPv6PrefixLen: zero, DNSNames: emptyList
  }).strict() }).strict() }).strict()
});
const inspectionsSchema = z.object({ image, container }).strict();

function equal(a: unknown, b: unknown): boolean {
  return Buffer.from(canonicalJsonBytes(a)).equals(Buffer.from(canonicalJsonBytes(b)));
}
function exactSet(actual: string[], expected: string[]): boolean {
  return new Set(actual).size === actual.length && equal([...actual].sort(), [...expected].sort());
}
function pinnedPaths(paths: string[], expected: string, required: string[]): boolean {
  return paths.every(path => /^\/(proc|sys)\/[a-zA-Z0-9_/-]+$/.test(path) && !path.includes("//")) &&
    new Set(paths).size === paths.length && required.every(path => paths.includes(path)) &&
    createHash("sha256").update(canonicalJsonBytes([...paths].sort())).digest("hex") === expected;
}

/** Checks supplied inspect metadata only. No I/O, runtime acceptance or publication authority. */
export function checkPmDockerPrestartConfiguration(input: unknown, inspections: unknown) {
  const expected = pmDockerPrestartInputSchema.safeParse(input), observed = inspectionsSchema.safeParse(inspections);
  if (!expected.success) return { status: "invalid-configuration" as const };
  if (!observed.success) return { status: "configuration-mismatch" as const };
  const { profile, containerId, maskedPathsHash, readonlyPathsHash } = expected.data;
  const plan = buildPmDockerCreatePlan(profile);
  const { image: i, container: c } = observed.data;
  const h = c.HostConfig;
  const env = plan.args.filter(arg => arg.startsWith("--env=")).map(arg => arg.slice(6));
  const imageEnv = i.Config.Env ?? [], imageLabels = i.Config.Labels ?? {};
  const variant = i.Variant ?? "";
  const bindings = ["input", "signatures"].map(name => ({ source: `${profile.stagingRoot}/${profile.attemptId}/${name}`, target: `/${name}` }));
  const matches = i.Id === profile.imageId && c.Image === profile.imageId && c.Config.Image === profile.imageId &&
    i.Architecture === profile.platform.slice(6) && (variant === "" || (i.Architecture === "arm64" && variant === "v8")) &&
    c.Id === containerId && [plan.containerName, `/${plan.containerName}`].includes(c.Name) &&
    c.Config.Hostname === containerId.slice(0, 12) &&
    imageEnv.every(value => env.includes(value)) && new Set(imageEnv).size === imageEnv.length &&
    exactSet(c.Config.Env, env) &&
    !Object.keys(imageLabels).some(key => key.startsWith("io.otid.pm.")) &&
    equal(c.Config.Labels ?? {}, { ...imageLabels, "io.otid.pm.scan-attempt": profile.attemptId, "io.otid.pm.scan-profile": plan.profileId }) &&
    new Set(h.Ulimits.map(value => value.Name)).size === 2 &&
    bindings.every(binding => h.Mounts.filter(mount => mount.Source === binding.source && mount.Target === binding.target).length === 1 &&
      c.Mounts.filter(mount => mount.Source === binding.source && mount.Destination === binding.target).length === 1) &&
    exactSet(h.Tmpfs["/tmp"].split(","), plan.args.find(arg => arg.startsWith("--tmpfs=/tmp:"))!.slice(13).split(",")) &&
    pinnedPaths(h.MaskedPaths, maskedPathsHash, ["/proc/kcore", "/proc/keys", "/sys/firmware"]) &&
    pinnedPaths(h.ReadonlyPaths, readonlyPathsHash, ["/proc/sys", "/proc/sysrq-trigger", "/proc/irq", "/proc/bus", "/proc/fs"]);
  if (!matches) return { status: "configuration-mismatch" as const };
  return { status: "configuration-matches" as const, profileId: plan.profileId, profileHash: plan.profileHash,
    imageId: profile.imageId, containerId, requiresRuntimeAcceptance: true as const };
}
