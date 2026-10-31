import { describe, expect, it } from "vitest";
import { CourseSettingEditError, readPpen, writePpen } from "../src";
import { normalizedXml } from "./helpers";

const file = (body: string, root = "") => `<?xml version="1.0"?>
<course-scribe-event${root}>
  <event id="1">
    <title>Test &amp; prov</title>
    <map kind="none" scale="10000" />
    <standards map="2000" description="2004" />
    <future-thing a="1" />
  </event>
  <!-- en kommentar -->
  <control id="1" kind="start" stretch="0"><location x="0" y="0" /></control>
  <control id="2" kind="normal"><code>31</code><location x="10.5" y="-3.25" /><punch-pattern size="2">1001</punch-pattern></control>
  <course id="1" kind="normal"><name>A</name><first course-control="1" /><options print-scale="7500" climb="-1" load="40" /></course>
  <course-control id="1" control="1"><next course-control="2" /></course-control>
  <course-control id="2" control="2" points="0" />
${body}</course-scribe-event>`;

describe("readPpen", () => {
  it("varnar för det som tappas eller är konstigt och skriver tillbaka det okända", () => {
    const xml = file("  <class id=\"1\" name=\"H21\" />\n", ' event-classes="true"');
    const { document, warnings } = readPpen(xml);
    expect(warnings.map(w => w.code).sort()).toEqual(["COURSE_ORDER_MISSING", "MAP_STANDARD", "UNKNOWN_ELEMENT", "XML_COMMENT"]);
    expect(document.event.title).toBe("Test & prov");
    expect(document.event.overprintStandard).toBe("ISOM2017");
    expect(document.courses[0]!.printScale).toBe(7500);
    expect(document.courses[0]!.climbMeters).toBeUndefined();
    const written = writePpen(document);
    expect(written).toContain('<standards map="2000" description="2004" />');
    expect(written).toContain('<course-scribe-event event-classes="true">');
    expect(normalizedXml(written.replace(' order="1"', ""))).toEqual(normalizedXml(xml.replace("<!-- en kommentar -->", "")));
    expect(readPpen(written).document).toEqual(document);
  });

  it("kastar INVALID för det Purple Pen inte kan läsa", () => {
    for (const bad of [
      "<nope />",
      file("").replace('kind="start"', 'kind="okänd"'),
      file("").replace(' scale="10000"', ""),
      file("").replace('<course-control id="2" control="2" points="0" />', '<course-control id="2" control="9" />'),
      file("").replace('<next course-control="2" />', '<next course-control="2" /><variation course-control="2" />'),
      file('  <special-object id="1" kind="text"><location x="0" y="0" /></special-object>\n'),
      file("").slice(0, 200)
    ]) {
      expect(() => readPpen(bad), bad.slice(0, 80)).toThrow(CourseSettingEditError);
    }
  });
});
