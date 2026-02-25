const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find the teststripe user
  const user = await prisma.user.findFirst({
    where: { email: 'teststripe@mailinator.com' },
  });

  if (!user) {
    console.log('User teststripe@mailinator.com not found');
    return;
  }

  console.log('Found user:', user.id, user.clerkUserId);

  if (user.organizationId) {
    console.log('User already has organization:', user.organizationId);
    
    // Check if subscription exists
    const sub = await prisma.subscriptionTier.findFirst({
      where: { organizationId: user.organizationId },
    });
    
    if (sub) {
      console.log('Subscription already exists:', sub.status, sub.tierLevel);
    } else {
      // Create trial subscription
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      trialEnd.setHours(0, 0, 0, 0);
      
      const newSub = await prisma.subscriptionTier.create({
        data: {
          organizationId: user.organizationId,
          tierLevel: 'PROFESSIONAL',
          status: 'TRIALING',
          trialStartedAt: new Date(),
          trialEndDate: trialEnd,
          billingCycle: 'monthly',
        },
      });
      console.log('Created trial subscription:', newSub.id);
    }
    return;
  }

  // Create organization
  const org = await prisma.organization.create({
    data: {
      name: 'Test Stripe Org',
      slug: `test-stripe-org-${Date.now()}`,
      contactEmail: 'teststripe@mailinator.com',
    },
  });

  console.log('Created organization:', org.id);

  // Update user with organization
  await prisma.user.update({
    where: { id: user.id },
    data: { organizationId: org.id, role: 'Manager' },
  });

  console.log('Updated user with organization');

  // Create trial subscription
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);
  trialEnd.setHours(0, 0, 0, 0);

  const subscription = await prisma.subscriptionTier.create({
    data: {
      organizationId: org.id,
      tierLevel: 'PROFESSIONAL',
      status: 'TRIALING',
      trialStartedAt: new Date(),
      trialEndDate: trialEnd,
      billingCycle: 'monthly',
    },
  });

  console.log('Created trial subscription:', subscription.id);
  console.log('Trial ends:', trialEnd);
  console.log('\n✅ User teststripe@mailinator.com is now ready for testing!');
}

main().finally(() => prisma.$disconnect());
