/** Antal med rätt form: plural(1, "bana", "banor") → "1 bana", plural(3, "bana", "banor") → "3 banor". */
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Namn som en lista: ["Kort", "Lång"] → "Kort och Lång", ["A", "B", "C"] → "A, B och C" (`and` = "and" på engelska). */
export const nameList = (names: readonly string[], and = "och") =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
