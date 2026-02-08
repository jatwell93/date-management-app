#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function seedUsers() {
  try {
    console.log('Starting user seeding...');

    // Hash the default PINs
    const managerPinHash = await bcrypt.hash('5624', 10);
    const staffPinHash = await bcrypt.hash('1234', 10);

    // Create or update default users
    const managerUser = await prisma.user.upsert({
      where: { id: 1 },
      update: {
        role: 'Manager',
        pin: managerPinHash,
      },
      create: {
        id: 1,
        role: 'Manager',
        pin: managerPinHash,
      },
    });

    const staffUser = await prisma.user.upsert({
      where: { id: 2 },
      update: {
        role: 'Staff',
        pin: staffPinHash,
      },
      create: {
        id: 2,
        role: 'Staff',
        pin: staffPinHash,
      },
    });

    console.log('User seeding completed successfully');

    console.log('\n✅ Default users created:');
    console.log('   Manager: PIN 5624');
    console.log('   Staff:   PIN 1234');
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