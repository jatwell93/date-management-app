export interface StoreArea {
  id: number;
  name: string;
  subDepartment?: string | null;
  parentId?: number | null;
  lastChecked?: string | null;
}

export interface StoreAreaApiResponse extends StoreArea {
  last_checked?: string | null;
}

export type BayCheckState = 'checked' | 'not_checked' | 'overdue';

export interface FloorProgressSummary {
  totalBays: number;
  checkedBays: number;
  notCheckedBays: number;
  overdueBays: number;
  coveragePercent: number;
  uncheckedBays: number;
}

export interface FloorProgressBay {
  id: number;
  name: string;
  parentId: number | null;
  state: BayCheckState;
  checkedAt: string | null;
  checkedBy: { id: number; name: string | null } | null;
}

export interface FloorProgressDepartment {
  department: { id: number | null; name: string };
  summary: FloorProgressSummary;
  bays: FloorProgressBay[];
}

export interface FloorProgress {
  activeCycle: { id: number; name: string; status: 'active' | 'completed' } | null;
  summary: FloorProgressSummary;
  departments: FloorProgressDepartment[];
}

export type InvalidField = 'addAreaName' | 'editAreaName' | null;

export const AREA_NAME_MAX_LENGTH = 100;
export const SUB_DEPARTMENT_MAX_LENGTH = 50;

const storeAreaDateFormatter = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function normalizeStoreArea(area: StoreAreaApiResponse): StoreArea {
  return {
    id: area.id,
    name: area.name,
    subDepartment: area.subDepartment,
    parentId: area.parentId ?? null,
    lastChecked: area.lastChecked ?? area.last_checked ?? null,
  };
}

export function formatLastChecked(lastChecked?: string | null): string {
  if (!lastChecked) {
    return 'Not checked';
  }

  const checkedAt = new Date(lastChecked);
  if (Number.isNaN(checkedAt.getTime())) {
    return 'Date unavailable';
  }

  return storeAreaDateFormatter.format(checkedAt);
}

export function getUnknownErrorMessage(action: string): string {
  return `We could not ${action}. Try again.`;
}

export function renderBayState(bay: FloorProgressBay): string {
  if (bay.state === 'checked') return 'Checked this cycle';
  if (bay.state === 'overdue') return 'Overdue';
  return 'Not yet checked';
}
