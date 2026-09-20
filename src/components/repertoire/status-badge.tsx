import { Badge } from "@/components/ui/badge";
import type { PieceStatus } from "@/lib/types";
import { PIECE_STATUS_LABELS } from "@/lib/types";

const statusVariant: Record<PieceStatus, "default" | "secondary" | "outline"> =
  {
    active: "default",
    upcoming: "secondary",
    archived: "outline",
  };

export function StatusBadge({ status }: { status: PieceStatus }) {
  return <Badge variant={statusVariant[status]}>{PIECE_STATUS_LABELS[status]}</Badge>;
}

/**
 * Marks a piece as being in the keep-it-warm rotation. Sits alongside the
 * status badge rather than replacing it — maintenance is not a status, and a
 * maintenance piece is still active.
 */
export function MaintenanceBadge() {
  return <Badge variant="outline">Maintenance</Badge>;
}
