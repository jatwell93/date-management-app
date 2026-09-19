// Organization RBAC audit trail vocabulary.
//
// `org_audit_log` (migration 0013) records *authorization* events — who was
// granted which role, by whom, and by what path — as distinct from `audit_log`,
// which records inventory events. Two Worker modules write to it
// (`clerk/bootstrap-handler.ts` and the promotion path inside `database.ts`), so
// the event spelling lives here rather than in either of them: a constant with
// more than one consumer is exactly what golden rule 5 puts in `shared/domain`,
// and 3.1.e is the precedent for why (three copies of one vocabulary had drifted
// before anyone noticed).
//
// Ported from the Express constants (`backend/src/constants/roles.ts:64`) so the
// stored values stay comparable across the cutover.

export const ORG_AUDIT_EVENT_TYPES = {
  /**
   * A user was given a role. Three live paths reach this, all of them audited:
   * first bootstrap, an admin creating a user via `POST /api/users`, and an
   * admin changing an existing user's role via `PUT /api/users/:id`. See
   * ORG_AUDIT_TRIGGERS, which is what tells them apart once the rows are stored.
   */
  ROLE_ASSIGNED: 'role_assigned',
  /** Reserved. Had no emitter on either backend — see LIVE_ORG_AUDIT_EVENT_TYPES. */
  ROLE_REMOVED: 'role_removed',
  /** Reserved. Gated behind ENABLE_CUSTOM_ORG_INVITES, which is off. */
  INVITE_CREATED: 'invite_created',
  /** Reserved. Gated behind ENABLE_CUSTOM_ORG_INVITES, which is off. */
  INVITE_ACCEPTED: 'invite_accepted',
  /** Reserved. Gated behind ENABLE_CUSTOM_ORG_INVITES, which is off. */
  INVITE_REVOKED: 'invite_revoked',
  /** Reserved. Gated behind ENABLE_CUSTOM_ORG_INVITES, which is off. */
  INVITE_RESENT: 'invite_resent',
} as const;

export type OrgAuditEventType = (typeof ORG_AUDIT_EVENT_TYPES)[keyof typeof ORG_AUDIT_EVENT_TYPES];

/**
 * The subset with a writer.
 *
 * The full vocabulary above is the Express one, kept so a re-enabled invite flow
 * has a spelling to use. Only `role_assigned` is actually emitted today, and
 * stating that as data rather than as a comment lets a test assert it — so if a
 * writer is added for one of the reserved types without being recorded here, the
 * disagreement surfaces instead of the vocabulary quietly becoming a lie about
 * what the table contains.
 */
export const LIVE_ORG_AUDIT_EVENT_TYPES: readonly OrgAuditEventType[] = [
  ORG_AUDIT_EVENT_TYPES.ROLE_ASSIGNED,
];

/**
 * How a `role_assigned` row came about. Stored inside `metadata.trigger`, which
 * is the only thing distinguishing the two writers once the rows are in the
 * table — and they carry very different weight:
 *
 *   * `bootstrap` — the automatic self-assignment at account creation. Actor and
 *     target are the same user, and the row is reconstructible from `users`.
 *   * `admin-create` — an admin pre-provisioning a user through `POST /api/users`
 *     with a role of their choosing, `admin` included. The created row is a
 *     username-only placeholder with no Clerk id, so it is a grant of privilege
 *     that no later event re-states.
 *   * `admin-update` — one admin deliberately changing an existing user's role.
 *
 * The last two are the ones with the compliance argument: `users.role` and
 * `users.created_at` can tell you a user holds admin, but never *who* granted
 * it. Neither Express nor the Worker recorded either before migration 0013.
 */
export const ORG_AUDIT_TRIGGERS = {
  BOOTSTRAP: 'bootstrap',
  ADMIN_CREATE: 'admin-create',
  ADMIN_UPDATE: 'admin-update',
} as const;

export type OrgAuditTrigger = (typeof ORG_AUDIT_TRIGGERS)[keyof typeof ORG_AUDIT_TRIGGERS];

/** One row of `org_audit_log`, before it is written. */
export interface OrgAuditEntry {
  organizationId: string;
  eventType: OrgAuditEventType;
  actorUserId?: number | null;
  actorOrganizationId?: string | null;
  targetUserId?: number | null;
  targetOrganizationId?: string | null;
  oldRole?: string | null;
  newRole?: string | null;
  inviteId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}
