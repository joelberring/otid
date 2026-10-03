# MeOS som produktreferens, 2026-09-19

Skrivskyddad webbgranskning av officiella användarsidor. Ingen källkod, struktur,
testkod, UI eller branding kopierades. Källorna används för användarbehov och
funktionstäckning i [matrisen](../meos-feature-matrix.md).

- [Funktioner](https://www.melin.nu/meos/sv/features.php): enkel start utan
  föranmälan, import, SI-avläsning, nätverksarbete och flera tävlingsformer.
- [MeOS 5.0-handboken](https://www.melin.nu/meos/sv/show.php?base=156&id=5400):
  namngivna arbetsflöden för bland annat klass/bana, lottning, hyrbrickor,
  okopplade brickor, sträcktider, start-/resultatlistor, Eventor, speaker,
  ekonomi och avancerade tävlingsformer. Innehållsförteckningen bevisar
  funktionens förekomst; detaljerade regler måste läsas inför respektive snitt.
- [Produktbeskrivning](https://www.melin.nu/meos/sv/): beskriver bland annat
  automatisk backup, fortsatt arbete vid serveromstart och olika resultatvyer.
- [Avkortade banor](https://www.melin.nu/meos/sv/show.php?base=3600&id=3638):
  beskriver separata kortare banvarianter och deras resultatordning. Detta är
  bara ett användarbehov för ADR-0113; O-Tid kopierar varken kod, datamodell
  eller rankingregel utan måste fastställa en egen, testbar policy.
- [Dokumentationsingång](https://www.melin.nu/meos/sv/show.php): hänvisar till
  5.0-handboken; ingångens uppdateringsdatum är 2026-05-11, handbokens 2025-03-03.

Enskilda äldre djupadresser kunde inte hämtas i denna granskning. Planen bygger
därför inte på antagna detaljregler från dem. Ingen aktuell MeOS-installation
provkördes. Funktionstäckning är inte en jämförelse av verifierad prestanda.

## Eventor API, kontrollerat 2026-09-19

- [Eventors officiella API-metodlista](https://eventor.orientering.se/Api/Documentation?culture=sv-SE)
  listar separata läsmetoder för `GET /api/eventclasses` och `GET /api/entries`.
- [Eventors guide för API-läsning](https://eventor.orientering.se/Documents/Guide_Eventor_-_Hamta_data_via_API.pdf)
  beskriver att API-nyckeln är värdefull, att frekventa data bör cachas och att
  informationsmodellen kan förändras. TASK098 använder endast Testeventor,
  privat serverlagrad nyckel och syntetiska adapterprov före ett separat liveprov.
- Det offentligt hämtade schemat på `/api/schema` kontrollerades läsande utan
  autentisering. Det visar att Eventors `Entry` kan vara team eller bära flera
  `EntryClass`; TASK098 avvisar dessa former i stället för att gissa en
  individuell deltagarmodell.

Ingen Eventornyckel, Eventor-response eller tävlingspersondata sparas i denna
researchnotering.
