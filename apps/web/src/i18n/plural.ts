/** Antal med rätt form: plural(1, "bana", "banor") → "1 bana", plural(3, "bana", "banor") → "3 banor". */
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
