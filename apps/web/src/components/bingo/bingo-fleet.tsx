"use client";

import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { useTexts } from "../language-provider";
import styles from "./bingo.module.css";

/** Ett skepp i flottlistan: längden och om löparen själv har sänkt det. */
export interface FleetShip { readonly length: number; readonly sunk: boolean }

/**
 * Flottlistan (ägaren 2026-11-16): vilka skepp som finns, gemensamma och egna, som små rutor per skepp. Rutorna fylls när
 * löparen själv har sänkt skeppet; listan säger inget om läget.
 */
export function BingoFleet({ shared, own, dark }: { shared: readonly FleetShip[]; own: readonly FleetShip[]; dark?: boolean }) {
  const text = useTexts(bingoSv.ships, bingoEn.ships);
  if (shared.length + own.length === 0) return null;
  const row = (label: string, ships: readonly FleetShip[], kind: string) => ships.length > 0 && <div className={styles.fleetRow}>
    <span>{label}</span>
    <span className={styles.fleetShips}>{ships.map((ship, index) => <span key={index} className={styles.fleetShip} data-sunk={ship.sunk || undefined}
      data-testid={`fleet-${kind}`} aria-label={ship.sunk ? text.fleetSunk(ship.length) : text.fleetAfloat(ship.length)}>
      {Array.from({ length: ship.length }, (_, cell) => <span key={cell} aria-hidden="true" />)}</span>)}</span>
  </div>;
  return <section className={dark ? styles.fleetDark : styles.fleet} aria-label={text.fleet}>
    <p>{text.fleetText(shared.map(ship => ship.length), own.map(ship => ship.length))}</p>
    {row(text.fleetShared, shared, "shared")}
    {row(text.fleetOwn, own, "own")}
  </section>;
}
