import { z } from "zod";

/**
 * Ägaren 2026-11-08: AI-banläggningsassistentens MCP-verktyg (behörigheten `banlaggning`). Läser banläggningen där kontot har
 * behörighet och lämnar notiser; ändrar aldrig en bana, en tävling eller ett resultat.
 */
const raceId = z.string().uuid();
const objectId = z.string().min(1).max(100);
export const COURSE_NOTE_MAX_TEXT = 2000;

export const mcpCourseToolInputSchemas = {
  list_course_settings: z.object({}),
  course_overview: z.object({ race_id: raceId, course_id: objectId.optional() }),
  add_course_note: z.object({
    race_id: raceId,
    text: z.string().trim().min(1).max(COURSE_NOTE_MAX_TEXT),
    course_id: objectId.optional(),
    control_id: objectId.optional(),
    leg: z.object({ from_control_id: objectId, to_control_id: objectId }).optional(),
    point_mm: z.tuple([z.number().finite(), z.number().finite()]).optional()
  }).refine(input => [input.control_id, input.leg, input.point_mm].filter(value => value !== undefined).length <= 1,
    "Ange högst en av control_id, leg och point_mm")
} as const;
