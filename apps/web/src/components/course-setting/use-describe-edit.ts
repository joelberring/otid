import { useCallback } from "react";
import type { CourseSettingDocument, CourseSettingEdit } from "@o-tid/course-setting";
import { courseSettingEn } from "../../i18n/course-setting-en";
import { editTextsEn } from "../../i18n/course-setting-edits-en";
import { editTextsSv } from "../../i18n/course-setting-edits-sv";
import { courseSettingSv } from "../../i18n/course-setting-sv";
import { describeEdit } from "../../lib/course-setting-suggestion";
import { useLanguage } from "../language-provider";

/** Engelska del 29: åtgärderna i ett förslag i en mening på sidans språk. */
export function useDescribeEdit(): (edit: CourseSettingEdit, document: CourseSettingDocument) => string {
  const en = useLanguage() === "en";
  return useCallback((edit, document) => en ? describeEdit(edit, document, editTextsEn, courseSettingEn, ".")
    : describeEdit(edit, document, editTextsSv, courseSettingSv, ","), [en]);
}
