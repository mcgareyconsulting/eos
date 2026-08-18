import { ShieldCheck } from "lucide-react";

/**
 * Org-admin chip, shown next to a person wherever rosters render. Admin is
 * the Identity Platform custom claim (org-wide god mode), orthogonal to the
 * per-team Leader/Member role.
 */
export function AdminBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-hpb-gold/15 px-2 py-0.5 text-xs font-medium text-hpb-brown ring-1 ring-inset ring-hpb-gold/40 dark:bg-hpb-gold/10 dark:text-hpb-gold dark:ring-hpb-gold/30">
      <ShieldCheck className="h-3 w-3" />
      Admin
    </span>
  );
}
