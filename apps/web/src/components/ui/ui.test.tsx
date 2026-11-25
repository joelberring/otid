import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ConfirmDialog, Notice, PromptDialog } from "./index";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

describe("Button", () => {
  it("stöder danger-variant med egen klass och type=button som förval", () => {
    const primary = renderToStaticMarkup(<Button>Spara</Button>);
    const danger = renderToStaticMarkup(<Button variant="danger">Ta bort</Button>);
    expect(danger).toMatch(/^<button type="button"/);
    expect(danger).toContain("danger");
    expect(primary).not.toContain("danger");
    expect(danger).toContain(">Ta bort</button>");
  });
});

describe("Notice", () => {
  it("ger automatisk live-region för error, ok och attention men inte för info", () => {
    expect(renderToStaticMarkup(<Notice tone="error">Fel</Notice>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Notice tone="ok">Sparat</Notice>)).toContain('role="status"');
    expect(renderToStaticMarkup(<Notice tone="attention">Kontrollera</Notice>)).toContain('role="status"');
    expect(renderToStaticMarkup(<Notice>Info</Notice>)).not.toContain("role=");
  });

  it("respekterar uttrycklig role och role={null}", () => {
    expect(renderToStaticMarkup(<Notice tone="error" role={null}>Tyst fel</Notice>)).not.toContain("role=");
    expect(renderToStaticMarkup(<Notice tone="attention" role="alert">Brådskande</Notice>)).toContain('role="alert"');
  });
});

describe("ConfirmDialog", () => {
  it("ritar dialog med rubrik, beskrivning, domänknapp, Avbryt och danger-variant", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog title="Ta bort behörighet" message="Frida mister åtkomsten direkt." confirmLabel="Ta bort" danger
        testId="confirm-remove" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(html).toMatch(/^<dialog /);
    expect(html).toContain('data-testid="confirm-remove"');
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("aria-describedby=");
    expect(html).toContain("Ta bort behörighet");
    expect(html).toContain("Frida mister åtkomsten direkt.");
    expect(html).toContain(">Avbryt</button>");
    expect(html).toContain(">Ta bort</button>");
    expect(html).toContain("danger");
  });

  it("utelämnar aria-describedby utan meddelande och stöder egen avbryt-text", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog title="Avsluta?" confirmLabel="Avsluta" cancelLabel="Stanna" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(html).not.toContain("aria-describedby=");
    expect(html).toContain(">Stanna</button>");
    expect(html).not.toContain("danger");
  });
});

describe("PromptDialog", () => {
  it("ritar formulär med inmatningsfält och inaktiverar bekräftelse när fältet är tomt", () => {
    const html = renderToStaticMarkup(
      <PromptDialog title="Ångra köp" label="Orsak" placeholder="t.ex. fel enhet" maxLength={300}
        confirmLabel="Ångra" danger testId="void-dialog" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(html).toMatch(/^<dialog /);
    expect(html).toContain('data-testid="void-dialog"');
    expect(html).toContain("<form ");
    expect(html).toContain("Orsak");
    expect(html).toContain('placeholder="t.ex. fel enhet"');
    expect(html).toContain('maxLength="300"');
    expect(html).toContain('type="submit"');
    expect(html).toContain("disabled");
    expect(html).toContain("danger");
  });

  it("aktiverar bekräftelseknappen när defaultValue har innehåll", () => {
    const html = renderToStaticMarkup(
      <PromptDialog title="Ny karta" label="Kartans namn" defaultValue="Nackareservatet"
        confirmLabel="Flytta" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(html).toContain('value="Nackareservatet"');
    expect(html).not.toContain("disabled");
  });
});
