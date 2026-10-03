import { canonicalJsonBytes, stationPackagePayloadSchema } from "@o-tid/contracts";
import { sha256Hex } from "@o-tid/device-transport";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { describe, expect, it, vi } from "vitest";
import { evaluateAndPersistSimulatorReadout } from "../src/local-evaluation";
import type { EnqueueEventRequest, StationStoreCapacitorPlugin } from "../src/station-store-plugin";

const ids = {
  event: "10000000-0000-4000-8000-000000000001",
  race: "10000000-0000-4000-8000-000000000002",
  raceClass: "10000000-0000-4000-8000-000000000003",
  course: "10000000-0000-4000-8000-000000000004",
  courseVersion: "10000000-0000-4000-8000-000000000005",
  courseControl: "10000000-0000-4000-8000-000000000006",
  control: "10000000-0000-4000-8000-000000000007",
  entry: "10000000-0000-4000-8000-000000000008",
  assignment: "10000000-0000-4000-8000-000000000009",
  device: "10000000-0000-4000-8000-000000000010",
  session: "10000000-0000-4000-8000-000000000011"
};

function packagePayload(engineVersion = RESULT_ENGINE_VERSION) {
  return stationPackagePayloadSchema.parse({
    formatVersion: 1,
    raceId: ids.race,
    packageVersion: 3,
    resultEngineVersion: engineVersion,
    stationFunction: "READOUT",
    event: {
      id: ids.event,
      name: "Testtävling",
      startsOn: "2026-08-31",
      timeZone: "Europe/Stockholm"
    },
    raceSnapshot: {
      race: {
        id: ids.race,
        eventId: ids.event,
        name: "Individuellt",
        raceDate: "2026-08-31",
        snapshotVersion: 3
      },
      classes: [{
        id: ids.raceClass,
        raceId: ids.race,
        name: "H21",
        courseVersionId: ids.courseVersion,
        startRule: "PUNCH"
      }],
      courses: [{
        id: ids.course,
        raceId: ids.race,
        name: "Bana 1",
        versions: [{
          id: ids.courseVersion,
          courseId: ids.course,
          version: 1,
          createdAt: "2026-08-31T08:00:00.000Z",
          controls: [{
            id: ids.courseControl,
            courseVersionId: ids.courseVersion,
            controlId: ids.control,
            sequence: 1,
            controlCode: 31
          }]
        }]
      }],
      entries: [{
        id: ids.entry,
        raceId: ids.race,
        classId: ids.raceClass,
        givenName: "Ada",
        familyName: "Löpare"
      }],
      cardAssignments: [{
        id: ids.assignment,
        raceId: ids.race,
        entryId: ids.entry,
        cardNumber: "12345",
        active: true
      }],
      classControlNeutralizations: []
    },
    verificationKey: {
      algorithm: "RS256",
      keyId: "a".repeat(64),
      publicKeySpkiBase64: "AQ=="
    }
  });
}

const simulatorPayload = {
  cardNumber: "12345",
  startPunchedAt: "2026-08-31T10:00:00.000Z",
  finishPunchedAt: "2026-08-31T10:20:00.000Z",
  punches: [{ code: 31, punchedAt: "2026-08-31T10:10:00.000Z" }]
};

function fakeStore(engineVersion = RESULT_ENGINE_VERSION) {
  const payload = packagePayload(engineVersion);
  const payloadJson = new TextDecoder().decode(canonicalJsonBytes(payload));
  const payloadSha256 = sha256Hex(new TextEncoder().encode(payloadJson));
  const enqueueEvent = vi.fn(async (request: EnqueueEventRequest) => ({
    ...request,
    deviceId: ids.device,
    localSequence: 1
  }));
  const recordLocalEvaluation = vi.fn(async (request: { localEvaluationJson: string; evaluationHash: string }) => ({
    status: "stored" as const,
    deviceId: ids.device,
    localSequence: 1,
    evaluationHash: request.evaluationHash
  }));
  const loadActivePackage = vi.fn(async () => ({
    raceId: ids.race,
    packageVersion: 3,
    payloadSha256,
    keyId: "a".repeat(64),
    payloadJson
  }));
  const store: StationStoreCapacitorPlugin = {
    beginDevicePairing: vi.fn(),
    getDevicePairingStatus: vi.fn(),
    redeemDevicePairing: vi.fn(),
    discardDevicePairing: vi.fn(),
    discardInvalidDevicePairing: vi.fn(),
    getDeviceCredentialStatus: vi.fn(),
    authorizedStationRequest: vi.fn(),
    installPackage: vi.fn(),
    getStatus: vi.fn(),
    saveBaseUrl: vi.fn(),
    loadBaseUrl: vi.fn(),
    loadLatestEvaluationPair: vi.fn(),
    loadActivePackage,
    enqueueEvent,
    recordLocalEvaluation,
    listPending: vi.fn(),
    applyAcknowledgements: vi.fn()
  };
  return { store, payload, payloadJson, payloadSha256, enqueueEvent, recordLocalEvaluation, loadActivePackage };
}

describe("local station evaluation", () => {
  it("uses the shared domain engine and persists only after outbox enqueue", async () => {
    const { store, enqueueEvent, recordLocalEvaluation } = fakeStore();
    const outcome = await evaluateAndPersistSimulatorReadout({
      raceId: ids.race,
      sessionId: ids.session,
      simulatorPayload,
      stationReceivedAt: "2026-08-31T10:20:01.000Z",
      store
    });

    expect(outcome.kind).toBe("evaluated");
    if (outcome.kind !== "evaluated") throw new Error("Lokal bedömning saknas");
    expect(outcome.evaluation).toEqual({
      status: "OK",
      reason: "COMPLETE",
      entryId: ids.entry,
      classId: ids.raceClass,
      courseVersionId: ids.courseVersion,
      startTime: simulatorPayload.startPunchedAt,
      finishTime: simulatorPayload.finishPunchedAt,
      elapsedMs: 1_200_000,
      missingControls: [],
      extraPunches: [],
      splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }]
    });
    expect(enqueueEvent.mock.invocationCallOrder[0]).toBeLessThan(recordLocalEvaluation.mock.invocationCallOrder[0]!);
    expect(enqueueEvent.mock.calls[0]![0]).toMatchObject({
      payloadJson: JSON.stringify(simulatorPayload),
      contentHash: sha256Hex(new TextEncoder().encode(JSON.stringify(simulatorPayload)))
    });
    const persisted = JSON.parse(recordLocalEvaluation.mock.calls[0]![0].localEvaluationJson) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      deviceId: ids.device,
      localSequence: 1,
      packagePayloadSha256: outcome.packagePayloadSha256,
      engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: 3,
      evaluation: { status: "OK", reason: "COMPLETE" }
    });
  });

  it("keeps the outbox event but records no result for an incompatible engine", async () => {
    const { store, enqueueEvent, recordLocalEvaluation } = fakeStore("9.9.9");
    const outcome = await evaluateAndPersistSimulatorReadout({
      raceId: ids.race,
      sessionId: ids.session,
      simulatorPayload,
      store
    });
    expect(outcome).toMatchObject({
      kind: "queued-without-evaluation",
      reason: "ENGINE_VERSION_MISMATCH",
      packageEngineVersion: "9.9.9",
      localEngineVersion: RESULT_ENGINE_VERSION
    });
    expect(enqueueEvent).toHaveBeenCalledOnce();
    expect(recordLocalEvaluation).not.toHaveBeenCalled();
  });

  it("does not lose the committed outbox event when evaluation persistence fails", async () => {
    const { store, enqueueEvent, recordLocalEvaluation } = fakeStore();
    recordLocalEvaluation.mockRejectedValueOnce(new Error("diskfel"));
    await expect(evaluateAndPersistSimulatorReadout({
      raceId: ids.race,
      sessionId: ids.session,
      simulatorPayload,
      store
    })).rejects.toThrow("diskfel");
    expect(enqueueEvent).toHaveBeenCalledOnce();
    expect(vi.mocked(recordLocalEvaluation)).toHaveBeenCalledOnce();
  });

  it("rejects changed payload bytes before consuming a local sequence", async () => {
    const { store, enqueueEvent, loadActivePackage } = fakeStore();
    loadActivePackage.mockResolvedValueOnce({
      raceId: ids.race,
      packageVersion: 3,
      payloadSha256: "f".repeat(64),
      keyId: "a".repeat(64),
      payloadJson: "{}"
    });
    await expect(evaluateAndPersistSimulatorReadout({
      raceId: ids.race,
      sessionId: ids.session,
      simulatorPayload,
      store
    })).rejects.toThrow("payloadhash");
    expect(enqueueEvent).not.toHaveBeenCalled();
  });
});
