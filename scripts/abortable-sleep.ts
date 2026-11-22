/**
 * Väntar `ms` eller tills `signal` avbryts. Lyssnaren på `signal` tas bort när väntan är slut, annars växer den med en per
 * varv (86 400 om dygnet) i en process med litet minnestak. `exposeWake` får en funktion som avslutar väntan i förtid.
 */
export function sleep(ms: number, signal: AbortSignal, exposeWake?: (wake: () => void) => void): Promise<void> {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    exposeWake?.(finish);
  });
}
