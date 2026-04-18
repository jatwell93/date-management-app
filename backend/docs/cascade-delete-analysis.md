# Cascade Delete Analysis and Recommendations

## Critical Issues Found

### 1. User Deletion Cascade

**Current Behavior**: When a user is removed from an organization in Clerk, the webhook hard-deletes the user record.
**Impact**: This cascades to delete:

- All audit logs created by the user
- All item transactions created by the user
- All expired item transactions created by the user
- All refresh tokens for the user
- All uploads created by the user

**Problem**: Audit history is lost, making it impossible to track who did what.

### 2. Organization Deletion Cascade

**Current Behavior**: Deleting an organization cascades to delete ALL data.
**Impact**: Complete data loss including:

- All inventory items
- All products
- All store areas
- All audit logs
- All transactions
- All usage records

## Recommended Changes

### 1. Change Audit Log FK to `SET NULL`

```prisma
model AuditLog {
  // ... other fields
  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)
  // ...
}
```

### 2. Change Transaction FKs to `SET NULL`

```prisma
model ItemTransaction {
  // ... other fields
  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)
  // ...
}

model ExpiredItemTransaction {
  // ... other fields
  user User @relation(fields: [userId], references: [id], onDelete: SetNull)
  // ...
}
```

### 3. Implement Soft Delete for Users

Add a `deletedAt` field to User model:

```prisma
model User {
  // ... other fields
  deletedAt DateTime? @map("deleted_at")
  // ...
}
```

### 4. Update Clerk Webhook to Soft Delete

Instead of `deleteMany`, use `updateMany`:

```typescript
await this.prisma.user.updateMany({
  where: { clerkUserId, organization: { clerkOrganizationId: clerkOrgId } },
  data: { deletedAt: new Date() },
});
```

### 5. Add Migration for Safer FKs

Create a new migration to change the delete rules.

## Immediate Action Required

The current setup risks permanent data loss. We should:

1. Implement soft delete for users immediately
2. Change audit log FK to preserve history
3. Consider if organization deletion should be allowed at all
