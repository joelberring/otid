"use client";

import { useState } from "react";
import { accessSv } from "../i18n/access-sv";
import { accessEn } from "../i18n/access-en";
import { accountRequest } from "../lib/account-client";
import { useTexts } from "./language-provider";
import { Button, Notice } from "./ui";

/**
 * Användartestet 2026-11-12: en inloggad med obekräftad adress får ett mejl med en länk där hen väljer lösenord. Det är
 * återställningslänken, som bekräftar adressen och tar inbjudningarna (ADR-0186, ADR-0205); inbjudningslänken gör det inte
 * (ADR-0206 beslut 4 och tillägget 2026-11-12).
 */
export function VerifyEmailOffer({ email }: { email: string }) {
  const text = useTexts(accessSv, accessEn);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "mail-off" | "failed">("idle");
  async function send() {
    setState("sending");
    try {
      const response = await accountRequest("/api/account/password-reset", { method: "POST", body: { formatVersion: 1, email } });
      setState(response.status === 202 ? "sent" : response.status === 503 ? "mail-off" : "failed");
    } catch { setState("failed"); }
  }
  return <div data-testid="verify-email-offer">
    <p>{text.confirmHow}</p>
    {state !== "sent" && state !== "mail-off" && <Button onClick={() => void send()} disabled={state === "sending"}>
      {state === "sending" ? text.sending : text.send}</Button>}
    {state === "sent" && <Notice tone="ok" role="status">{text.sent(email)}</Notice>}
    {state === "mail-off" && <Notice tone="info" role="status">{text.mailOff}</Notice>}
    {state === "failed" && <Notice tone="error" role="alert">{text.failed}</Notice>}
  </div>;
}
