import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { helpArticles, helpSv } from "../../i18n/help-sv";
import { helpArticlesEnById, helpEn, helpSynonymsEn } from "../../i18n/help-en";
import { LanguageProvider } from "../language-provider";
import { HelpDialogBody } from "./help-dialog";
import { findHelpMeta, HELP_ARTICLE_META, helpMetaText } from "./help-meta";
import { HelpButton, HelpLink, loadHelpData } from "./help-panel";

(globalThis as { React?: typeof React }).React = React;

const fileSource = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("help-meta och lat laddning av HelpDialog", () => {
  it("håller help-meta.ts i exakt paritet med help-sv.ts och help-en.ts (id, ordning, titlar och vyer)", () => {
    expect(HELP_ARTICLE_META.length).toBe(helpArticles.length);
    for (let i = 0; i < helpArticles.length; i += 1) {
      const sv = helpArticles[i]!;
      const meta = HELP_ARTICLE_META[i]!;
      const enTitle = helpArticlesEnById.get(sv.id)?.title ?? sv.title;
      expect(meta.id, `ordning vid index ${i}`).toBe(sv.id);
      expect(meta.sv, sv.id).toBe(sv.title);
      expect(meta.en, sv.id).toBe(enTitle);
      expect(meta.views, sv.id).toEqual(sv.views);
      expect(findHelpMeta(sv.id)).toBe(meta);
    }
    expect(helpMetaText.sv.button).toBe(helpSv.button);
    expect(helpMetaText.sv.title).toBe(helpSv.title);
    expect(helpMetaText.sv.close).toBe(helpSv.close);
    expect(helpMetaText.sv.link("Banor")).toBe(helpSv.link("Banor"));
    expect(helpMetaText.en.button).toBe(helpEn.button);
    expect(helpMetaText.en.title).toBe(helpEn.title);
    expect(helpMetaText.en.close).toBe(helpEn.close);
    expect(helpMetaText.en.link("Courses")).toBe(helpEn.link("Courses"));
  });

  it("importerar aldrig help-sv, help-en, help-dialog eller help-search statiskt vid sidladdning", () => {
    const panelSource = fileSource("./help-panel.tsx");
    const metaSource = fileSource("./help-meta.ts");
    const searchSource = fileSource("../../lib/help-search.ts");
    // Endast typimporter och dynamiska import(...) är tillåtna mot stora hjälpmoduler.
    const staticValueImports = (src: string) =>
      [...src.matchAll(/^import\s+(?!type\b)[^;\n]+from\s+["']([^"']+)["']/gm)].map(match => match[1]!);
    expect(staticValueImports(panelSource)).not.toContain("../../i18n/help-sv");
    expect(staticValueImports(panelSource)).not.toContain("../../i18n/help-en");
    expect(staticValueImports(panelSource)).not.toContain("./help-dialog");
    expect(staticValueImports(panelSource)).not.toContain("../../lib/help-search");
    expect(staticValueImports(metaSource)).toEqual([]);
    expect(staticValueImports(searchSource)).not.toContain("../i18n/help-sv");
    expect(staticValueImports(searchSource)).not.toContain("../i18n/help-en");
  });

  it("renderar HelpButton och HelpLink med korrekta etiketter på svenska och engelska utan att montera dialogen", () => {
    const svButton = renderToStaticMarkup(<HelpButton view="EVENTS" compact />);
    expect(svButton).toContain('data-testid="help-button"');
    expect(svButton).toContain('aria-label="Hjälp"');
    expect(svButton).toContain('title="Hjälp"');
    expect(svButton).not.toContain('data-testid="help-panel"');

    const enButton = renderToStaticMarkup(
      <LanguageProvider language="en"><HelpButton view="EVENTS" compact large /></LanguageProvider>
    );
    expect(enButton).toContain('aria-label="Help"');
    expect(enButton).toContain('title="Help"');
    expect(enButton).not.toContain('data-testid="help-panel"');

    const svLink = renderToStaticMarkup(<HelpLink article="niva-gron" />);
    expect(svLink).toContain('data-help-link="niva-gron"');
    expect(svLink).toContain('aria-label="Hjälp: Så lägger du en grön bana"');
    expect(svLink).toContain('title="Hjälp: Så lägger du en grön bana"');

    const enLink = renderToStaticMarkup(
      <LanguageProvider language="en"><HelpLink article="niva-gron" label="How to set a green course?" /></LanguageProvider>
    );
    expect(enLink).toContain('title="Help: How to set a green course"');
    expect(enLink).toContain(">How to set a green course?</button>");

    expect(() => renderToStaticMarkup(React.createElement(HelpLink, { article: "finns-inte" }))).toThrow("finns-inte");
  });

  it("laddar bara respektive språks hjälpartiklar via loadHelpData och renderar HelpDialogBody komplett", async () => {
    const sv = await loadHelpData(false);
    expect(sv.text.title).toBe(helpSv.title);
    expect(sv.articles.map(row => row.id)).toEqual(helpArticles.map(row => row.id));
    expect(sv.englishIds).toBeUndefined();

    const en = await loadHelpData(true);
    expect(en.text.title).toBe(helpEn.title);
    expect(en.synonyms).toBe(helpSynonymsEn);
    expect(en.articles.map(row => row.id)).toEqual(helpArticles.map(row => row.id));
    expect(en.articles.find(row => row.id === "niva-gron")?.title).toBe("How to set a green course");

    const svBody = renderToStaticMarkup(
      <HelpDialogBody data={sv} views={["CS_COURSES"]} first="niva-gron" titleId="help-title" onRequestClose={() => undefined} />
    );
    expect(svBody).toContain('id="help-title"');
    expect(svBody).toContain('data-help-article="niva-gron"');
    expect(svBody).toContain("Så lägger du en grön bana");
    expect(svBody).toContain("Sök i hjälpen");

    const enBody = renderToStaticMarkup(
      <HelpDialogBody data={en} views={["PUBLISH"]} titleId="help-title-en" onRequestClose={() => undefined} />
    );
    expect(enBody).toContain("Help for this page");
    expect(enBody).toContain("Publish the event");
    expect(enBody).toContain("Search the help");
  });
});
