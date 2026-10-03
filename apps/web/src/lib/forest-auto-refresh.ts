/** A timer may read only when it cannot interfere with the operator's work. */
export function canRefreshForest(input: {
  enabled: boolean; authenticated: boolean; visible: boolean; reportOpen: boolean;
  busy: boolean; pending: boolean; journalOpen: boolean; editing: boolean;
}): boolean {
  return input.enabled && input.authenticated && input.visible && input.reportOpen &&
    !input.busy && !input.pending && !input.journalOpen && !input.editing;
}
