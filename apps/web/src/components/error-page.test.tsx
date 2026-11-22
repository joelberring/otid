import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorPage } from "./error-page";

(globalThis as { React?: typeof React }).React = React;

describe("felsidan", () => {
  it("är på svenska med «Försök igen» och en länk till startsidan", () => {
    const html = renderToStaticMarkup(<ErrorPage error={Object.assign(new Error("x"), { digest: "abc" })} reset={() => undefined} language="sv" />);
    expect(html).toContain("Något gick fel");
    expect(html).toContain("Försök igen");
    expect(html).toContain('href="/"');
    expect(html).toContain("Felkod: abc");
  });
  it("har en engelsk version", () => {
    const html = renderToStaticMarkup(<ErrorPage error={new Error("x")} reset={() => undefined} language="en" />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
  });
});
