import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SymbolIcon, symbolIconUrl } from "./map-project-symbol-icon";

(globalThis as { React?: typeof React }).React = React;

describe("SymbolIcon (delad WeakMap<Blob, string>)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("skapar bara en objekt-URL per Blob och återanvänder den direkt vid rendering", () => {
    let counter = 0;
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:symbol-${++counter}`);
    const blobA = new Blob(["a"], { type: "image/png" });
    const blobB = new Blob(["b"], { type: "image/png" });

    expect(symbolIconUrl(undefined)).toBeUndefined();
    expect(symbolIconUrl(blobA)).toBe("blob:symbol-1");
    expect(symbolIconUrl(blobA)).toBe("blob:symbol-1");
    expect(symbolIconUrl(blobB)).toBe("blob:symbol-2");
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    const html = renderToStaticMarkup(<SymbolIcon icon={blobA} size={28} />);
    expect(html).toContain('<img src="blob:symbol-1"');
    expect(html).toContain('width="28"');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });
});
