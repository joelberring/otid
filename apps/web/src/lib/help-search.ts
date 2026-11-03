import { helpSynonyms, type HelpArticle, type HelpBlock, type HelpView } from "../i18n/help-sv";

/** Gemener utan accenter: å, ä och ö blir a, a och o (även æ och ø), så att "lasa" hittar "läsa" och tvärtom. */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sv-SE").replace(/æ/g, "a").replace(/ø/g, "o");
}

/** En länk till en annan artikel i texten: `[text](#artikel-id)`. */
export const HELP_LINK = /\[([^\]]+)\]\(#([a-z0-9-]+)\)/g;

/** En text i delar: vanlig text och länkar till andra artiklar. */
export type HelpTextPart = { text: string; article?: string | undefined };

export function helpTextParts(value: string): HelpTextPart[] {
  const parts: HelpTextPart[] = [];
  let at = 0;
  for (const match of value.matchAll(HELP_LINK)) {
    if (match.index > at) parts.push({ text: value.slice(at, match.index) });
    parts.push({ text: match[1]!, article: match[2]! });
    at = match.index + match[0].length;
  }
  if (at < value.length) parts.push({ text: value.slice(at) });
  return parts;
}

/** Texterna i ett stycke, en punktlista eller en numrerad lista. */
export function helpBlockTexts(block: HelpBlock): readonly string[] {
  return typeof block === "string" ? [block] : "steps" in block ? block.steps : block;
}

/** Rubriken och alla texter i artikeln, med länkarnas markering kvar (för testerna av citat och länkar). */
export function helpArticleTexts(article: HelpArticle): readonly string[] {
  return [article.title, ...article.body.flatMap(helpBlockTexts)];
}

/** Artikelns rubrik och text som en sökbar sträng (citattecknen kring knappnamnen och länkarnas markering tas bort). */
export function helpArticleText(article: HelpArticle): string {
  return helpArticleTexts(article).join(" ").replace(HELP_LINK, "$1").replace(/[”“]/g, "");
}

/**
 * Sökbar text: vikt, och "tryck på" (knapptryck) borttaget, så att sökordet tryck (tryckeri) inte träffar varje artikel.
 */
function searchable(value: string): string {
  return foldForSearch(value).replace(/\btryck(er)? (sedan )?pa\b/g, " ");
}

/**
 * Synonymerna (`helpSynonyms`): ett ord som börjar med en stam i en grupp träffar också texter med gruppens andra stammar,
 * så att "kartdef" hittar kontrollbeskrivningen och "ppen" hittar Purple Pen. Orden är vikta som texten.
 */
function alternativesFor(word: string): readonly string[] {
  const groups = helpSynonyms.map(group => group.map(foldForSearch)).filter(group => group.some(stem => word.startsWith(stem)));
  return [word, ...groups.flat()];
}

export type HelpListing = {
  /** Artiklarna för vyn man står i (den efterfrågade först, sedan efter vyernas ordning). */
  here: readonly HelpArticle[];
  /** Alla andra. */
  rest: readonly HelpArticle[];
};

export type HelpListingOptions = {
  /** En artikel som ska stå först bland vyns artiklar (från en länk eller en "?" vid en knapp). */
  first?: string | undefined;
};

/**
 * Hjälppanelens listor (PLAN.md steg 37): först artiklarna för vyerna (i vyernas ordning; inom en vy först de som har
 * vyn som sin första, sedan i filens ordning), sedan
 * resten i filens ordning. Med en sökning: bara artiklar där varje ord (eller en synonym) finns i rubriken eller texten;
 * träffar i rubriken och på ordet självt (inte bara en synonym) står först inom varje lista.
 */
export function listHelpArticles(articles: readonly HelpArticle[], view: HelpView | readonly HelpView[], query = "",
  options: HelpListingOptions = {}): HelpListing {
  const views: readonly HelpView[] = typeof view === "string" ? [view] : view;
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  const rank = (article: HelpArticle) => {
    const index = views.findIndex(item => article.views.includes(item));
    return index === -1 ? views.length : index;
  };
  // Inom en vy först artiklarna som är skrivna för den (vyn står först i artikelns `views`).
  const primary = (article: HelpArticle) => article.views[0] === views[rank(article)] ? 0 : 1;
  const scored = articles.map((article, order) => {
    if (words.length === 0) return { article, order, score: 0 };
    const title = searchable(article.title);
    const text = searchable(helpArticleText(article));
    let score = 0;
    for (const word of words) {
      const alternatives = alternativesFor(word);
      if (title.includes(word)) score += 4;
      else if (alternatives.some(stem => title.includes(stem))) score += 3;
      else if (text.includes(word)) score += 2;
      else if (alternatives.some(stem => text.includes(stem))) score += 1;
      else return undefined;
    }
    return { article, order, score };
  }).filter(row => row !== undefined);
  const sorted = [...scored].sort((a, b) => (a.article.id === options.first ? -1 : 0) - (b.article.id === options.first ? -1 : 0)
    || rank(a.article) - rank(b.article) || b.score - a.score || primary(a.article) - primary(b.article) || a.order - b.order);
  const inView = (article: HelpArticle) => article.id === options.first || rank(article) < views.length;
  return { here: sorted.filter(row => inView(row.article)).map(row => row.article),
    rest: sorted.filter(row => !inView(row.article)).map(row => row.article) };
}
