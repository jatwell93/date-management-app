#!/usr/bin/env node

/**
 * Idempotent one-time backfill: normalize legacy role values to canonical roles.
 *
 * Canonical roles: 'admin', 'manager', 'team_member'
 *
 * Maps:
 *   owner, admin, Admin, ADMIN        → admin
 *   manager, Manager, MANAGER         → manager
 *   member, team_member, team-member,
 *   Team Member, Team_Member,
 *   TEAM_MEMBER, Staff, staff, null   → team_member
 *
 * Safe to run multiple times — only updates rows that don't already have canonical values.
 *
 * Usage:
 *   node scripts/backfill-canonical-roles.js [--dry-run]
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CANONICAL_ROLES = ['admin', 'manager', 'team_member'];

const LEGACY_ROLE_MAP = {
  owner: 'admin',
  admin: 'admin',
  Admin: 'admin',
  ADMIN: 'admin',
  manager: 'manager',
  Manager: 'manager',
  MANAGER: 'manager',
  member: 'team_member',
  team_member: 'team_member',
  'team-member': 'team_member',
  'Team Member': 'team_member',
  Team_Member: 'team_member',
  TEAM_MEMBER: 'team_member',
  Staff: 'team_member',
  staff: 'team_member',
};

function normalizeRole(role) {
  if (!role) return 'team_member';
  if (CANONICAL_ROLES.includes(role)) return role;
  return LEGACY_ROLE_MAP[role] ?? 'team_member';
}

async function backfillRoles(dryRun = false) {
  console.log(`\n🔄 Role backfill starting${dryRun ? ' (DRY RUN)' : ''}...\n`);

  // --- Users ---
  const users = await prisma.user.findMany({
    select: { id: true, role: true, email: true },
  });

  let userUpdates = 0;
  let userSkipped = 0;

  for (const user of users) {
    const canonical = normalizeRole(user.role);
    if (user.role === canonical) {
      userSkipped++;
      continue;
    }

    console.log(
      `  User #${user.id} (${user.email ?? 'no email'}): "${user.role}" → "${canonical}"`,
    );

    if (!dryRun) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: canonical },
      });
    }
    userUpdates++;
  }

  console.log(
    `\n  Users: ${userUpdates} updated, ${userSkipped} already canonical (${users.length} total)`,
  );

  // --- Organization Invites ---
  const invites = await prisma.organizationInvite.findMany({
    select: { id: true, role: true, email: true },
  });

  let inviteUpdates = 0;
  let inviteSkipped = 0;

  for (const invite of invites) {
    const canonical = normalizeRole(invite.role);
    if (invite.role === canonical) {
      inviteSkipped++;
      continue;
    }

    console.log(`  Invite ${invite.id} (${invite.email}): "${invite.role}" → "${canonical}"`);

    if (!dryRun) {
      await prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { role: canonical },
      });
    }
    inviteUpdates++;
  }

  console.log(
    `  Invites: ${inviteUpdates} updated, ${inviteSkipped} already canonical (${invites.length} total)`,
  );

  // --- Verification ---
  if (!dryRun) {
    const nonCanonicalUsers = await prisma.user.findMany({
      where: { role: { notIn: CANONICAL_ROLES } },
      select: { id: true, role: true },
    });

    const nonCanonicalInvites = await prisma.organizationInvite.findMany({
      where: { role: { notIn: CANONICAL_ROLES } },
      select: { id: true, role: true },
    });

    if (nonCanonicalUsers.length > 0 || nonCanonicalInvites.length > 0) {
      console.error('\n❌ VERIFICATION FAILED: Non-canonical roles still exist!');
      console.error('  Users:', nonCanonicalUsers);
      console.error('  Invites:', nonCanonicalInvites);
      process.exit(1);
    }

    console.log('\n✅ Verification passed: all roles are canonical.');
  }

  console.log(`\n✅ Backfill complete${dryRun ? ' (DRY RUN — no changes made)' : ''}.\n`);
}

const dryRun = process.argv.includes('--dry-run');

backfillRoles(dryRun)
  .catch((error) => {
    console.error('❌ Backfill failed:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
