# MinIO-regelägarskap för nästa privata backupsteg

Datum: 2026-09-23. Detta är faktaunderlag för TASK175, inte en ny
produktionsacceptans. Ingen extern kod har kopierats.

- [MinIO `mc replicate add`](https://docs.min.io/aistor/reference/cli/mc-replicate/mc-replicate-add/)
  dokumenterar ett uttryckligt unikt `--id`, `--remote-bucket` och
  `--replicate existing-objects`. Den lokalt hashpinnade `mc`-binärens
  `replicate add --help` visar samma `--id`-flagga.
- [MinIO `mc replicate ls`](https://docs.min.io/aistor/reference/cli/mc-replicate/mc-replicate-ls/)
  listar konfigurerade regler; den befintliga pinnade testhärvan läser
  JSON-fälten för regel-ID och destinationens ARN.
- [MinIO `mc replicate resync`](https://docs.min.io/aistor/reference/cli/mc-replicate/mc-replicate-resync/)
  startar uttrycklig resynk mot en vald destinations-ARN. Kommandots svar
  innebär att jobbet har startat, inte att manifestets exakta versioner är
  verifierade i målet.
- [MinIO `mc replicate rm`](https://docs.min.io/aistor/reference/cli/mc-replicate/mc-replicate-rm/)
  kan ta bort en regel med `--id`; borttagningen raderar inte redan
  replikerade objekt. `--all --force` finns men är olämpligt som generell
  cleanup när endast operationens egen regel ska få ändras.

Slutsats för O-Tid: ett deterministiskt, privat backupbundet regel-ID kan
bindas innan skapande och användas för att känna igen den egna regeln även
om `add` tappar sitt svar. En ny läsning måste visa noll regler innan cleanup
kan godkännas. Att ett resync-kommando accepterats är inte ett målbevis; den
vanliga versionsbundna PM-läsaren måste verifiera varje manifestreferens.
Detta ligger inom ADR-0140:s redan beslutade MinIO-/`mc`-mekanism.

Isolerat TASK175-fynd med den lokalt pinnade MinIO-/`mc`-kombinationen:
`remove --id` av bucketens sista regel gav exit 1 därför att servern inte
godtar en befintlig replikeringskonfiguration med noll regler. Detta är
starkare lokalt kompatibilitetsbevis än klientens generella hjälptext.
ADR-0140 har därför förtydligats: för en färskt verifierad **enda** ägd regel
får hela konfigurationen tas bort med `--all --force`; okänd/ytterligare
regel stoppar åtgärden. Ingen produktionsmässig exklusivitet är bevisad.
