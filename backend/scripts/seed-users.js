#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

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

    // Step 3: Hash the default PINs
    const managerPinHash = await bcrypt.hash('5624', 10);
    const staffPinHash = await bcrypt.hash('1234', 10);

    // Step 4: Create or update default users with organization assigned
    const managerUser = await prisma.user.upsert({
      where: { id: 1 },
      update: {
        role: 'Manager',
        pin: managerPinHash,
        organizationId: organization.id,
      },
      create: {
        id: 1,
        role: 'Manager',
        pin: managerPinHash,
        organizationId: organization.id,
      },
    });

    const staffUser = await prisma.user.upsert({
      where: { id: 2 },
      update: {
        role: 'Staff',
        pin: staffPinHash,
        organizationId: organization.id,
      },
      create: {
        id: 2,
        role: 'Staff',
        pin: staffPinHash,
        organizationId: organization.id,
      },
    });

    console.log('✅ User seeding completed successfully');

    console.log('\n✅ Default organization and users created:');
    console.log('   Organization: Default Organization');
    console.log('   Manager: PIN 5624 (Role: Manager)');
    console.log('   Staff:   PIN 1234 (Role: Staff)');
    console.log('\nYou can now log in with either PIN.');
  } catch (error) {
    console.error('User seeding failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding function
seedUsers();
