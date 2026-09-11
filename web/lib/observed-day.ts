/** A day is observed when a person closed it or every slot was logged or skipped (soma#891).
 *  An auto-closed day is not: the old auto-close produced 77 closed days with nothing logged. */
export function isObservedDay(d: { status: string | null; closedBy: "user" | "auto" | null; coverage: number | null }): boolean {
  if (d.status === "closed" && d.closedBy === "user") return true;
  return typeof d.coverage === "number" && d.coverage >= 1;
}
