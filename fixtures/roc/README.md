# ROC-fixtures

Konstruerade svar i ROC-protokollets format (inte inspelade från ROC eller OResults). Bricknummer och id:n
är påhittade. En stämpling per rad: `stämplings-id;kontrollkod;bricka;YYYY-MM-DD HH:MM:SS` (lokal tid).
Används av adaptertesterna (`packages/roc`) och integrationstestet `adr-0172-radio`.

- `normal.txt` – fem stämplingar vid radiokontroll 31 och 50, LF och avslutande radslut
- `empty.txt` – tomt svar (inga nya stämplingar)
- `bom-crlf.txt` – BOM, CRLF och en tom rad sist
- `malformed.txt` – trasiga rader blandat med giltiga (text, tom bricka, fel kod, omöjlig tid, för få fält,
  negativt id) samt mellanslag, inledande nollor och ett extra fält som godtas
- `duplicates.txt` – samma id två gånger och samma stämpling med ett nytt id
- `unordered.txt` – id:n som inte ökar
- `dst.txt` – tider runt sommartid (29 mars 02:30 finns inte) och vintertid (25 oktober 02:30 finns två gånger)
