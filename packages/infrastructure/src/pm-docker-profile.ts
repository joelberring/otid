import { createHash } from "node:crypto";
import { canonicalJsonBytes } from "@o-tid/contracts";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const broadRoots = new Set(["/private/tmp", "/var/tmp", "/var/lib", "/var/run", "/usr/local", "/usr/share", "/opt/homebrew"]);
const stagingRoot = z.string().max(240)
  .regex(/^\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)+$/)
  .refine(path => !broadRoots.has(path));
export const pmDockerProfileInputSchema = z.object({
  attemptId: uuid,
  imageId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  platform: z.enum(["linux/amd64", "linux/arm64"]),
  stagingRoot
}).strict();

// This is a requested configuration, never evidence of kernel enforcement.
// Image/runtime validation, realpath checks and lifecycle fencing precede use.
const policy = {
  profileId: "pm-linux-docker-v1" as const,
  containerPrefix: "otid-pm-scan-",
  attemptLabel: "io.otid.pm.scan-attempt",
  profileLabel: "io.otid.pm.scan-profile",
  platforms: ["linux/amd64", "linux/arm64"],
  createArguments: [
    "--pull=never", "--user=10001:10001", "--network=none", "--ipc=none",
    "--cgroupns=private", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", "--memory=2147483648",
    "--memory-swap=2147483648", "--cpus=1", "--pids-limit=64",
    "--ulimit=nofile=256:256", "--ulimit=core=0:0",
    "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=268435456,mode=0700,uid=10001,gid=10001",
    "--restart=no", "--log-driver=none", "--no-healthcheck", "--init=false",
    "--runtime=runc", "--stop-signal=SIGTERM", "--stop-timeout=5",
    "--workdir=/tmp", "--env=PATH=/usr/bin:/bin", "--env=LC_ALL=C",
    "--env=TZ=UTC", "--env=TMPDIR=/tmp"
  ],
  mounts: [
    { relativePath: "input", target: "/input" },
    { relativePath: "signatures", target: "/signatures" }
  ],
  mountOptions: "readonly,bind-recursive=disabled,bind-propagation=rprivate",
  entrypoint: "/opt/otid/bin/pm-scan",
  command: ["/input/input.pdf", "/signatures"]
};
const profileHash = createHash("sha256").update(canonicalJsonBytes(policy)).digest("hex");

/** Generates argv only. It does not create a container or authorize PASSED/publication. */
export function buildPmDockerCreatePlan(input: unknown) {
  const parsed = pmDockerProfileInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("PM_DOCKER_PROFILE_INVALID");
  const config = parsed.data;
  const containerName = `${policy.containerPrefix}${config.attemptId}`;
  const args = [
    "container", "create", `--name=${containerName}`,
    `--label=${policy.attemptLabel}=${config.attemptId}`,
    `--label=${policy.profileLabel}=${policy.profileId}`,
    `--platform=${config.platform}`, ...policy.createArguments
  ];
  for (const mount of policy.mounts) {
    args.push(`--mount=type=bind,source=${config.stagingRoot}/${config.attemptId}/${mount.relativePath},target=${mount.target},${policy.mountOptions}`);
  }
  args.push(`--entrypoint=${policy.entrypoint}`, config.imageId, ...policy.command);
  return { profileId: policy.profileId, profileHash, containerName, args };
}
