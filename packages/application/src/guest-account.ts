import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/** Demoläget del 2: kontot är ett tillfälligt gästkonto (migration 0108). */
export async function isGuestAccount(tx: DbExecutor, accountId: string): Promise<boolean> {
  const [row] = await tx.select({ guestExpiresAt: schema.userAccounts.guestExpiresAt }).from(schema.userAccounts)
    .where(eq(schema.userAccounts.id, accountId)).limit(1);
  return !!row?.guestExpiresAt;
}
