// Shared guest rules so every screen counts confirmations the same way.

export type RsvpStatus = 'confirmed' | 'pending_rsvp' | 'declined';

type GuestLike = {
  status?: string | null;
  rsvp_status?: string | null;
  passes?: number | string | null;
  confirmed_passes?: number | string | null;
};

/**
 * RSVP state of a guest: declined, pending, or confirmed (which includes guests who already
 * checked in at the door). A guest marked as confirmed always counts, even if confirmed_passes
 * was left at 0 (e.g. confirmed by hand from the web panel).
 */
export function getRsvpStatus(g: GuestLike): RsvpStatus {
  if (g.rsvp_status === 'confirmed' || g.rsvp_status === 'pending_rsvp' || g.rsvp_status === 'declined') {
    return g.rsvp_status;
  }
  if (g.status === 'declined') return 'declined';
  if (g.status === 'pending') return 'pending_rsvp';
  return 'confirmed';
}

export function isGuestConfirmed(g: GuestLike): boolean {
  return getRsvpStatus(g) === 'confirmed';
}

/** Passes a confirmed guest uses: confirmed_passes, falling back to the invited passes, at least 1. */
export function getGuestPasses(g: GuestLike): number {
  const confirmed = Number(g.confirmed_passes);
  if (confirmed > 0) return confirmed;
  const invited = Number(g.passes);
  if (invited > 0) return invited;
  return 1;
}

type WithCompanions = {
  name?: string | null;
  table_number?: string | null;
  companions?: string | null;
  members?: { id: number; name: string; table_number?: string | null; attended_at?: string | null }[];
};

const sameTable = (a?: string | null, b?: string | null) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** "Ana ✓, Carlos" (✓ = already inside), or the free-text note when the companions have no names loaded. */
export function getCompanionsLabel(g: WithCompanions): string | null {
  if (g.members && g.members.length > 0) {
    return g.members
      .map((m) => `${m.name}${m.attended_at ? ' ✓' : ''}${m.table_number && !sameTable(m.table_number, g.table_number) ? ` (${m.table_number})` : ''}`)
      .join(', ');
  }
  return g.companions?.trim() || null;
}

/** Search by companion too: "soy la esposa de Rubén" is found by her own name. */
export function companionsMatch(g: WithCompanions, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (g.companions?.toLowerCase().includes(q)) return true;
  return Boolean(g.members?.some((m) => m.name.toLowerCase().includes(q)));
}

/** Companions seated at another table than the holder of the invitation. */
export function getMembersAway<T extends WithCompanions>(g: T) {
  return (g.members || []).filter((m) => m.table_number && !sameTable(m.table_number, g.table_number));
}

