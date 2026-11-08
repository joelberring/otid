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
  render_course: z.object({ race_id: raceId, course_id: objectId, width_px: z.number().int().min(200).max(1600).optional(), grid: z.boolean().optional(),
    area: z.object({ min_x: z.number().finite(), min_y: z.number().finite(), max_x: z.number().finite(), max_y: z.number().finite() })
      .refine(box => box.max_x > box.min_x && box.max_y > box.min_y, "max ska vara större än min").optional() }),
  course_level: z.object({ race_id: raceId, course_id: objectId }),
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
