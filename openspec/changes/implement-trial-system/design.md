# Design: Trial System Implementation (with Clerk Auth)

## Architecture Overview

```
Clerk Auth → Signup → SubscriptionService → Trial Expiration Job → Auto-Downgrade
              ↓           ↑
         Email Verification    SendGrid (Business Emails)
              ↓
         Trial Abuse Check
              ↓
         Disposable Email Lib
```

---

## Database Schema Changes

### User Model (Updated for Clerk)

```prisma
model User {
  id             Int       @id @default(autoincrement())
  clerkUserId    String    @unique  // From Clerk
  email          String    @unique  // From Clerk
  username       String    @unique  // From Clerk - for audit trail display
  organizationId String?   @map("organization_id")
  role           String    // admin, member, viewer (managed in app DB)
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  // Relations
  organization             Organization?            @relation(fields: [organizationId], references: [id])
  auditLogs                AuditLog[]               // Track which user performed actions
  itemTransactions         ItemTransaction[]
  expiredItemTransactions  ExpiredItemTransaction[]
  uploads                  Upload[]
  refreshTokens            RefreshToken[]

  @@index([clerkUserId])
  @@index([username])
  @@index([organizationId])
  @@map("users")
}
```

**Changes**:
- ❌ Remove `pin` field
- ✅ Add `clerkUserId` (links to Clerk)
- ✅ Add `email` (from Clerk, unique)
- ✅ Add `username` (from Clerk, unique) **for audit logging**
- ✅ Keep `role` (mapped to Clerk's within-org roles)

### SubscriptionTier Model (Extended)

```prisma
model SubscriptionTier {
  // Existing fields
  id                   String    @id @default(cuid())
  organizationId       String    @unique
  tierLevel            TierLevel
  stripeSubscriptionId String?
  stripeCustomerId     String    // NEW: Created when org created, reused for billing
  status               SubscriptionStatus
  
  // NEW: Trial fields
  trialEndDate         DateTime?           // NULL for non-trial subscriptions
  trialStartedAt       DateTime?           // When trial began
  trialConvertedAt     DateTime?           // When user upgraded from trial
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  // Relations
  organization         Organization @relation(fields: [organizationId], references: [id])
  trialEvents          TrialEvent[]

  @@index([status])
  @@index([trialEndDate])
  @@map("subscription_tiers")
}

enum SubscriptionStatus {
  ACTIVE = "active"
  CANCELED = "canceled"
  PAST_DUE = "past_due"
  TRIALING = "trialing"
}
```

**Key Addition**:
- `stripeCustomerId`: Create once when org created, reuse for trial + conversion (fixes Issue #2)

### TrialEvent Model (New)

```prisma
model TrialEvent {
  id             String    @id @default(cuid())
  organizationId String
  eventType      String    // trial_started | trial_converted | trial_expired
  occurredAt     DateTime  @default(now())
  metadata       Json?     // { daysTrialed: 14, downgradedToTier: "starter", ... }
  sentRemindersAt Json?    // { 10: true, 5: true, 2: true } for idempotency
  
  // Relations
  subscription   SubscriptionTier @relation(fields: [organizationId], references: [organizationId])
  
  @@index([organizationId])
  @@index([eventType])
  @@index([occurredAt])
  @@map("trial_events")
}

### OrganizationInvite Model (MVP)

```prisma
model OrganizationInvite {
  id              String    @id @default(cuid())
  organizationId  String
  email           String
  role            String    // admin, member
  token           String    @unique
  status          String    // PENDING, ACCEPTED, EXPIRED, REVOKED
  expiresAt       DateTime
  acceptedAt      DateTime?
  invitedByUserId Int
  createdAt       DateTime  @default(now())

  organization    Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId])
  @@index([email])
  @@index([status])
  @@map("organization_invites")
}
```
```

**Key Feature**:
- `sentRemindersAt`: Track which reminders sent (fixes Issue #8 - idempotency)

---

## Service Layer

### SubscriptionService (Extended)

**New Methods**:

```typescript
/**
 * Create Stripe customer for organization (called when org created, not on trial)
 */
async createStripeCustomer(organizationId: string, email: string): Promise<string> {
  const customer = await this.stripe.customers.create({
    email,
    metadata: { organizationId },
  });
  
  // Store in DB
  await this.prisma.subscriptionTier.update({
    where: { organizationId },
    data: { stripeCustomerId: customer.id },
  });
  
  return customer.id;
}

/**
 * Create trial subscription
 */
async createTrialSubscription(
  organizationId: string,
  trialDays: number = 14,
): Promise<SubscriptionTier> {
  const trialEndDate = addDays(new Date(), trialDays);
  
  return await this.prisma.subscriptionTier.create({
    data: {
      organizationId,
      tierLevel: 'professional',
      status: SubscriptionStatus.TRIALING,
      trialEndDate,
      trialStartedAt: new Date(),
      // stripeSubscriptionId: null (none until conversion)
    },
  });
}

/**
 * Convert trial to paid subscription (wrapped in transaction)
 */
async convertTrialToPaid(
  organizationId: string,
  stripePaymentMethodId: string,
  billingCycle: BillingCycle = BillingCycle.MONTHLY,
): Promise<SubscriptionTier> {
  // Use transaction for atomicity (fixes Issue #5)
  return await this.prisma.$transaction(async (tx) => {
    const trial = await tx.subscriptionTier.findUniqueOrThrow({
      where: { organizationId },
    });

    if (trial.status !== SubscriptionStatus.TRIALING) {
      throw new BadRequestError('Not in a trial period');
    }

    // Create Stripe subscription
    const stripePrice = this.getStripePrice('professional', billingCycle);
    const subscription = await this.stripe.subscriptions.create({
      customer: trial.stripeCustomerId, // ✅ Already created at org creation
      items: [{ price: stripePrice }],
      payment_method: stripePaymentMethodId,
      default_payment_method: stripePaymentMethodId,
      payment_behavior: 'error_if_incomplete', // Fail fast if payment declines
    });

    // Update local DB atomically
    const updated = await tx.subscriptionTier.update({
      where: { organizationId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        stripeSubscriptionId: subscription.id,
        trialConvertedAt: new Date(),
      },
    });

    // Log event
    await tx.trialEvent.create({
      data: {
        organizationId,
        eventType: 'trial_converted',
        metadata: {
          daysTrialed: differenceInDays(new Date(), trial.trialStartedAt),
          stripeSubscriptionId: subscription.id,
          billingCycle,
        },
      },
    });

    return updated;
  });
}

/**
 * Downgrade expired trials (wrapped in transaction)
 */
async downgradeExpiredTrials(): Promise<number> {
  return await this.prisma.$transaction(async (tx) => {
    const now = new Date();
    
    const expiredTrials = await tx.subscriptionTier.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        trialEndDate: { lt: now },
      },
    });

    let downgraded = 0;
    for (const trial of expiredTrials) {
      await tx.subscriptionTier.update({
        where: { id: trial.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          tierLevel: 'starter',
          stripeSubscriptionId: null,
        },
      });

      const daysTrialed = differenceInDays(now, trial.trialStartedAt);
      
      // Log event
      await tx.trialEvent.create({
        data: {
          organizationId: trial.organizationId,
          eventType: 'trial_expired',
          metadata: {
            daysTrialed,
            downgradedToTier: 'starter',
          },
        },
      });

      downgraded++;
    }

    return downgraded;
  });
}

/**
 * Find trials that need reminder emails (fixes Issue #3 - correct method name/logic)
 */
async findTrialsNeedingReminders(): Promise<Array<{
  organizationId: string;
  daysRemaining: number;
  userEmail: string;
  organizationName: string;
}>> {
  const now = new Date();
  
  const trialsNeedingReminders = await this.prisma.subscriptionTier.findMany({
    where: {
      status: SubscriptionStatus.TRIALING,
      trialEndDate: {
        gte: now, // Trial hasn't expired yet
        lt: addDays(now, 1), // Will expire in next 24 hours (check specific days via daysRemaining calc)
      },
    },
    include: {
      organization: {
        include: {
          users: {
            where: { role: 'admin' }, // Send to org admin
            select: { email: true },
          },
        },
      },
      trialEvents: {
        where: { eventType: 'trial_started' },
        orderBy: { occurredAt: 'desc' },
        take: 1,
      },
    },
  });

  return trialsNeedingReminders
    .map((trial) => ({
      organizationId: trial.organizationId,
      daysRemaining: differenceInDays(trial.trialEndDate, now),
      userEmail: trial.organization.users[0]?.email || '',
      organizationName: trial.organization.name,
    }))
    .filter(
      (reminder) =>
        reminder.daysRemaining > 0 &&
        [10, 5, 2].includes(reminder.daysRemaining) &&
        reminder.userEmail, // Only if we have contact email
    );
}

/**
 * Log trial event with idempotency check
 */
async logTrialEvent(
  organizationId: string,
  eventType: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await this.prisma.trialEvent.create({
    data: {
      organizationId,
      eventType,
      metadata,
    },
  });
}
```

### TrialAbuseGuard (New Service)

```typescript
import { isDisposableEmail } from 'disposable-email';

export class TrialAbuseGuard {
  constructor(private prisma: PrismaClient) {}

  /**
   * Validate email for trial fraud (Clerk handles uniqueness)
   */
  async validateTrialSignup(email: string): Promise<{
    isValid: boolean;
    reason?: string;
  }> {
    // Check 1: Disposable email
    if (isDisposableEmail(email)) {
      return {
        isValid: false,
        reason: 'Disposable email addresses are not allowed for trials',
      };
    }

    // Check 2: Email not already used (Clerk enforces login uniqueness, check trial subscriptions)
    const existingSubscription = await this.prisma.subscriptionTier.findFirst({
      where: {
        organization: {
          users: {
            some: { email },
          },
        },
      },
    });

    if (existingSubscription) {
      return {
        isValid: false,
        reason: 'This email is already in use. Log in instead or use a different email.',
      };
    }

    return { isValid: true };
  }
}
```

### AuditLog Service (Enhanced for Username Tracking)

```typescript
/**
 * Log action with username from JWT
 * Enables: "jsmith checked 15 items for expiry on Feb 17"
 */
async logAction(
  organizationId: string,
  userId: number,
  itemId: number,
  action: string, // 'checked_expiry', 'marked_expired', etc.
  metadata?: Record<string, unknown>,
): Promise<void> {
  const user = await this.prisma.user.findUniqueOrThrow({
    where: { id: userId },
  });

  await this.prisma.auditLog.create({
    data: {
      userId,
      username: user.username, // Display name in audit trail
      organizationId,
      action,
      targetId: itemId,
      metadata,
      timestamp: new Date(),
    },
  });
}
```

**Managers can now query audit trail:**
```sql
SELECT username, action, COUNT(*) as count 
FROM audit_logs 
WHERE organization_id = 'org_123' 
  AND action = 'checked_expiry'
  AND timestamp > NOW() - INTERVAL '7 days'
GROUP BY username, action
ORDER BY count DESC;
-- Result: "jsmith: 247 expiry checks", "mchen: 189 expiry checks"
```

---

### EmailService (Extended)

```typescript
/**
 * Send trial reminder via SendGrid (not Clerk)
 */
async sendTrialReminder(
  to: string,
  organizationName: string,
  daysRemaining: number,
  upgradeUrl: string,
): Promise<void> {
  const templateId = process.env.SENDGRID_TRIAL_REMINDER_TEMPLATE_ID;

  await this.sendEmailWithTemplate(to, templateId, {
    organizationName,
    daysRemaining,
    upgradeUrl,
    supportEmail: process.env.SUPPORT_EMAIL,
  });

  this.logger.info(
    `Trial reminder sent to ${to}, days remaining: ${daysRemaining}`,
  );
}

/**
 * Send downgrade warning email
 */
async sendTrialDowngradeWarning(
  to: string,
  organizationName: string,
  upgradeUrl: string,
): Promise<void> {
  const templateId = process.env.SENDGRID_TRIAL_DOWNGRADE_TEMPLATE_ID;

  await this.sendEmailWithTemplate(to, templateId, {
    organizationName,
    upgradeUrl,
    starterTierInfo: {
      maxSkus: 500,
      maxUsers: 1,
    },
    supportEmail: process.env.SUPPORT_EMAIL,
  });

  this.logger.info(`Trial downgrade warning sent to ${to}`);
}
```

---

## API Design

### Signup Endpoint (Using Clerk)

```
POST /api/auth/signup (via Clerk SDK)

Request:
{
  "email": "pharmacy@example.com",
  "password": "...",
  "firstName": "John",
  "lastName": "Pharmacy",
  "unsafeMetadata": {
    "organizationName": "ABC Pharmacy",
    "trialPlan": "professional"  // Indicates trial signup
  }
}

Response (Clerk webhook populates local DB after email verification):
{
  "organizationId": "org_abc123",
  "subscriptionStatus": "trialing",
  "trialEndDate": "2026-03-03T00:00:00Z",
  "daysRemaining": 14,
  "tierLevel": "professional",
  "tierLimits": {
    "maxSkus": 2000,
    "maxUsers": 3
  }
}
```

### Trial Status Endpoint

```
GET /api/subscription/trial-status
Authorization: Bearer <Clerk JWT>

Response (Trial User):
{
  "isInTrial": true,
  "trialStartDate": "2026-02-17T00:00:00Z",
  "trialEndDate": "2026-03-03T00:00:00Z",
  "daysRemaining": 14,
  "tierLevel": "professional",
  "tierLimits": { "maxSkus": 2000, "maxUsers": 3 },
  "upgradeUrl": "https://checkout.stripe.com/..."
}

Response (Non-Trial User):
{
  "isInTrial": false,
  "tierLevel": "starter",
  "tierLimits": { "maxSkus": 500, "maxUsers": 1 }
}
```

### Trial Conversion Endpoint

```
POST /api/subscription/convert-trial
Authorization: Bearer <Clerk JWT>

Request:
{
  "stripePaymentMethodId": "pm_123abc",
  "billingCycle": "monthly"
}

Response:
{
  "status": "active",
  "tierLevel": "professional",
  "stripeSubscriptionId": "sub_123abc",
  "nextBillingDate": "2026-03-17T00:00:00Z",
  "amount": 99,
  "currency": "USD"
}
```

---

## Scheduled Job

### Trial Expiration Job (Daily, 00:00 UTC)

```typescript
export async function runTrialExpirationJob() {
  const subscriptionService = new SubscriptionService();
  const emailService = new EmailService();

  try {
    // Step 1: Downgrade expired trials (atomic)
    const downgraded = await subscriptionService.downgradeExpiredTrials();
    this.logger.info(`Downgraded ${downgraded} expired trials`);

    // Step 2: Send downgrade warning emails
    // (Query DB for trials that just downgraded, send emails)

    // Step 3: Find trials needing reminders
    const reminders = await subscriptionService.findTrialsNeedingReminders();

    // Step 4: Send reminder emails (with idempotency check)
    for (const reminder of reminders) {
      try {
        await emailService.sendTrialReminder(
          reminder.userEmail,
          reminder.organizationName,
          reminder.daysRemaining,
          generateUpgradeUrl(reminder.organizationId),
        );
      } catch (error) {
        this.logger.error(`Failed to send reminder for ${reminder.organizationId}`, error);
        // Continue with next reminder, don't crash job
      }
    }

    this.logger.info(
      `Trial job completed: ${downgraded} downgrades, ${reminders.length} reminders sent`,
    );
  } catch (error) {
    this.logger.error('Trial job failed', error);
    await Sentry.captureException(error); // Alert ops
    // Job continues running, doesn't crash app
  }
}
```

**Scheduled with node-cron**:
```typescript
cron.schedule('0 0 * * *', runTrialExpirationJob); // Daily 00:00 UTC
```

---

## Clerk Integration Points

### Frontend (React CRA)

```typescript
import { SignUp, useAuth, useUser } from "@clerk/react";

// Clerk handles:
// - Email/password signup via <SignUp /> component
// - Username field (from Clerk dashboard config)
// - Google OAuth
// - Microsoft OAuth
// App receives authenticated user + JWT with username included

// In protected routes:
const { isLoaded, userId } = useAuth();
const { user } = useUser();
// Access: user.username for audit logs, user.emailAddresses[0].emailAddress
```

### Backend (Express)

```typescript
import { verifyToken } from "@clerk/backend";

// Verify JWT from React frontend Authorization header
const token = req.headers.authorization?.split(" ")[1];
const decoded = await verifyToken(token);
// decoded includes: { sub: userId, username, email, org }
// Use decoded.username in audit logs
```

### Webhook (Clerk → Backend)

```typescript
// Listener: POST /webhooks/clerk
// Clerk sends user.created event with:
// {
//   "data": {
//     "id": "user_abc123",
//     "username": "jsmith",
//     "email_addresses": [{ "email_address": "john@example.com" }]
//   }
// }

// Handler:
// 1. Verify webhook signature
// 2. Create Organization record
// 3. Create User record: { clerkUserId, email, username, organizationId }
// 4. Create SubscriptionTier with trial status
// 5. Respond with 200
```

**Clerk Configuration (Already Done):**
- ✅ Email/password enabled
- ✅ Username field enabled (will be populated during signup)
- ✅ Google OAuth provider
- ✅ Microsoft OAuth provider
- ✅ Webhook endpoint configured in Clerk dashboard

---

## Issues Fixed

| Issue | Fix |
|-------|-----|
| #1: Auth model mismatch | Use Clerk (email/password + OAuth) |
| #2: No Stripe customer | Create customer when org created, reuse for trial + conversion |
| #3: Wrong service method | Fixed: `findTrialsNeedingReminders()` instead of undefined method |
| #4: Downgrade job missing email | Added to `runTrialExpirationJob()` |
| #5: Race condition | Use `$transaction` for atomic updates |
| #6: Phone field | Clerk provides email, phone optional (not needed Phase 4) |
| #7: Timezone cutoff | Documented: trials end at 00:00 UTC, stored consistently |
| #8: Email idempotency | Track sent reminders in `sentRemindersAt` JSON |
| #9: Error handling | Try/catch in job, log to Sentry, don't crash |
| #10: Stripe payment intent | Use `payment_behavior: 'error_if_incomplete'` for fail-fast |
| #11: Org-user auth | Clerk tenant isolation + organizationId filters |
| #12: Idempotency tests | Added to Phase 7 |

---

## Security

1. ✅ Clerk handles PCI compliance (no card numbers stored locally)
2. ✅ Email validated by Clerk + additional disposable check
3. ✅ organizationId filters prevent cross-tenant access
4. ✅ Transactions prevent race condition exploits
5. ✅ Sentry logs errors without PII leaks
