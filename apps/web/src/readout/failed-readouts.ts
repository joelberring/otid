/**
 * Steg 31: avläsningar vars tider inte gick att tolka ens med datorns klocka. De kan inte köas (servern kräver tolkade
 * tider) men får inte försvinna: kortnummer, tid och råramar sparas i webbläsaren och visas tills funktionären tagit bort
 * dem, så att brickan kan läsas om eller tiden anges manuellt i deltagarkortet.
 */
export interface FailedReadout {
  readonly cardNumber: string;
  readonly at: string;
  readonly message: string;
  readonly frames: readonly string[];
}

const key = (raceId: string) => `otid-readout-failed:${raceId}`;

export function loadFailedReadouts(raceId: string): FailedReadout[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key(raceId)) ?? "[]");
    return Array.isArray(value) ? value.filter((row): row is FailedReadout => typeof row === "object" && row !== null &&
      typeof (row as FailedReadout).cardNumber === "string" && typeof (row as FailedReadout).at === "string") : [];
  } catch (error) {
    console.warn("Avläsningar som inte kunde tolkas kunde inte läsas", error);
    return [];
  }
}

export function saveFailedReadouts(raceId: string, rows: readonly FailedReadout[]): void {
  try { window.localStorage.setItem(key(raceId), JSON.stringify(rows.slice(-50))); }
  catch (error) { console.warn("Avläsningen som inte kunde tolkas kunde inte sparas", error); }
}
