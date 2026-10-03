import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountActivation } from "./account-activation";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK159 account activation UI", () => {
  it("serverrenderar den svenska mottagarvyn och varnar om lösenordsåterställning", () => {
    const html = renderToStaticMarkup(<AccountActivation />);
    expect(html).toContain("Aktivera ditt konto");
    expect(html).toContain("Om du förlorar lösenordet finns ännu ingen självtjänståterställning");
    expect(html).toContain("Skapa mitt lösenord");
    expect(html).not.toContain("Ditt nya lösenord");
  });

  it("skapar ett kanoniskt 32-byte-lösenord och kräver bekräftelse före aktivering", () => {
    const component = source("./account-activation.tsx");
    expect(component).toContain("crypto.getRandomValues(bytes)");
    expect(component).toContain("crypto.randomUUID()");
    expect(component).toContain("accountInvitationActivationRequestSchema.parse");
    expect(component).toContain("disabled={!acknowledged || busy}");
    expect(component).toContain("navigator.clipboard.writeText(attempt.request.password)");
  });

  it("behåller exakt begäran för explicit retry och rensar minneshemligheter vid sidbyte", () => {
    const component = source("./account-activation.tsx");
    expect(component).toContain('fetch("/api/account/activation"');
    expect(component).toContain('cache: "no-store"');
    expect(component).toContain("body: JSON.stringify(current.request)");
    expect(component).toContain("onClick={() => void submit(attempt)}");
    expect(component).toContain('window.addEventListener("pagehide", clearSecrets)');
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|console\.|analytics|setTimeout|setInterval/);
  });

  it("bekräftar bara ett validerat svar och länkar till befintlig inloggning", () => {
    const component = source("./account-activation.tsx");
    expect(component).toContain("accountInvitationActivationResponseSchema.safeParse(value)");
    expect(component).toContain('href="/organizer"');
    expect(component).toContain('href="/me"');
    expect(component).toContain("Aktiveringen ger inte automatiskt åtkomst till tävlingar eller anmälningar.");
  });
});
