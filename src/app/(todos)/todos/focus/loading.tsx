/**
 * Focus mode has no chrome, so the group's sidebar+list skeleton would flash
 * exactly the frame this route exists to hide. A bare field instead.
 */
export default function FocusLoading() {
  return <div aria-busy className="flex-1" />;
}
