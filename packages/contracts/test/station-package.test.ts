import { describe, expect, it } from "vitest";
import {
  canonicalJsonBytes,
  signedStationPackageEnvelopeSchema,
  STATION_PACKAGE_LIMITS,
  stationPackagePayloadSchema
} from "../src";

const ids = {
  event: "10000000-0000-4000-8000-000000000001",
  race: "10000000-0000-4000-8000-000000000002"
};

function payload() {
  return {
    formatVersion: 1 as const,
    raceId: ids.race,
    packageVersion: 3,
    resultEngineVersion: "0.1.0",
    stationFunction: "READOUT" as const,
    event: {
      id: ids.event,
      name: "Testtävling",
      startsOn: "2026-08-30",
      timeZone: "Europe/Stockholm"
    },
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
      algorithm: "RS256" as const,
      keyId: "a".repeat(64),
      publicKeySpkiBase64: "AQ=="
    }
  };
}

describe("canonical JSON-bytes", () => {
  it("sorterar objektnycklar rekursivt men bevarar arrayordning", () => {
    const first = canonicalJsonBytes({ z: 1, a: [3, { b: "å", a: null }] });
    const second = canonicalJsonBytes({ a: [3, { a: null, b: "å" }], z: 1 });
    expect(first).toEqual(second);
    expect(new TextDecoder().decode(first)).toBe('{"a":[3,{"a":null,"b":"å"}],"z":1}');
    expect(new TextDecoder().decode(canonicalJsonBytes({ a: [2, 1] })))
      .not.toBe(new TextDecoder().decode(canonicalJsonBytes({ a: [1, 2] })));
  });

  it.each([
    ["flyttal", { value: 1.5 }],
    ["undefined", { value: undefined }],
    ["icke-JSON-objekt", { value: new Date("2026-08-30T00:00:00Z") }],
    ["gles array", { value: Array(1) }]
  ])("avvisar %s", (_description, value) => {
    expect(() => canonicalJsonBytes(value)).toThrow();
  });
});

describe("stationspaketkontrakt", () => {
  it("accepterar en strikt och självkonsistent payload", () => {
    expect(stationPackagePayloadSchema.parse(payload())).toEqual(payload());
  });

  it("avvisar extra fält och motsägande race-, event- eller paketversion", () => {
    expect(stationPackagePayloadSchema.safeParse({ ...payload(), extra: true }).success).toBe(false);
    expect(stationPackagePayloadSchema.safeParse({ ...payload(), raceId: crypto.randomUUID() }).success).toBe(false);
    expect(stationPackagePayloadSchema.safeParse({ ...payload(), packageVersion: 4 }).success).toBe(false);
    expect(stationPackagePayloadSchema.safeParse({
      ...payload(), event: { ...payload().event, id: crypto.randomUUID() }
    }).success).toBe(false);
  });

  it("kräver RS256 och Base64URL utan padding i det strikta kuvertet", () => {
    const envelope = {
      formatVersion: 1,
      algorithm: "RS256",
      keyId: "a".repeat(64),
      payload: "eyJhIjoxfQ",
      signature: "AQID"
    };
    expect(signedStationPackageEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(signedStationPackageEnvelopeSchema.safeParse({ ...envelope, payload: "AQ==" }).success).toBe(false);
    expect(signedStationPackageEnvelopeSchema.safeParse({ ...envelope, algorithm: "ES256" }).success).toBe(false);
    expect(signedStationPackageEnvelopeSchema.safeParse({ ...envelope, extra: true }).success).toBe(false);
  });

  it("avvisar kuvert och payloadfält över dokumenterade ändliga gränser", () => {
    expect(stationPackagePayloadSchema.safeParse({
      ...payload(), resultEngineVersion: "x".repeat(65)
    }).success).toBe(false);
    expect(stationPackagePayloadSchema.safeParse({
      ...payload(),
      verificationKey: {
        ...payload().verificationKey,
        publicKeySpkiBase64: "A".repeat(STATION_PACKAGE_LIMITS.publicKeySpkiBase64Characters + 1)
      }
    }).success).toBe(false);
    expect(signedStationPackageEnvelopeSchema.safeParse({
      formatVersion: 1,
      algorithm: "RS256",
      keyId: "a".repeat(64),
      payload: "A".repeat(STATION_PACKAGE_LIMITS.envelopePayloadCharacters + 1),
      signature: "AQID"
    }).success).toBe(false);
  });
});
