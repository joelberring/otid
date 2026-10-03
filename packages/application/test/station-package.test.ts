import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StationPackagePayload } from "@o-tid/contracts";
import type { RaceSnapshot } from "@o-tid/domain";
import {
  signStationPackagePayload,
  sortRaceSnapshotForPackage,
  stationPackagePayloadHash,
  verifySignedStationPackage
} from "../src";

const ids = {
  event: "10000000-0000-4000-8000-000000000001",
  race: "10000000-0000-4000-8000-000000000002"
};

function keyPair(modulusLength = 2048) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeySpkiBase64 = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" }).toString("base64");
  const keyId = createHash("sha256").update(Buffer.from(publicKeySpkiBase64, "base64")).digest("hex");
  return { privateKeyPem, publicKeySpkiBase64, keyId };
}

function payload(key: ReturnType<typeof keyPair>): StationPackagePayload {
  return {
    formatVersion: 1,
    raceId: ids.race,
    packageVersion: 3,
    resultEngineVersion: "0.1.0",
    stationFunction: "READOUT",
    event: { id: ids.event, name: "Test", startsOn: "2026-08-30", timeZone: "Europe/Stockholm" },
    raceSnapshot: {
      race: {
        id: ids.race,
        eventId: ids.event,
        name: "Individuellt",
        raceDate: "2026-08-30",
        snapshotVersion: 3
      },
      classes: [],
      courses: [],
      entries: [],
      cardAssignments: [],
      classControlNeutralizations: []
    },
    verificationKey: {
      algorithm: "RS256",
      keyId: key.keyId,
      publicKeySpkiBase64: key.publicKeySpkiBase64
    }
  };
}

function permutedSnapshot(): RaceSnapshot {
  const courseA = "10000000-0000-4000-8000-000000000010";
  const courseB = "10000000-0000-4000-8000-000000000020";
  const versionA1 = "10000000-0000-4000-8000-000000000011";
  const versionA2 = "10000000-0000-4000-8000-000000000012";
  const versionB = "10000000-0000-4000-8000-000000000021";
  const classA = "10000000-0000-4000-8000-000000000030";
  const classB = "10000000-0000-4000-8000-000000000040";
  const entryA = "10000000-0000-4000-8000-000000000050";
  const entryB = "10000000-0000-4000-8000-000000000060";
  return {
    race: { id: ids.race, eventId: ids.event, name: "Individuellt", raceDate: "2026-08-30", snapshotVersion: 3 },
    classes: [
      { id: classB, raceId: ids.race, name: "B", courseVersionId: versionB, startRule: "PUNCH" },
      { id: classA, raceId: ids.race, name: "A", courseVersionId: versionA2, startRule: "FIXED" }
    ],
    courses: [
      {
        id: courseB,
        raceId: ids.race,
        name: "B",
        versions: [{ id: versionB, courseId: courseB, version: 1, createdAt: "2026-08-30T00:00:00.000Z", controls: [] }]
      },
      {
        id: courseA,
        raceId: ids.race,
        name: "A",
        versions: [
          {
            id: versionA2,
            courseId: courseA,
            version: 2,
            createdAt: "2026-08-30T00:00:00.000Z",
            controls: [
              {
                id: "10000000-0000-4000-8000-000000000014",
                courseVersionId: versionA2,
                controlId: "10000000-0000-4000-8000-000000000091",
                sequence: 2,
                controlCode: 32
              },
              {
                id: "10000000-0000-4000-8000-000000000013",
                courseVersionId: versionA2,
                controlId: "10000000-0000-4000-8000-000000000090",
                sequence: 1,
                controlCode: 31
              }
            ]
          },
          { id: versionA1, courseId: courseA, version: 1, createdAt: "2026-08-29T00:00:00.000Z", controls: [] }
        ]
      }
    ],
    entries: [
      { id: entryB, raceId: ids.race, classId: classB, givenName: "B", familyName: "B" },
      { id: entryA, raceId: ids.race, classId: classA, givenName: "A", familyName: "A" }
    ],
    cardAssignments: [
      { id: "10000000-0000-4000-8000-000000000080", raceId: ids.race, entryId: entryB, cardNumber: "80", active: true },
      { id: "10000000-0000-4000-8000-000000000070", raceId: ids.race, entryId: entryA, cardNumber: "70", active: true }
    ],
    classControlNeutralizations: []
  };
}

describe("RS256-stationspaket", () => {
  it("signerar samma payload deterministiskt och verifierar exakta bytes", () => {
    const key = keyPair();
    const first = signStationPackagePayload(payload(key), key.privateKeyPem);
    const second = signStationPackagePayload(payload(key), key.privateKeyPem);
    expect(first).toEqual(second);
    expect(verifySignedStationPackage(first, key.publicKeySpkiBase64)).toEqual(payload(key));
  });

  it("ger samma payloadhash och signatur oberoende av snapshotfrågans radordning", () => {
    const key = keyPair();
    const firstSnapshot = permutedSnapshot();
    const secondSnapshot: RaceSnapshot = {
      ...firstSnapshot,
      classes: [...firstSnapshot.classes].reverse(),
      courses: [...firstSnapshot.courses].reverse().map((course) => ({
        ...course,
        versions: [...course.versions].reverse().map((version) => ({
          ...version,
          controls: [...version.controls].reverse()
        }))
      })),
      entries: [...firstSnapshot.entries].reverse(),
      cardAssignments: [...firstSnapshot.cardAssignments].reverse()
    };
    const firstPayload = { ...payload(key), raceSnapshot: sortRaceSnapshotForPackage(firstSnapshot) };
    const secondPayload = { ...payload(key), raceSnapshot: sortRaceSnapshotForPackage(secondSnapshot) };

    expect(stationPackagePayloadHash(firstPayload)).toBe(stationPackagePayloadHash(secondPayload));
    expect(signStationPackagePayload(firstPayload, key.privateKeyPem))
      .toEqual(signStationPackagePayload(secondPayload, key.privateKeyPem));
    expect(firstSnapshot.classes[0]?.id).not.toBe(firstPayload.raceSnapshot.classes[0]?.id);
  });

  it("avvisar manipulation av payload, signatur, key-id och betrodd nyckel", () => {
    const key = keyPair();
    const otherKey = keyPair();
    const envelope = signStationPackagePayload(payload(key), key.privateKeyPem);
    const changedPayload = Buffer.from(envelope.payload, "base64url");
    changedPayload[changedPayload.length - 1] = changedPayload[changedPayload.length - 1]! ^ 1;
    const changedSignature = Buffer.from(envelope.signature, "base64url");
    changedSignature[0] = changedSignature[0]! ^ 1;

    expect(() => verifySignedStationPackage({
      ...envelope, payload: changedPayload.toString("base64url")
    }, key.publicKeySpkiBase64)).toThrow("signatur");
    expect(() => verifySignedStationPackage({
      ...envelope, signature: changedSignature.toString("base64url")
    }, key.publicKeySpkiBase64)).toThrow("signatur");
    expect(() => verifySignedStationPackage({ ...envelope, keyId: "0".repeat(64) }, key.publicKeySpkiBase64))
      .toThrow("key-id");
    expect(() => verifySignedStationPackage(envelope, otherKey.publicKeySpkiBase64)).toThrow("key-id");
  });

  it("avvisar RSA-nycklar under 2048 bit och en inbäddad annan nyckel", () => {
    const key = keyPair();
    const weakKey = keyPair(1024);
    expect(() => signStationPackagePayload(payload(weakKey), weakKey.privateKeyPem)).toThrow("RSA-2048");
    expect(() => signStationPackagePayload(payload(key), keyPair().privateKeyPem)).toThrow("matchar inte");
  });
});
