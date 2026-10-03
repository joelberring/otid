# @o-tid/iof-xml

Paketets accepterade `EntryList`- och `CourseData`-struktur följer IOF:s
officiella Data Standard 3.0:

- <https://orienteering.sport/iof/it/data-standard-3-0/>
- <https://github.com/international-orienteering-federation/datastandard-v3/blob/24eb108e4c6b5e2904e5f8f0e49142e45e2c5230/IOF.xsd>

IOF-repositoryt anger ingen separat licens för `IOF.xsd`. Schemat vendlas därför
inte innan IOF har klargjort återanvändningsvillkoren. Paketet utför tills vidare
syntax- och avgränsad schema-driven validering av TASK 001-subsetet; detta får
inte beskrivas som full XSD-validering.

`libxml2-wasm` 0.7.1 (MIT) är tekniskt lämplig som synkron XSD 1.0-motor och har
stöd för include/import, Node 18+ och ESM. Den läggs inte till förrän ett schema
kan användas med klar rättslig grund. `xmllint-wasm` 5.3.0 (MIT) validerar också
XSD men har ett asynkront worker-API som inte passar paketets synkrona
`parseIofXml`-kontrakt.

`EntryList` innehåller enligt IOF-schemat inga fasta starttider och `CourseData`
innehåller ingen startregel. Nya importerade klass–ban-kopplingar börjar därför
som intern `PUNCH` tills en separat standardiserad `StartList` importeras.

TASK 006A stöder ett strikt individuellt `StartList`-subset för ett
enkelrace. `Class.Id`, `PersonStart.EntryId`, exakt en `Start` och en
tidszonsangiven `StartTime` krävs. Tider normaliseras till UTC; team, flera race,
okända containerfält och dubbletter av klass/entry avvisas. Parsern returnerar
`StartListImport` med klasser och deras starter; matchning mot befintliga
database-entries sker först i applikationslagret.
