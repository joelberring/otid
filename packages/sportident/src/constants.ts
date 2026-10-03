/**
 * Konstanter för SPORTidents utökade protokoll (extended protocol).
 *
 * Värdena är fakta om protokollet, sammanställda från SPORTidents publika
 * dokumentation och öppna beskrivningar (se ADR-0168). Ingen kod är kopierad.
 */

export const STX = 0x02;
export const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;
export const WAKEUP = 0xff;

/** Kommandokoder i utökat protokoll. */
export const Command = {
  GET_SYSTEM_VALUE: 0x83,
  SET_SYSTEM_VALUE: 0x82,
  READ_SI5: 0xb1,
  READ_SI6: 0xe1,
  READ_SI8_PLUS: 0xef,
  SI5_DETECTED: 0xe5,
  SI6_DETECTED: 0xe6,
  SI8_PLUS_DETECTED: 0xe8,
  CARD_REMOVED: 0xe7,
  SET_MASTER_SLAVE: 0xf0,
  GET_TIME: 0xf7,
  BEEP: 0xf9
} as const;

/** Parameter till SET_MASTER_SLAVE: arbeta mot den direktanslutna stationen. */
export const MASTER_DIRECT = 0x4d;

/** Blockparameter som ber stationen skicka alla relevanta block i följd. */
export const READ_ALL_BLOCKS = 0x08;

/** Offset i systemdata (svaret på GET_SYSTEM_VALUE 0x00 0x80). */
export const SystemOffset = {
  SERIAL_NUMBER: 0x00,
  MODE: 0x71,
  STATION_CODE: 0x72,
  PROTOCOL: 0x74
} as const;

/** Stationens arbetsläge (byte på offset MODE). */
export const StationMode = {
  CONTROL: 0x02,
  START: 0x03,
  FINISH: 0x04,
  READOUT: 0x05,
  CLEAR: 0x07,
  CHECK: 0x0a
} as const;

/** Två byte 0xEE 0xEE betyder "ingen tid" på brickan. */
export const NO_TIME = 0xeeee;

export const BLOCK_SIZE = 128;
