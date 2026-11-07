import { z } from "zod";

/** Ett UUID av version 1–8 i gemener; den enda definitionen för server och klient (steg 23). */
export const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`);
export const uuidSchema = z.string().regex(UUID_PATTERN);
/** `<prefix>:<uuid>`, formen för idempotensnycklar. */
export const prefixedUuidPattern = (prefix: string): RegExp => new RegExp(`^${prefix}:${UUID_SOURCE}$`);
/** Lösare än `UUID_PATTERN`: vilken version som helst, för id från enheter, äldre rader och id som söks i text. */
export const ANY_UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const ANY_UUID_PATTERN = new RegExp(`^${ANY_UUID_SOURCE}$`);

/** En SHA-256 som hex i gemener (64 tecken). */
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
export const sha256HexSchema = z.string().regex(SHA256_HEX_PATTERN);
