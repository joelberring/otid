import { readoutPackageSchema, type ReadoutPackage } from "@o-tid/contracts";
import type { QueuedReadout, ReadoutStore, NewReadout } from "./store";

/** Endast för tester: ett litet avläsningspaket med en deltagare och tre kontroller. */
export const ids = {
  event: "10000000-0000-4000-8000-000000000001",
  race: "10000000-0000-4000-8000-000000000002",
  class: "10000000-0000-4000-8000-000000000003",
  course: "10000000-0000-4000-8000-000000000004",
  version: "10000000-0000-4000-8000-000000000005",
  entry: "10000000-0000-4000-8000-000000000006",
  assignment: "10000000-0000-4000-8000-000000000007",
  device: "10000000-0000-4000-8000-000000000008",
  session: "10000000-0000-4000-8000-000000000009"
} as const;

export const TEST_CARD = 7_123_456;

export function testPackage(): ReadoutPackage {
  const control = (n: number) => ({
    id: `10000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, courseVersionId: ids.version,
    controlId: `10000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`, sequence: n, controlCode: 30 + n
  });
  return readoutPackageSchema.parse({
    formatVersion: 1, raceId: ids.race, packageVersion: 3, resultEngineVersion: "0.1.1",
    event: { id: ids.event, name: "Klubbträning", startsOn: "2026-10-01", timeZone: "Europe/Stockholm" },
    fetchedAt: "2026-10-01T16:00:00.000Z",
    raceSnapshot: {
      race: { id: ids.race, eventId: ids.event, name: "Torsdagsträning", raceDate: "2026-10-01", snapshotVersion: 3 },
      classes: [{ id: ids.class, raceId: ids.race, name: "Lång", courseVersionId: ids.version, startRule: "PUNCH" }],
      courses: [{ id: ids.course, raceId: ids.race, name: "Lång", versions: [{
        id: ids.version, courseId: ids.course, version: 1, createdAt: "2026-09-30T10:00:00.000Z",
        controls: [control(1), control(2), control(3)]
      }] }],
      entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Anna", familyName: "Berg" }],
      cardAssignments: [{ id: ids.assignment, raceId: ids.race, entryId: ids.entry, cardNumber: String(TEST_CARD), active: true }],
      classControlNeutralizations: []
    }
  });
}

/** Endast för tester: kö i minnet med samma regler som IndexedDB-kön. */
export class MemoryReadoutStore implements ReadoutStore {
  readonly packages = new Map<string, ReadoutPackage>();
  readonly items: QueuedReadout[] = [];
  #sequence = 0;

  async loadPackage(raceId: string) { return this.packages.get(raceId); }
  async savePackage(value: ReadoutPackage) { this.packages.set(value.raceId, value); }
  async identity() { return { deviceId: ids.device, sessionId: ids.session }; }
  async append(raceId: string, item: NewReadout): Promise<QueuedReadout> {
    this.#sequence += 1;
    const stored: QueuedReadout = { ...item, raceId, deviceId: ids.device, sessionId: ids.session, localSequence: this.#sequence, status: "pending" };
    this.items.push(stored);
    return stored;
  }
  async list(raceId: string) { return this.items.filter((item) => item.raceId === raceId); }
  async update(item: QueuedReadout) {
    const index = this.items.findIndex((candidate) => candidate.localSequence === item.localSequence);
    this.items[index] = item;
  }
}
