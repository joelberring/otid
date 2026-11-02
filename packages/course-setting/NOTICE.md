# Tredjepartskod och format

Paketet läser och skriver Purple Pens händelsefil (.ppen). Där logik eller data (t.ex. variantkoder, storlekar i
banpåtrycket, kontrollbeskrivningarnas symboler i steg 63) bygger på Purple Pens källkod gäller dess licens.
Kontrollbeskrivningarna: `src/description-symbols.data.ts` är genererad ur Purple Pens `symbols.xml` (ritningar, namn,
texter; svenska för fyra 2018-symboler är O-Tids egna, se `scripts/generate-description-symbols.ts`), och
`src/description-*.ts` är portade från SymbolDB.cs, Textifier.cs, CourseView.cs, DescriptionFormatter.cs och
DescriptionRenderer.cs. Steg 64: specialobjekten och utskriftslayouten (`src/specials.ts`, `src/special-*.ts`,
`src/ppen-special.ts`, `src/page-layout.ts`) bygger på CourseObject.cs, CourseFormatter.cs, CourseLayout.cs,
CoursePageLayout.cs, Controller.cs (tryckytan), CoreMapUtil.cs och EventDB.cs (Special, PrintArea). ADR-0190: IOF XML 3.0
CourseData (`src/iof-export.ts`) skrivs som ExportXml.cs (ExportXmlVersion3), och banans egenskaper (`src/course-properties.ts`)
följer ChangeEvent.cs:

```
Copyright (c) 2006-2008, Peter Golde
All rights reserved.

Redistribution and use in source and binary forms, with or without 
modification, are permitted provided that the following conditions are 
met:

1. Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

3. Neither the name of Peter Golde, nor "Purple Pen", nor the names
of its contributors may be used to endorse or promote products
derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND
CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY
OF SUCH DAMAGE.
```
