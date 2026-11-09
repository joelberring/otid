"use client";

import type { Texts } from "../../lib/language";
import { listsEn } from "../../i18n/lists-en";
import { listsSv } from "../../i18n/lists-sv";
import { useTexts } from "../language-provider";

/** Idéerna 2026-11-08 (engelska): listornas texter på sidans språk (publika sidor) eller svenska (arbetsytan). */
export type ListTexts = Texts<typeof listsSv>;
export const useListTexts = (): ListTexts => useTexts(listsSv, listsEn);
