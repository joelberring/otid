/** Read only explicitly supplied server configuration; never forward to a client. */
export function eventorMasterKeyFromEnvironment(environment: Record<string, string | undefined>): {
  keyId: string; masterKey: Uint8Array;
} {
  const keyId = environment.OTID_EVENTOR_MASTER_KEY_ID;
  const encoded = environment.OTID_EVENTOR_MASTER_KEY_BASE64;
  if (!keyId || keyId.trim() !== keyId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)
    || !encoded || encoded.length !== 44 || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("EVENTOR_CONFIGURATION_INVALID");
  }
  const masterKey = Buffer.from(encoded, "base64");
  if (masterKey.length !== 32 || masterKey.toString("base64") !== encoded) {
    masterKey.fill(0);
    throw new Error("EVENTOR_CONFIGURATION_INVALID");
  }
  return { keyId, masterKey };
}

/** CLI-only input: exactly one key line, optionally terminated by LF/CRLF. */
export async function readEventorApiKeyInput(input: AsyncIterable<Uint8Array>): Promise<string> {
  const bytes = Buffer.alloc(34);
  let length = 0;
  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array) || length + chunk.byteLength > bytes.length) throw new Error("EVENTOR_KEY_INPUT_INVALID");
      bytes.set(chunk, length);
      length += chunk.byteLength;
    }
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)).replace(/\r?\n$/, "");
    if (value.length !== 32 || !/^[\x21-\x7e]{32}$/.test(value)) throw new Error("EVENTOR_KEY_INPUT_INVALID");
    return value;
  } catch {
    throw new Error("EVENTOR_KEY_INPUT_INVALID");
  } finally {
    bytes.fill(0);
  }
}
