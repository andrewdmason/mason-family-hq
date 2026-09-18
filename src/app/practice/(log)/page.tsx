// The practice log lives in this group's layout, not here: the day on screen
// is a ?date= search param, and Next keys a page by its search params — so a
// page would remount on every step between days (and on the first refresh
// after one), taking whatever you were typing with it. A layout isn't keyed
// that way; it stays mounted while the day changes underneath it.
export default function PracticeLogPage() {
  return null;
}
