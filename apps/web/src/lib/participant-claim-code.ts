/** Create the one-time value and the only server-bound representation. */
export async function createParticipantClaimMaterial(): Promise<{ code: string; secretHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const code = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const secretHash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
  return { code, secretHash };
}
