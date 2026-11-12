import { superadminActionKindSchema, type SuperadminActionKind } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/** Superadmins logg (ADR-0172 beslut 2): vem, vad, mot vad, varför och när. Egen modul så att kontots moduler kan logga. */
export const SERVER_COMMAND_ACTOR = "Serverkommando";

export async function logAction(tx: DbExecutor, entry: {
  actorAccountId: string | null; actorLabel: string; action: SuperadminActionKind;
  targetType: "ACCOUNT" | "EVENT" | "RACE"; targetId: string; targetLabel: string; reason: string;
}, now: Date): Promise<void> {
  // Migration 0115: databasen kräver bara formen, så listan prövas här.
  const action = superadminActionKindSchema.parse(entry.action);
  await tx.insert(schema.superadminActions).values({ ...entry, action, targetLabel: entry.targetLabel.slice(0, 320), createdAt: now });
}
