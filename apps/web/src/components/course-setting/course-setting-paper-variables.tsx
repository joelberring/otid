import { PAPER_VARIABLES, RUNNER_PAPER_VARIABLES } from "@o-tid/course-setting";
import { runnerPrintEn } from "../../i18n/course-setting-print-more-en";
import { useTexts } from "../language-provider";
import { runnerPrintSv } from "../../i18n/course-setting-runner-print-sv";

/**
 * Variablerna att infoga i en text på papperet: banans och, ADR-0213, löparens (fylls i per löpare i En karta per löpare,
 * platshållare annars).
 */
export function VariableOptions() {
  const text = useTexts(runnerPrintSv, runnerPrintEn);
  return <>
    <option value="">…</option>
    <optgroup label={text.variablesCourse}>{PAPER_VARIABLES.map(name => <option key={name} value={name}>{`{${name}}`}</option>)}</optgroup>
    <optgroup label={text.variablesRunner}>{RUNNER_PAPER_VARIABLES.map(name => <option key={name} value={name}>{`{${name}}`}</option>)}</optgroup>
  </>;
}
