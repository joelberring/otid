/**
 * Sparar ett nedladdat svar som fil efter att innehållets SHA-256 stämt med det väntade. Ingen kontroll av content-length:
 * en proxy med komprimering (Caddy) tar bort eller ändrar den. Hashen över det uppackade innehållet räcker.
 * `beforeSave` kastar om anropet inte längre är aktuellt.
 */
export async function saveVerifiedDownload(response: Response, filename: string, expectedHash: string | undefined, beforeSave: () => void,
  type = "application/xml;charset=utf-8"): Promise<void> {
  const buffer = await response.arrayBuffer();
  if (expectedHash !== undefined) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== expectedHash) throw new Error("Export hash mismatch");
  }
  beforeSave();
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type }));
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl; anchor.download = filename; anchor.rel = "noopener";
    document.body.append(anchor); anchor.click(); anchor.remove();
  } finally { URL.revokeObjectURL(objectUrl); }
}
