import { and, asc, eq, inArray } from "drizzle-orm";
import { clubDeviceDeleteSchema, clubDeviceNoteSchema, clubDeviceRecordSchema, type ClubDeviceList, type ClubDeviceView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubRoleAtLeast, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";

/**
 * Ägaren 2026-11-08: klubbens enhetsregister (migration 0102). Sidan Läs ut enheter sparar enheten efter en utläsning eller
 * inställning (Ledare eller mer); anteckningen skrivs av Ledare eller mer; Administratör tar bort; alla medlemmar ser listan.
 */
const devices = schema.clubDevices;
const MAX_DEVICES = 2000;

async function viewOf(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], rows: (typeof devices.$inferSelect)[]): Promise<ClubDeviceView[]> {
  const ids = [...new Set(rows.flatMap(row => row.lastReadBy ? [row.lastReadBy] : []))];
  const names = new Map(ids.length === 0 ? [] : (await tx.select({ id: schema.userAccounts.id, name: schema.userAccounts.displayName })
    .from(schema.userAccounts).where(inArray(schema.userAccounts.id, ids))).map(row => [row.id, row.name]));
  return rows.map(row => ({ serialNumber: row.serialNumber, model: row.model, firmware: row.firmware, code: row.code, mode: row.mode,
    batteryDate: row.batteryDate, batteryCapacityRaw: row.batteryCapacityRaw, memoryKb: row.memoryKb, backupCount: row.backupCount,
    clockOffsetMs: row.clockOffsetMs, note: row.note, firstSeenAt: row.firstSeenAt.toISOString(), lastReadAt: row.lastReadAt.toISOString(),
    lastReadBy: row.lastReadBy ? names.get(row.lastReadBy) ?? null : null }));
}

export async function listClubDevices(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: ClubDeviceList }> {
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "READER", now, false);
    if (access.status !== "ok") return access;
    const rows = await tx.select().from(devices).where(eq(devices.clubId, access.clubId)).orderBy(asc(devices.code), asc(devices.serialNumber)).limit(MAX_DEVICES);
    return { status: "ok", list: { formatVersion: 1, devices: await viewOf(tx, rows), canRecord: clubRoleAtLeast(access.role, "LEADER"),
      canDelete: clubRoleAtLeast(access.role, "ADMIN") } } as const;
  });
}

/** Sparar (eller uppdaterar) enheten efter en utläsning eller inställning. */
export async function recordClubDevice(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "too-many" } | { status: "ok"; device: ClubDeviceView }> {
  const parsed = clubDeviceRecordSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, "LEADER", now, true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { serialNumber, model, firmware, code, mode, batteryDate, batteryCapacityRaw, memoryKb, backupCount, clockOffsetMs } = parsed.data;
    const values = { model, firmware, code, mode, batteryDate, batteryCapacityRaw, memoryKb, backupCount, clockOffsetMs };
    const [existing] = await tx.select({ serial: devices.serialNumber }).from(devices).where(and(eq(devices.clubId, access.clubId), eq(devices.serialNumber, serialNumber)));
    if (!existing && (await tx.select({ serial: devices.serialNumber }).from(devices).where(eq(devices.clubId, access.clubId)).limit(MAX_DEVICES)).length >= MAX_DEVICES) {
      return { status: "too-many" } as const;
    }
    const [row] = await tx.insert(devices).values({ clubId: access.clubId, serialNumber, ...values, firstSeenAt: now, lastReadAt: now, lastReadBy: access.accountId })
      .onConflictDoUpdate({ target: [devices.clubId, devices.serialNumber], set: { ...values, lastReadAt: now, lastReadBy: access.accountId } }).returning();
    return { status: "ok", device: (await viewOf(tx, [row!]))[0]! } as const;
  });
}

/** Anteckningen (t.ex. "batteriet bytt hos SPORTident") eller borttagning. */
export async function changeClubDevice(db: Database, input: ClubProof & { clubId: string; request: unknown; remove: boolean }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = input.remove ? clubDeviceDeleteSchema.safeParse(input.request) : undefined;
  const note = input.remove ? undefined : clubDeviceNoteSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireClubRole(tx, input, input.remove ? "ADMIN" : "LEADER", now, true);
    if (access.status !== "ok") return access;
    const serialNumber = parsed?.success ? parsed.data.serialNumber : note?.success ? note.data.serialNumber : undefined;
    if (serialNumber === undefined) return { status: "invalid-request" } as const;
    const where = and(eq(devices.clubId, access.clubId), eq(devices.serialNumber, serialNumber));
    const changed = note?.success ? await tx.update(devices).set({ note: note.data.note }).where(where).returning({ serial: devices.serialNumber })
      : await tx.delete(devices).where(where).returning({ serial: devices.serialNumber });
    return changed.length > 0 ? { status: "ok" } as const : { status: "not-found" } as const;
  });
}
