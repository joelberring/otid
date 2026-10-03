import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject
} from "node:crypto";
import {
  canonicalJsonBytes,
  signedStationPackageEnvelopeSchema,
  stationPackagePayloadSchema,
  type SignedStationPackageEnvelope,
  type StationPackagePayload
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { eq } from "drizzle-orm";
import { lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot, sortRaceSnapshotForPackage } from "./snapshot";

interface ValidatedSigningKey {
  privateKey: KeyObject;
  publicKeySpkiBase64: string;
  keyId: string;
}

function assertRsa2048OrStronger(key: KeyObject): void {
  if (key.asymmetricKeyType !== "rsa") throw new Error("Signing key måste vara en RSA-nyckel");
  const modulusLength = key.asymmetricKeyDetails?.modulusLength;
  if (typeof modulusLength !== "number" || modulusLength < 2048) {
    throw new Error("Signing key måste vara minst RSA-2048");
  }
}

function keyIdForSpki(spkiDer: Uint8Array): string {
  return createHash("sha256").update(spkiDer).digest("hex");
}

function validatedPrivateSigningKey(privateKeyPem: string): ValidatedSigningKey {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error("Signing key är inte en giltig privat PEM-nyckel");
  }
  assertRsa2048OrStronger(privateKey);
  const publicKey = createPublicKey(privateKey);
  assertRsa2048OrStronger(publicKey);
  const publicKeySpkiDer = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicKeySpkiBase64: publicKeySpkiDer.toString("base64"),
    keyId: keyIdForSpki(publicKeySpkiDer)
  };
}

function validatedTrustedPublicKey(publicKeySpkiBase64: string): {
  publicKey: KeyObject;
  publicKeySpkiDer: Buffer;
  keyId: string;
} {
  let publicKeySpkiDer: Buffer;
  let publicKey: KeyObject;
  try {
    publicKeySpkiDer = Buffer.from(publicKeySpkiBase64, "base64");
    if (publicKeySpkiDer.length === 0 || publicKeySpkiDer.toString("base64") !== publicKeySpkiBase64) {
      throw new Error("Icke-kanonisk Base64");
    }
    publicKey = createPublicKey({ key: publicKeySpkiDer, format: "der", type: "spki" });
  } catch {
    throw new Error("Betrodd verifieringsnyckel är inte giltig SPKI-DER i Base64");
  }
  assertRsa2048OrStronger(publicKey);
  return { publicKey, publicKeySpkiDer, keyId: keyIdForSpki(publicKeySpkiDer) };
}

function equalPublicValue(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function decodeBase64Url(value: string, description: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    throw new Error(`${description} är inte canonical Base64URL`);
  }
  return decoded;
}

function signValidatedPayload(
  payload: StationPackagePayload,
  signingKey: ValidatedSigningKey
): SignedStationPackageEnvelope {
  if (!equalPublicValue(payload.verificationKey.keyId, signingKey.keyId) ||
      !equalPublicValue(payload.verificationKey.publicKeySpkiBase64, signingKey.publicKeySpkiBase64)) {
    throw new Error("Payloadens verifieringsnyckel matchar inte signing key");
  }
  const payloadBytes = canonicalJsonBytes(payload);
  const signature = sign("sha256", payloadBytes, {
    key: signingKey.privateKey,
    padding: constants.RSA_PKCS1_PADDING
  });
  return signedStationPackageEnvelopeSchema.parse({
    formatVersion: 1,
    algorithm: "RS256",
    keyId: signingKey.keyId,
    payload: Buffer.from(payloadBytes).toString("base64url"),
    signature: signature.toString("base64url")
  });
}

export function signStationPackagePayload(
  input: StationPackagePayload,
  privateKeyPem: string
): SignedStationPackageEnvelope {
  const payload = stationPackagePayloadSchema.parse(input);
  return signValidatedPayload(payload, validatedPrivateSigningKey(privateKeyPem));
}

export function stationPackagePayloadHash(input: StationPackagePayload): string {
  const payload = stationPackagePayloadSchema.parse(input);
  return createHash("sha256").update(canonicalJsonBytes(payload)).digest("hex");
}

export async function buildSignedStationPackage(
  db: Database,
  raceId: string,
  privateKeyPem: string
): Promise<SignedStationPackageEnvelope> {
  const signingKey = validatedPrivateSigningKey(privateKeyPem);
  const payload = await db.transaction(async (tx): Promise<StationPackagePayload> => {
    await lockRaceForSnapshot(tx, raceId);
    const raceSnapshot = sortRaceSnapshotForPackage(await loadRaceSnapshot(tx, raceId));
    const [event] = await tx.select({
      id: schema.events.id,
      name: schema.events.name,
      startsOn: schema.events.startsOn,
      timeZone: schema.events.timeZone
    }).from(schema.events).where(eq(schema.events.id, raceSnapshot.race.eventId));
    if (!event) throw new Error("Evenemanget finns inte");
    return stationPackagePayloadSchema.parse({
      formatVersion: 1,
      raceId: raceSnapshot.race.id,
      packageVersion: raceSnapshot.race.snapshotVersion,
      resultEngineVersion: RESULT_ENGINE_VERSION,
      stationFunction: "READOUT",
      event,
      raceSnapshot,
      verificationKey: {
        algorithm: "RS256",
        keyId: signingKey.keyId,
        publicKeySpkiBase64: signingKey.publicKeySpkiBase64
      }
    });
  });
  return signValidatedPayload(payload, signingKey);
}

export function verifySignedStationPackage(
  input: SignedStationPackageEnvelope,
  trustedPublicKeySpkiBase64: string
): StationPackagePayload {
  const envelope = signedStationPackageEnvelopeSchema.parse(input);
  const trustedKey = validatedTrustedPublicKey(trustedPublicKeySpkiBase64);
  if (!equalPublicValue(envelope.keyId, trustedKey.keyId)) {
    throw new Error("Paketets key-id matchar inte den betrodda nyckeln");
  }

  const payloadBytes = decodeBase64Url(envelope.payload, "Payloaden");
  const signatureBytes = decodeBase64Url(envelope.signature, "Signaturen");
  if (!verify("sha256", payloadBytes, {
    key: trustedKey.publicKey,
    padding: constants.RSA_PKCS1_PADDING
  }, signatureBytes)) {
    throw new Error("Paketets signatur är ogiltig");
  }

  let decodedPayload: unknown;
  try {
    decodedPayload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    throw new Error("Paketets signerade payload är inte giltig UTF-8-JSON");
  }
  const payload = stationPackagePayloadSchema.parse(decodedPayload);
  const canonicalBytes = canonicalJsonBytes(payload);
  if (canonicalBytes.length !== payloadBytes.length || !timingSafeEqual(canonicalBytes, payloadBytes)) {
    throw new Error("Paketets signerade payload är inte canonical JSON");
  }
  if (!equalPublicValue(payload.verificationKey.keyId, trustedKey.keyId) ||
      !equalPublicValue(payload.verificationKey.publicKeySpkiBase64, trustedKey.publicKeySpkiDer.toString("base64"))) {
    throw new Error("Payloadens verifieringsnyckel matchar inte den betrodda nyckeln");
  }
  return payload;
}
