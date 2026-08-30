import type { Database } from '../database';

export type SqlClient = Database['sql'];

export interface ClerkWebhookEventPayload {
  type?: string;
  data?: Record<string, unknown>;
}

export function sanitizeSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  return slug || fallback;
}

function mapClerkRole(role: unknown): string {
  if (typeof role !== 'string') {
    return 'Team Member';
  }

  if (role === 'admin' || role === 'org:admin') {
    return 'Manager';
  }

  return 'Team Member';
}

function extractPrimaryClerkEmail(data: Record<string, unknown>): string | null {
  const addresses = Array.isArray(data.email_addresses) ? data.email_addresses : [];
  const primaryId =
    typeof data.primary_email_address_id === 'string' ? data.primary_email_address_id : null;

  const pickEmail = (candidate: unknown): string | null => {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const record = candidate as Record<string, unknown>;
    return typeof record.email_address === 'string' ? record.email_address.toLowerCase() : null;
  };

  if (primaryId) {
    const primary = addresses.find((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return false;
      }

      const record = candidate as Record<string, unknown>;
      return record.id === primaryId;
    });

    const primaryEmail = pickEmail(primary);
    if (primaryEmail) {
      return primaryEmail;
    }
  }

  for (const candidate of addresses) {
    const email = pickEmail(candidate);
    if (email) {
      return email;
    }
  }

  return null;
}

export function deriveUsername(
  data: Record<string, unknown>,
  email: string | null,
  clerkUserId: string,
): string {
  const raw =
    typeof data.username === 'string' && data.username.trim().length > 0
      ? data.username.trim()
      : email?.split('@')[0] || `user-${clerkUserId.slice(-8)}`;

  return sanitizeSlug(raw, `user-${Date.now().toString(36)}`);
}

/**
 * Give an organization a trial subscription if it does not have one already.
 *
 * Idempotent at the database, not in application code: migration 0012 puts a
 * unique constraint on `subscription_tiers.organization_id`, and this insert
 * defers to it. The previous check-then-insert had nothing behind it, so two
 * concurrent `organization.created` deliveries could each observe no row and
 * each write one — two `trialing` rows for one organization, which every
 * reader's `LIMIT 1` then resolves arbitrarily (issue #472).
 *
 * The `ON CONFLICT` deliberately names no conflict target. An inference clause
 * (`ON CONFLICT (organization_id)`) would require the constraint to exist and
 * would fail against a database that has not applied 0012 yet; the bare form is
 * correct on both sides of that migration.
 */
export async function ensureTrialSubscription(
  sql: SqlClient,
  organizationId: string,
): Promise<void> {
  await sql`
    INSERT INTO subscription_tiers (
      organization_id,
      tier_level,
      status,
      billing_cycle,
      trial_started_at,
      trial_end_date,
      created_at,
      updated_at
    ) VALUES (
      ${organizationId},
      'professional',
      'trialing',
      'monthly',
      NOW(),
      NOW() + INTERVAL '14 days',
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING
  `;
}

export async function findOrCreateOrganization(
  sql: SqlClient,
  clerkOrganization: Record<string, unknown> | null,
  fallbackEmail?: string | null,
): Promise<string> {
  const clerkOrganizationId =
    clerkOrganization && typeof clerkOrganization.id === 'string' ? clerkOrganization.id : null;

  if (clerkOrganizationId) {
    const existing = await sql`
      SELECT id
      FROM organizations
      WHERE clerk_organization_id = ${clerkOrganizationId}
      LIMIT 1
    `;

    if (existing[0]?.id) {
      return String(existing[0].id);
    }
  }

  const fallbackLabel = fallbackEmail?.split('@')[0] || 'organization';
  const providedName =
    clerkOrganization && typeof clerkOrganization.name === 'string' ? clerkOrganization.name : null;
  const orgName = providedName || `${fallbackLabel}'s Organization`;

  const providedSlug =
    clerkOrganization && typeof clerkOrganization.slug === 'string' ? clerkOrganization.slug : null;
  const baseSlug = sanitizeSlug(
    providedSlug || orgName || clerkOrganizationId || fallbackLabel,
    `org-${crypto.randomUUID().slice(0, 8)}`,
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug =
      attempt === 0 ? baseSlug : `${baseSlug}-${crypto.randomUUID().slice(0, 8)}-${attempt}`;

    const newOrgId = crypto.randomUUID();
    try {
      const rows = await sql`
        INSERT INTO organizations (
          id,
          clerk_organization_id,
          name,
          slug,
          contact_email,
          created_at,
          updated_at
        ) VALUES (
          ${newOrgId},
          ${clerkOrganizationId},
          ${orgName},
          ${slug},
          ${fallbackEmail || null},
          NOW(),
          NOW()
        )
        RETURNING id
      `;

      if (rows[0]?.id) {
        return String(rows[0].id);
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unable to create organization for Clerk webhook event');
}

export async function upsertClerkUser(
  sql: SqlClient,
  options: {
    clerkUserId: string;
    organizationId: string;
    role: string;
    email?: string | null;
    username?: string | null;
  },
): Promise<void> {
  const { clerkUserId, organizationId, role, email = null, username = null } = options;

  try {
    await sql`
      INSERT INTO users (
        organization_id,
        clerk_user_id,
        email,
        username,
        role,
        created_at,
        updated_at
      ) VALUES (
        ${organizationId},
        ${clerkUserId},
        ${email},
        ${username},
        ${role},
        NOW(),
        NOW()
      )
      ON CONFLICT (clerk_user_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        email = COALESCE(EXCLUDED.email, users.email),
        username = COALESCE(EXCLUDED.username, users.username),
        role = EXCLUDED.role,
        deleted_at = NULL,
        updated_at = NOW()
    `;
    return;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '23505' || !email) {
      throw error;
    }
  }

  const updatedExisting = await sql`
    UPDATE users
    SET
      clerk_user_id = ${clerkUserId},
      organization_id = ${organizationId},
      username = COALESCE(${username}, username),
      role = ${role},
      updated_at = NOW()
    WHERE organization_id = ${organizationId}
      AND LOWER(email) = LOWER(${email})
    RETURNING id
  `;

  if (updatedExisting.length === 0) {
    throw new Error('Unable to upsert Clerk user');
  }
}

async function syncClerkUserFromEvent(
  sql: SqlClient,
  data: Record<string, unknown>,
  options: { ensureTrial: boolean },
): Promise<void> {
  const clerkUserId = typeof data.id === 'string' ? data.id : null;
  if (!clerkUserId) {
    return;
  }

  const primaryEmail = extractPrimaryClerkEmail(data);
  const memberships = Array.isArray(data.organization_memberships)
    ? data.organization_memberships
    : [];
  const firstMembership = memberships.find((item) => item && typeof item === 'object') as
    | Record<string, unknown>
    | undefined;
  const orgPayload =
    firstMembership && typeof firstMembership.organization === 'object'
      ? (firstMembership.organization as Record<string, unknown>)
      : null;

  const organizationId = await findOrCreateOrganization(sql, orgPayload, primaryEmail);

  await upsertClerkUser(sql, {
    clerkUserId,
    organizationId,
    role: mapClerkRole(firstMembership?.role),
    email: primaryEmail,
    username: deriveUsername(data, primaryEmail, clerkUserId),
  });

  if (options.ensureTrial) {
    await ensureTrialSubscription(sql, organizationId);
  }
}

export async function processClerkWebhookEvent(
  sql: SqlClient,
  event: ClerkWebhookEventPayload,
): Promise<void> {
  const eventType = typeof event.type === 'string' ? event.type : 'unknown';
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};

  switch (eventType) {
    case 'user.created': {
      await syncClerkUserFromEvent(sql, data, { ensureTrial: true });
      return;
    }

    case 'user.updated': {
      await syncClerkUserFromEvent(sql, data, { ensureTrial: false });
      return;
    }

    case 'organization.created':
    case 'organization.updated': {
      await findOrCreateOrganization(sql, data, null);
      return;
    }

    case 'organizationMembership.created': {
      const publicUserData = data.public_user_data as Record<string, unknown> | undefined;
      const clerkUserId =
        publicUserData && typeof publicUserData.user_id === 'string'
          ? publicUserData.user_id
          : null;

      const organizationPayload =
        data.organization && typeof data.organization === 'object'
          ? (data.organization as Record<string, unknown>)
          : null;

      if (!clerkUserId || !organizationPayload) {
        return;
      }

      const identifier =
        publicUserData && typeof publicUserData.identifier === 'string'
          ? publicUserData.identifier.toLowerCase()
          : null;
      const organizationId = await findOrCreateOrganization(sql, organizationPayload, identifier);
      const role = mapClerkRole(data.role);

      const updated = await sql`
        UPDATE users
        SET
          organization_id = ${organizationId},
          role = ${role},
          deleted_at = NULL,
          updated_at = NOW()
        WHERE clerk_user_id = ${clerkUserId}
        RETURNING id
      `;

      if (updated.length === 0 && identifier) {
        await upsertClerkUser(sql, {
          clerkUserId,
          organizationId,
          role,
          email: identifier,
          username: sanitizeSlug(identifier.split('@')[0], `user-${Date.now().toString(36)}`),
        });
      }

      await ensureTrialSubscription(sql, organizationId);
      return;
    }

    case 'organizationMembership.deleted': {
      const publicUserData = data.public_user_data as Record<string, unknown> | undefined;
      const clerkUserId =
        publicUserData && typeof publicUserData.user_id === 'string'
          ? publicUserData.user_id
          : null;
      const organizationPayload =
        data.organization && typeof data.organization === 'object'
          ? (data.organization as Record<string, unknown>)
          : null;

      if (!clerkUserId) {
        return;
      }

      const clerkOrganizationId =
        organizationPayload && typeof organizationPayload.id === 'string'
          ? organizationPayload.id
          : null;

      if (clerkOrganizationId) {
        const orgRows = await sql`
          SELECT id
          FROM organizations
          WHERE clerk_organization_id = ${clerkOrganizationId}
          LIMIT 1
        `;

        if (orgRows[0]?.id) {
          await sql`
            UPDATE users
            SET
              deleted_at = NOW(),
              updated_at = NOW()
            WHERE clerk_user_id = ${clerkUserId}
              AND organization_id = ${String(orgRows[0].id)}
          `;
          return;
        }
      }

      await sql`
        UPDATE users
        SET
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE clerk_user_id = ${clerkUserId}
      `;
      return;
    }

    default:
      return;
  }
}

/**
 * How long a claimed-but-unfinished event is left alone before another delivery
 * may take it over. It bounds the damage from an isolate that dies between the
 * claim and the completion: until the window expires the event looks in-flight
 * and redeliveries are ignored; after it, the next redelivery re-drives it.
 *
 * Sized above the Worker's own request budget so a still-running delivery is
 * never stolen from, and below Svix's retry schedule so a lost one is picked up
 * by an ordinary retry rather than needing a manual replay.
 */
export const CLERK_WEBHOOK_STALE_CLAIM_SECONDS = 300;

/**
 * Claim an event id for processing, returning `false` if another delivery owns
 * it or already finished it.
 *
 * This is the whole idempotency mechanism, and it is one statement on purpose.
 * The previous shape — read, branch, process, then insert the marker — let two
 * concurrent Svix deliveries of one event id both read "new" and both perform
 * the side effects; the marker's `ON CONFLICT DO NOTHING` deduplicated the row,
 * not the work (issue #472).
 *
 * Unlike a conditional `INSERT ... SELECT ... WHERE NOT EXISTS`, this one really
 * is atomic. Two concurrent inserts of the same id cannot both win: the second
 * blocks on the unique index entry until the first commits, and `ON CONFLICT DO
 * UPDATE` then re-reads the committed row rather than its own snapshot from
 * statement start, so it sees the fresh claim and its `WHERE` filters it out.
 *
 * The three outcomes of the conflict branch:
 *
 * - row is complete (`completed_at IS NOT NULL`) — a replay; no rows, `false`.
 * - row is claimed and fresh — a concurrent delivery owns it; no rows, `false`.
 * - row is claimed and stale — the owner died; the claim is taken over, `true`.
 */
export async function claimClerkWebhookEvent(
  sql: SqlClient,
  eventId: string,
  eventType: string,
  staleClaimSeconds: number = CLERK_WEBHOOK_STALE_CLAIM_SECONDS,
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO clerk_webhook_events (id, event_type, processed_at, completed_at)
    VALUES (${eventId}, ${eventType}, NOW(), NULL)
    ON CONFLICT (id) DO UPDATE
      SET event_type = EXCLUDED.event_type,
          processed_at = NOW()
      WHERE clerk_webhook_events.completed_at IS NULL
        AND clerk_webhook_events.processed_at
              < NOW() - make_interval(secs => ${staleClaimSeconds}::double precision)
    RETURNING id
  `;

  return rows.length > 0;
}

/**
 * Mark a claimed event finished. Until this runs the row reads as in-flight, so
 * failing to reach it leaves the event replayable once the staleness window
 * expires — the safe direction of the trade.
 */
export async function completeClerkWebhookEvent(sql: SqlClient, eventId: string): Promise<void> {
  await sql`
    UPDATE clerk_webhook_events
    SET completed_at = NOW()
    WHERE id = ${eventId}
  `;
}

/**
 * Drop a claim whose processing failed, so Svix's retry re-drives the event
 * immediately instead of waiting out the staleness window.
 *
 * Guarded on `completed_at IS NULL` so a late failure can never delete the
 * marker of work that actually completed.
 */
export async function releaseClerkWebhookEventClaim(
  sql: SqlClient,
  eventId: string,
): Promise<void> {
  await sql`
    DELETE FROM clerk_webhook_events
    WHERE id = ${eventId}
      AND completed_at IS NULL
  `;
}
