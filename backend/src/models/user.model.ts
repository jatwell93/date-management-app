import { TierLevel } from '../types/subscription';

export interface User {
  id: number;
  organizationId: string;
  clerkUserId?: string | null;
  email?: string | null;
  username?: string | null;
  pin?: string | null;
  role: 'Manager' | 'Team Member' | 'admin' | 'member';
  created_at: string;
  updated_at: string;
}
