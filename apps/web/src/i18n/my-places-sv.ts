/** Ägaren 2026-11-04: remsan överst i Mina tävlingar med klubbytorna och träningsgrupperna. */
export const myPlacesSv = {
  label: "Mina klubbar och grupper",
  clubs: "Mina klubbar",
  groups: "Mina grupper",
  noneAtAll: "Välj din klubb under",
  noneAtAllLink: "Mitt konto",
  noClubs: "Du är inte med i någon klubb än.",
  noGroups: "Du är inte med i någon grupp än.",
  pending: (count: number) => `${count} väntar på bekräftelse`,
  loading: "Läser klubbar och grupper …"
} as const;
