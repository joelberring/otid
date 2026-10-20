import { Command } from "./constants";
import { cardReadPlan } from "./card-types";
import { cardImageFromResponses, CardDecodeError, decodeCard, type SiCardData } from "./decode";
import { FrameDecoder, type SiFrame } from "./frame";
import { detectCard } from "./readout-session";

/**
 * Steg 36: läser om en sparad avläsning från dess råramar (detekteringen och svaren, så som avläsningen sparade dem)
 * med den nuvarande avkodningen. Varje ram ska vara en hel, korrekt ram. Allt som inte går ihop (fel kontrollsumma,
 * avbruten ram, ingen detektering, saknade block, annat bricknummer) ger `CardDecodeError`; inga stämplingar hittas på.
 */
export function decodeRecordedFrames(frames: readonly Uint8Array[]): SiCardData {
  const parsed: SiFrame[] = [];
  frames.forEach((bytes, index) => {
    const decoder = new FrameDecoder();
    const events = decoder.push(bytes);
    const frame = events.length === 1 && events[0]!.kind === "frame" ? events[0]!.frame : undefined;
    if (!frame || decoder.pendingBytes > 0) {
      const error = events.find((event) => event.kind === "error");
      throw new CardDecodeError(error?.kind === "error" && error.reason === "crc" ? `Fel kontrollsumma i ram ${index + 1}`
        : `Ram ${index + 1} är inte en hel ram`);
    }
    parsed.push(frame);
  });
  const detectionIndex = parsed.findIndex((frame) => detectCard(frame) !== undefined);
  const detected = detectionIndex < 0 ? undefined : detectCard(parsed[detectionIndex]!);
  if (!detected) throw new CardDecodeError("Detekteringsramen saknas");
  if (!detected.cardType) throw new CardDecodeError(`Bricktypen stöds inte: ${detected.cardNumber}`);
  const commands = new Set(cardReadPlan(detected.cardType).map((step) => step.command));
  const responses = parsed.slice(detectionIndex + 1)
    .filter((frame) => frame.command !== Command.CARD_REMOVED && commands.has(frame.command)).map((frame) => frame.data);
  if (responses.length === 0) throw new CardDecodeError("Brickans block saknas");
  const card = decodeCard(detected.cardType, cardImageFromResponses(detected.cardType, responses));
  if (card.cardNumber !== detected.cardNumber) {
    throw new CardDecodeError(`Bricknumret i blocken (${card.cardNumber}) stämmer inte med detekteringen (${detected.cardNumber})`);
  }
  return card;
}

/** Hex utan mellanrum (så som råramarna sparas) till bytes; `CardDecodeError` för annat än jämnt antal hexsiffror. */
export function framesFromHex(frames: readonly string[]): Uint8Array[] {
  return frames.map((value, index) => {
    if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new CardDecodeError(`Ram ${index + 1} är inte hex`);
    return Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
  });
}
