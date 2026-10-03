import { StartCheckinRecoveryManifestSchema, type StartCheckinRecoveryManifest } from "@o-tid/contracts";

type RecoveryCliArguments =
  | { command: "issue"; operatorLabel: string; reason: string; expiresAt: Date }
  | { command: "revoke"; operatorLabel: string; reason: string; grantId: string };

/** Trusted server CLI only. No token or manifest is accepted in process arguments. */
export function parseCheckinRecoveryCliArguments(args: readonly string[]): RecoveryCliArguments {
  const [command, ...fields] = args;
  const allowed = command === "issue" ? ["--operator-label", "--reason", "--expires-at"]
    : command === "revoke" ? ["--operator-label", "--reason", "--grant-id"] : [];
  const values = new Map<string, string>();
  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index], value = fields[index + 1];
    if (!key || !allowed.includes(key) || !value || value.startsWith("--") || values.has(key)) {
      throw new Error("CHECKIN_RECOVERY_ARGUMENTS_INVALID");
    }
    values.set(key, value);
  }
  if (!allowed.length || allowed.some((key) => !values.has(key))) throw new Error("CHECKIN_RECOVERY_ARGUMENTS_INVALID");
  const operatorLabel = values.get("--operator-label")!;
  const reason = values.get("--reason")!;
  if (operatorLabel.trim() !== operatorLabel || !operatorLabel.length || operatorLabel.length > 120
    || reason.trim() !== reason || !reason.length || reason.length > 500) throw new Error("CHECKIN_RECOVERY_ARGUMENTS_INVALID");
  if (command === "revoke") {
    const grantId = values.get("--grant-id")!;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(grantId)) {
      throw new Error("CHECKIN_RECOVERY_ARGUMENTS_INVALID");
    }
    return { command, operatorLabel, reason, grantId };
  }
  const encoded = values.get("--expires-at")!;
  const expiresAt = new Date(encoded);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(encoded)
    || !Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== encoded) {
    throw new Error("CHECKIN_RECOVERY_ARGUMENTS_INVALID");
  }
  return { command: "issue", operatorLabel, reason, expiresAt };
}

/** Bounded private stdin, not a filesystem path or arbitrary external resource. */
export async function readCheckinRecoveryManifestInput(input: AsyncIterable<Uint8Array>): Promise<StartCheckinRecoveryManifest> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array) || size + chunk.byteLength > 4 * 1024 * 1024) throw new Error("INVALID");
      size += chunk.byteLength;
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks, size);
    const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return StartCheckinRecoveryManifestSchema.parse(decoded);
  } catch {
    // Parsing and validation errors may embed private input. Never forward them.
    throw new Error("CHECKIN_RECOVERY_MANIFEST_INPUT_INVALID");
  }
}
