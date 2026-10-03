import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountRecovery } from "./account-recovery";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK161 account recovery UI", () => {
  it("serverrenderar en kompakt svensk återställningsvy utan genererat lösenord", () => {
    const html = renderToStaticMarkup(<AccountRecovery />);
    expect(html).toContain("Återställ lösenord");
    expect(html).toContain("fick privat efter identitetskontroll");
    expect(html).toContain('maxLength="43"');
    expect(html).not.toContain("Ditt nya lösenord");
  });

  it("skapar lösenord lokalt och kräver synlig sparbekräftelse före POST", () => {
    const component = source("./account-recovery.tsx");
    expect(component).toContain("crypto.getRandomValues(bytes)");
    expect(component).toContain("crypto.randomUUID()");
    expect(component).toContain("accountPasswordRecoveryRedeemRequestSchema.parse");
    expect(component).toContain("disabled={!acknowledged || busy}");
    expect(component).toContain("navigator.clipboard.writeText(attempt.request.password)");
    expect(component).toContain('fetch("/api/account/recovery"');
    expect(component).toContain("body: JSON.stringify(current.request)");
    expect(component).toContain('cache: "no-store"');
  });

  it("behåller exakt retry endast i minnet och rensar hemligheter vid sidbyte", () => {
    const component = source("./account-recovery.tsx");
    expect(component).toContain("attemptRef.current = next");
    expect(component).toContain("attemptRef.current !== current");
    expect(component).toContain('window.addEventListener("pagehide", clearSecrets)');
    expect(component).toContain("activeRequestRef.current?.abort()");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|console\.|analytics|setTimeout|setInterval/);
  });

  it("visar att gamla sessioner upphör och länkar vidare utan automatisk inloggning", () => {
    const component = source("./account-recovery.tsx");
    const page = source("../app/recover/page.tsx");
    expect(source("../i18n/account-recovery-sv.ts")).toContain("Äldre inloggningar har spärrats");
    expect(component).toContain('href="/organizer"');
    expect(component).toContain('href="/me"');
    expect(page).toContain("<AccountRecovery />");
    expect(component).not.toMatch(/setSession|setCookie|organizerAccountLogin/);
    expect(source("./organizer-workspace.tsx")).toContain('<Link href="/recover">{copy.forgotPassword}</Link>');
    expect(source("./participant-me.tsx")).toContain('<Link href="/recover">{text.forgotPassword}</Link>');
  });
});
