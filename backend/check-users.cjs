const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check if any users exist
  const users = await prisma.user.findMany({
    include: {
      organization: {
        include: {
          subscriptionTiers: true,
        },
      },
    },
  });

  console.log(`Found ${users.length} users in database:`);

  users.forEach((user) => {
    console.log(`\n- User: ${user.email || user.username || 'No email'}`);
    console.log(`  Clerk ID: ${user.clerkUserId}`);
    console.log(`  Organization: ${user.organization?.name || 'None'}`);

    if (user.organization?.subscriptionTiers?.length > 0) {
      const sub = user.organization.subscriptionTiers[0];
      console.log(`  Subscription: ${sub.status} - ${sub.tierLevel}`);
      console.log(`  Trial ends: ${sub.trialEndDate}`);
    } else {
      console.log(`  No subscription found`);
    }
  });
}

main().finally(() => prisma.$disconnect());
