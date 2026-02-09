/**
 * Organization usage data model
 * Tracks resource usage and quota enforcement per organization
 */

export interface OrganizationUsage {
  id: number;
  organizationId: string;
  activeUsers: number;
  maxUsers: number;
  totalSkus: number;
  maxSkus: number;
  storageUsedBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationUsageInput {
  organizationId: string;
  maxUsers: number;
  maxSkus: number;
}

export interface UpdateOrganizationUsageInput {
  activeUsers?: number;
  totalSkus?: number;
  storageUsedBytes?: number;
}

/**
 * Helper interface for usage quota checks
 */
export interface UsageQuotaCheck {
  exceeded: boolean;
  current: number;
  max: number;
  percentageUsed: number;
  remainingCapacity: number;
}
