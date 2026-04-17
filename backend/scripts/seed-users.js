#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedUsers() {
  try {
    console.log('Starting user seeding...');

    // Step 1: Create or get the default organization
    let organization = await prisma.organization.findFirst({
      where: { slug: 'default' },
    });

    if (!organization) {
      console.log('Creating default organization...');
      organization = await prisma.organization.create({
        data: {
          name: 'Default Organization',
          slug: 'default',
        },
      });
      console.log('✅ Organization created:', organization.id);
    } else {
      console.log('Using existing organization:', organization.id);
    }

    // Step 2: Create or ensure subscription tier exists for the organization
    let subscriptionTier = await prisma.subscriptionTier.findFirst({
      where: { organizationId: organization.id },
    });

    if (!subscriptionTier) {
      console.log('Creating subscription tier for organization...');
      subscriptionTier = await prisma.subscriptionTier.create({
        data: {
          organizationId: organization.id,
          tierLevel: 'professional',
          status: 'active',
          billingCycle: 'monthly',
        },
      });
      console.log('✅ Subscription tier created:', subscriptionTier.id);
    } else {
      console.log(
        'Subscription tier exists:',
        subscriptionTier.id,
        'Status:',
        subscriptionTier.status,
      );
    }

    // Step 3: Create or update default users with canonical roles
    const adminUser = await prisma.user.upsert({
      where: { id: 1 },
      update: {
        role: 'admin',
        organizationId: organization.id,
      },
      create: {
        id: 1,
        role: 'admin',
        organizationId: organization.id,
      },
    });

    const teamMemberUser = await prisma.user.upsert({
      where: { id: 2 },
      update: {
        role: 'team_member',
        organizationId: organization.id,
      },
      create: {
        id: 2,
        role: 'team_member',
        organizationId: organization.id,
      },
    });

    console.log('✅ User seeding completed successfully');

    console.log('\n✅ Default organization and users created:');
    console.log('   Organization: Default Organization');
    console.log('   Admin user (id: 1, role: admin)');
    console.log('   Team member (id: 2, role: team_member)');
    console.log('\nSign in via Clerk to authenticate.');
  } catch (error) {
    console.error('User seeding failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding function
seedUsers();
