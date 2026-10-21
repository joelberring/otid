import type { HelpArticle, HelpView } from "../i18n/help-sv";

/** Gemener utan accenter: å, ä och ö blir a, a och o (även æ och ø), så att "lasa" hittar "läsa" och tvärtom. */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sv-SE").replace(/æ/g, "a").replace(/ø/g, "o");
}

/** Artikelns rubrik och text som en sökbar sträng (citattecknen kring knappnamnen tas bort). */
export function helpArticleText(article: HelpArticle): string {
  return [article.title, ...article.body.flat()].join(" ").replace(/[”“]/g, "");
}

export type HelpListing = {
  /** Artiklarna för vyn man står i. */
  here: readonly HelpArticle[];
  /** Alla andra. */
  rest: readonly HelpArticle[];
};

/**
 * Hjälppanelens listor (PLAN.md steg 37): först artiklarna för vyn, sedan resten i samma ordning som i i18n-filen.
 * Med en sökning: bara artiklar där alla ord i sökningen finns i rubriken eller texten, i lokalt minne.
 */
export function listHelpArticles(articles: readonly HelpArticle[], view: HelpView, query = ""): HelpListing {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  const matches = words.length === 0 ? articles : articles.filter(article => {
    const text = foldForSearch(helpArticleText(article));
    return words.every(word => text.includes(word));
  });
  return { here: matches.filter(article => article.views.includes(view)), rest: matches.filter(article => !article.views.includes(view)) };
}
