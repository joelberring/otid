# ADR-0223: Missvisningen med World Magnetic Model, och omriktningen senare

Status: del 1 beslutad och byggd 2026-11-09 (idéerna 2026-11-08, avsnitt 2: "Den magnetiska deklinationen ändras med åren,
så en äldre karta pekar till slut fel. Kartan ska kunna riktas om."). Del 2 väntar på ägaren.

**Bakgrund.** En ny karta fick hittills missvisningen som kartritaren skrev, och tomt betydde nätnord. En äldre karta har
nordlinjer för missvisningen när den ritades; i Stockholm ändras den med ungefär 0,2° om året.

**Beslut, del 1.**
1. **World Magnetic Model 2025** (NOAA NCEI och BGS, allmän egendom, giltig 2025–2030) räknas i `@o-tid/map-file`
   (`magneticDeclination`, `declinationAt`). Koefficienterna är modellens WMM.COF; beräkningen är kontrollerad mot en
   oberoende implementation (pygeomag) på 1e-9 grader.
2. **Ny karta:** tomt fält ger dagens missvisning i områdets mitt (förslaget visas i formuläret), inte längre nätnord.
3. **Kartredigeraren** visar under "Magnetisk nord" kartans missvisning (grivationen plus meridiankonvergensen i
   referenspunkten), dagens enligt modellen och skillnaden.

**Del 2 (inte byggd): omriktningen.** Ett förslag som vrider alla objekt så att kartans upp blir dagens magnetiska nord:
varje punkt P flyttas till f′⁻¹(f(P)), där f är kartans georeferens och f′ samma med grivationen ökad med skillnaden (så
blir tecknet rätt utan egna antaganden). Nordlinjerna, texterna och punktsymbolernas vinkel vrids inte, och nordlinjerna
ritas om över hela kartan. Det kräver att georeferensen (grivationen) skrivs tillbaka i kartfilen när förslaget godkänns,
vilket skrivningen (OMAP och OCAD) inte gör i dag, och att banläggningar på den gamla versionen räknas om. Eftersom det
ändrar riktiga kartfiler och OCAD-skrivningen ännu inte är provad av ägaren väntar del 2 på ett beslut.
