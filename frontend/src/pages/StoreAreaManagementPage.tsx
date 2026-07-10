import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { apiService } from '../lib/api.service';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

interface StoreArea {
  id: number;
  name: string;
  subDepartment?: string | null;
  parentId?: number | null;
  lastChecked?: string | null;
}

interface StoreAreaApiResponse extends StoreArea {
  last_checked?: string | null;
}

interface StoreAreaManagementPageProps {
  token: string | null;
}

type BayCheckState = 'checked' | 'not_checked' | 'overdue';

interface FloorProgressSummary {
  totalBays: number;
  checkedBays: number;
  notCheckedBays: number;
  overdueBays: number;
  coveragePercent: number;
  uncheckedBays: number;
}

interface FloorProgressBay {
  id: number;
  name: string;
  parentId: number | null;
  state: BayCheckState;
  checkedAt: string | null;
  checkedBy: { id: number; name: string | null } | null;
}

interface FloorProgressDepartment {
  department: { id: number | null; name: string };
  summary: FloorProgressSummary;
  bays: FloorProgressBay[];
}

interface FloorProgress {
  activeCycle: { id: number; name: string; status: 'active' | 'completed' } | null;
  summary: FloorProgressSummary;
  departments: FloorProgressDepartment[];
}

const storeAreaDateFormatter = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const AREA_NAME_MAX_LENGTH = 100;
const SUB_DEPARTMENT_MAX_LENGTH = 50;

type InvalidField = 'addAreaName' | 'editAreaName' | null;

function normalizeStoreArea(area: StoreAreaApiResponse): StoreArea {
  return {
    id: area.id,
    name: area.name,
    subDepartment: area.subDepartment,
    parentId: area.parentId ?? null,
    lastChecked: area.lastChecked ?? area.last_checked ?? null,
  };
}

function formatLastChecked(lastChecked?: string | null): string {
  if (!lastChecked) {
    return 'Not checked';
  }

  const checkedAt = new Date(lastChecked);
  if (Number.isNaN(checkedAt.getTime())) {
    return 'Date unavailable';
  }

  return storeAreaDateFormatter.format(checkedAt);
}

function getUnknownErrorMessage(action: string): string {
  return `We could not ${action}. Try again.`;
}

function renderBayState(bay: FloorProgressBay) {
  if (bay.state === 'checked') return 'Checked this cycle';
  if (bay.state === 'overdue') return 'Overdue';
  return 'Not yet checked';
}

interface FloorProgressSectionProps {
  floorProgress: FloorProgress | null;
  isLoadingProgress: boolean;
  isCompletingCycle: boolean;
  isStartingCycle: boolean;
  checkingBayId: number | null;
  newCycleName: string;
  onNewCycleNameChange: (value: string) => void;
  onStartCycle: () => void;
  onCompleteCycle: () => void;
  onRecordBayCheck: (bay: FloorProgressBay) => void;
}

function FloorProgressSection({
  floorProgress,
  isLoadingProgress,
  isCompletingCycle,
  isStartingCycle,
  checkingBayId,
  newCycleName,
  onNewCycleNameChange,
  onStartCycle,
  onCompleteCycle,
  onRecordBayCheck,
}: FloorProgressSectionProps) {
  return (
    <section className="mb-8 space-y-4" aria-labelledby="floor-progress-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="floor-progress-heading" className="text-lg font-semibold font-heading">
            Floor Progress
          </h3>
          {floorProgress?.activeCycle ? (
            <p className="text-sm text-semantic-text-secondary">{floorProgress.activeCycle.name}</p>
          ) : (
            <p className="text-sm text-semantic-text-secondary">No active store walk.</p>
          )}
        </div>
        {floorProgress?.activeCycle ? (
          <Button
            onClick={onCompleteCycle}
            disabled={isCompletingCycle}
            variant="outline"
            className="min-h-11"
          >
            {isCompletingCycle ? 'Completing walk' : 'Complete walk'}
          </Button>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="newCycleName">Walk name</Label>
              <Input
                id="newCycleName"
                value={newCycleName}
                onChange={(event) => onNewCycleNameChange(event.target.value)}
                placeholder="July walk"
                maxLength={100}
              />
            </div>
            <Button
              onClick={onStartCycle}
              disabled={isStartingCycle || !newCycleName.trim()}
              className="min-h-11"
            >
              {isStartingCycle ? 'Starting walk' : 'Start walk'}
            </Button>
          </div>
        )}
      </div>

      {isLoadingProgress ? (
        <p role="status" className="text-sm text-semantic-text-secondary">
          Loading floor progress...
        </p>
      ) : floorProgress ? (
        <FloorProgressDepartments
          floorProgress={floorProgress}
          checkingBayId={checkingBayId}
          onRecordBayCheck={onRecordBayCheck}
        />
      ) : null}
    </section>
  );
}

function FloorProgressDepartments({
  floorProgress,
  checkingBayId,
  onRecordBayCheck,
}: {
  floorProgress: FloorProgress;
  checkingBayId: number | null;
  onRecordBayCheck: (bay: FloorProgressBay) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium text-semantic-text-primary">Store coverage</span>
          <span className="tabular-nums text-semantic-text-secondary">
            {floorProgress.summary.coveragePercent}%
          </span>
        </div>
        <div className="h-2 rounded bg-semantic-surface-3">
          <div
            className="h-2 rounded bg-semantic-success"
            style={{ width: `${floorProgress.summary.coveragePercent}%` }}
          />
        </div>
      </div>

      {floorProgress.departments.length === 0 ? (
        <p className="text-sm text-semantic-text-tertiary">
          Add bays under departments to track this walk.
        </p>
      ) : (
        <div className="space-y-4">
          {floorProgress.departments.map((department) => (
            <section
              key={department.department.id ?? department.department.name}
              className="rounded-md border border-hairline bg-semantic-surface-2 p-3"
              aria-label={`${department.department.name} progress`}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="font-heading text-base font-semibold">
                  {department.department.name}
                </h4>
                <span className="text-sm tabular-nums text-semantic-text-secondary">
                  {department.summary.coveragePercent}%
                </span>
              </div>
              <div className="grid gap-2">
                {department.bays.map((bay) => (
                  <div
                    key={bay.id}
                    className="grid gap-2 rounded border border-hairline bg-semantic-surface-1 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-medium text-semantic-text-primary">{bay.name}</p>
                      <p className="text-sm text-semantic-text-secondary">
                        {renderBayState(bay)}
                        {bay.checkedBy?.name ? ` by ${bay.checkedBy.name}` : ''}
                        {bay.checkedAt ? ` at ${formatLastChecked(bay.checkedAt)}` : ''}
                      </p>
                    </div>
                    <Button
                      variant={bay.state === 'checked' ? 'outline' : 'default'}
                      className="min-h-11"
                      disabled={bay.state === 'checked' || checkingBayId !== null}
                      onClick={() => onRecordBayCheck(bay)}
                      aria-label={`Mark ${bay.name} checked`}
                    >
                      {checkingBayId === bay.id ? 'Checking' : 'Mark checked'}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function StoreAreaManagementPage({ token }: StoreAreaManagementPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [newAreaName, setNewAreaName] = useState<string>('');
  const [newSubDepartmentName, setNewSubDepartmentName] = useState<string>('');
  const [newParentDepartmentId, setNewParentDepartmentId] = useState<string>('');
  const [editingArea, setEditingArea] = useState<StoreArea | null>(null);
  const [editingDialogKey, setEditingDialogKey] = useState<string | null>(null);
  const [editedAreaName, setEditedAreaName] = useState<string>('');
  const [editedSubDepartmentName, setEditedSubDepartmentName] = useState<string>('');
  const [floorProgress, setFloorProgress] = useState<FloorProgress | null>(null);
  const [newCycleName, setNewCycleName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidField>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoadingAreas, setIsLoadingAreas] = useState<boolean>(false);
  const [isLoadingProgress, setIsLoadingProgress] = useState<boolean>(false);
  const [isAddingArea, setIsAddingArea] = useState<boolean>(false);
  const [isEditingArea, setIsEditingArea] = useState<boolean>(false);
  const [isStartingCycle, setIsStartingCycle] = useState<boolean>(false);
  const [isCompletingCycle, setIsCompletingCycle] = useState<boolean>(false);
  const [checkingBayId, setCheckingBayId] = useState<number | null>(null);
  const [deletingAreaId, setDeletingAreaId] = useState<number | null>(null);
  const [deleteDialogKey, setDeleteDialogKey] = useState<string | null>(null);
  const addInFlightRef = useRef(false);

  const departmentOptions = storeAreas.filter((area) => area.parentId === null);

  const fetchStoreAreas = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setIsLoadingAreas(true);
      try {
        const authToken = await getFreshApiToken('store-areas-list');
        const data = await apiService.get<StoreAreaApiResponse[]>(
          '/store-areas',
          authToken,
          signal,
        );
        if (!signal?.aborted) {
          setStoreAreas(data.map(normalizeStoreArea));
          setError(null);
        }
      } catch (err: unknown) {
        if (signal?.aborted) return;
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(getUnknownErrorMessage('load store areas'));
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoadingAreas(false);
        }
      }
    },
    [token, getFreshApiToken, setStoreAreas, setError, setIsLoadingAreas],
  );

  const fetchFloorProgress = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setIsLoadingProgress(true);
      try {
        const authToken = await getFreshApiToken('store-areas-floor-progress');
        const data = await apiService.get<FloorProgress>(
          '/store-areas/floor-progress',
          authToken,
          signal,
        );
        if (!signal?.aborted && data && !Array.isArray(data)) {
          setFloorProgress(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (signal?.aborted) return;
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(getUnknownErrorMessage('load floor progress'));
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoadingProgress(false);
        }
      }
    },
    [token, getFreshApiToken, setError],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchStoreAreas(controller.signal);
    return () => controller.abort();
  }, [fetchStoreAreas]);

  useEffect(() => {
    const controller = new AbortController();
    fetchFloorProgress(controller.signal);
    return () => controller.abort();
  }, [fetchFloorProgress]);

  const handleAddArea = useCallback(async () => {
    if (addInFlightRef.current) return;

    if (!token || !newAreaName.trim()) {
      setError('Store area name cannot be empty.');
      setInvalidField('addAreaName');
      setSuccessMessage(null);
      return;
    }
    addInFlightRef.current = true;
    setIsAddingArea(true);
    try {
      const authToken = await getFreshApiToken('store-area-create');
      const payload: {
        name: string;
        subDepartment: string;
        parentId?: number;
      } = {
        name: newAreaName.trim(),
        subDepartment: newSubDepartmentName.trim(),
      };
      if (newParentDepartmentId) {
        payload.parentId = Number(newParentDepartmentId);
      }
      await apiService.post('/store-areas', payload, authToken);
      setSuccessMessage(`${newAreaName.trim()} added.`);
      setError(null);
      setInvalidField(null);
      setNewAreaName('');
      setNewSubDepartmentName('');
      setNewParentDepartmentId('');
      fetchStoreAreas();
      fetchFloorProgress();
    } catch (err: unknown) {
      setInvalidField(null);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(getUnknownErrorMessage('add this location'));
      }
      setSuccessMessage(null);
    } finally {
      addInFlightRef.current = false;
      setIsAddingArea(false);
    }
  }, [
    token,
    getFreshApiToken,
    newAreaName,
    newSubDepartmentName,
    newParentDepartmentId,
    fetchStoreAreas,
    fetchFloorProgress,
    setError,
    setInvalidField,
    setSuccessMessage,
    setNewAreaName,
    setNewSubDepartmentName,
    setIsAddingArea,
  ]);

  const handleStartCycle = useCallback(async () => {
    if (!token || !newCycleName.trim() || isStartingCycle) {
      return;
    }

    setIsStartingCycle(true);
    try {
      const authToken = await getFreshApiToken('store-area-cycle-create');
      const cycle = await apiService.post<FloorProgress['activeCycle']>(
        '/store-areas/check-cycles',
        { name: newCycleName.trim() },
        authToken,
      );
      if (cycle) {
        setFloorProgress((current) =>
          current
            ? { ...current, activeCycle: cycle }
            : {
                activeCycle: cycle,
                summary: {
                  totalBays: 0,
                  checkedBays: 0,
                  notCheckedBays: 0,
                  overdueBays: 0,
                  coveragePercent: 0,
                  uncheckedBays: 0,
                },
                departments: [],
              },
        );
      }
      setSuccessMessage(`${newCycleName.trim()} started.`);
      setError(null);
      setNewCycleName('');
    } catch (err: unknown) {
      setSuccessMessage(null);
      setError(err instanceof Error ? err.message : getUnknownErrorMessage('start this walk'));
    } finally {
      setIsStartingCycle(false);
    }
  }, [token, newCycleName, isStartingCycle, getFreshApiToken, setSuccessMessage, setError]);

  const handleCompleteCycle = useCallback(async () => {
    if (!token || !floorProgress?.activeCycle || isCompletingCycle) {
      return;
    }

    setIsCompletingCycle(true);
    try {
      const authToken = await getFreshApiToken('store-area-cycle-complete');
      await apiService.post(
        `/store-areas/check-cycles/${floorProgress.activeCycle.id}/complete`,
        {},
        authToken,
      );
      setSuccessMessage(`${floorProgress.activeCycle.name} completed.`);
      setError(null);
      fetchFloorProgress();
    } catch (err: unknown) {
      setSuccessMessage(null);
      setError(err instanceof Error ? err.message : getUnknownErrorMessage('complete this walk'));
    } finally {
      setIsCompletingCycle(false);
    }
  }, [
    token,
    floorProgress?.activeCycle,
    isCompletingCycle,
    getFreshApiToken,
    fetchFloorProgress,
    setSuccessMessage,
    setError,
  ]);

  const handleRecordBayCheck = useCallback(
    async (bay: FloorProgressBay) => {
      if (!token || checkingBayId !== null) {
        return;
      }

      setCheckingBayId(bay.id);
      try {
        const authToken = await getFreshApiToken('store-area-bay-check');
        await apiService.post(
          '/store-areas/bay-checks',
          { storeAreaId: bay.id, itemsAddedCount: 0 },
          authToken,
        );
        setSuccessMessage(`${bay.name} checked.`);
        setError(null);
        fetchStoreAreas();
        fetchFloorProgress();
      } catch (err: unknown) {
        setSuccessMessage(null);
        setError(err instanceof Error ? err.message : getUnknownErrorMessage('record this bay'));
      } finally {
        setCheckingBayId(null);
      }
    },
    [
      token,
      checkingBayId,
      getFreshApiToken,
      fetchStoreAreas,
      fetchFloorProgress,
      setSuccessMessage,
      setError,
    ],
  );

  const handleEditArea = useCallback(async () => {
    if (isEditingArea) return;

    if (!token || !editingArea || !editedAreaName.trim()) {
      setError('Store area name cannot be empty.');
      setInvalidField('editAreaName');
      setSuccessMessage(null);
      return;
    }
    setIsEditingArea(true);
    try {
      const authToken = await getFreshApiToken('store-area-update');
      await apiService.put(
        `/store-areas/${editingArea.id}`,
        {
          name: editedAreaName.trim(),
          subDepartment: editedSubDepartmentName.trim(),
        },
        authToken,
      );
      setSuccessMessage(`${editedAreaName.trim()} updated.`);
      setError(null);
      setInvalidField(null);
      setEditingArea(null);
      setEditingDialogKey(null);
      setEditedAreaName('');
      setEditedSubDepartmentName('');
      fetchStoreAreas();
    } catch (err: unknown) {
      setInvalidField(null);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(getUnknownErrorMessage('save this location'));
      }
      setSuccessMessage(null);
    } finally {
      setIsEditingArea(false);
    }
  }, [
    token,
    getFreshApiToken,
    editingArea,
    editedAreaName,
    editedSubDepartmentName,
    isEditingArea,
    fetchStoreAreas,
    setError,
    setInvalidField,
    setSuccessMessage,
    setEditingArea,
    setEditedAreaName,
    setEditedSubDepartmentName,
    setIsEditingArea,
  ]);

  const handleDeleteArea = useCallback(
    async (area: StoreArea) => {
      if (deletingAreaId !== null || !token) {
        return;
      }
      setDeletingAreaId(area.id);
      try {
        const authToken = await getFreshApiToken('store-area-delete');
        await apiService.delete(`/store-areas/${area.id}`, authToken);
        setSuccessMessage(`${area.name} deleted.`);
        setError(null);
        setDeleteDialogKey(null);
        fetchStoreAreas();
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(getUnknownErrorMessage('delete this location'));
        }
        setSuccessMessage(null);
      } finally {
        setDeletingAreaId(null);
      }
    },
    [
      token,
      getFreshApiToken,
      deletingAreaId,
      fetchStoreAreas,
      setError,
      setSuccessMessage,
      setDeletingAreaId,
    ],
  );

  const openEditDialog = useCallback((area: StoreArea) => {
    setInvalidField(null);
    setEditingArea(area);
    setEditedAreaName(area.name);
    setEditedSubDepartmentName(area.subDepartment || '');
  }, []);

  const renderEditDialog = (area: StoreArea, triggerClassName: string, dialogKey: string) => (
    <Dialog
      open={editingDialogKey === dialogKey}
      onOpenChange={(open) => {
        if (open) {
          openEditDialog(area);
          setEditingDialogKey(dialogKey);
          return;
        }
        setEditingDialogKey((currentKey) => (currentKey === dialogKey ? null : currentKey));
        setEditingArea((currentArea) =>
          currentArea?.id === area.id && editingDialogKey === dialogKey ? null : currentArea,
        );
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={triggerClassName}
          aria-label={`Edit ${area.name}`}
          onClick={() => openEditDialog(area)}
        >
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {area.name}</DialogTitle>
          <DialogDescription>
            Update this location name or sub-department for expiry checks.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
            <Label htmlFor="editedAreaName" className="sm:text-right">
              Area name
            </Label>
            <Input
              id="editedAreaName"
              value={editedAreaName}
              onChange={(e) => {
                setEditedAreaName(e.target.value);
                if (invalidField === 'editAreaName' && e.target.value.trim()) {
                  setInvalidField(null);
                }
              }}
              aria-invalid={invalidField === 'editAreaName'}
              className="sm:col-span-3"
              maxLength={AREA_NAME_MAX_LENGTH}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
            <Label htmlFor="editedSubDepartmentName" className="sm:text-right">
              Sub-department
            </Label>
            <Input
              id="editedSubDepartmentName"
              value={editedSubDepartmentName}
              onChange={(e) => setEditedSubDepartmentName(e.target.value)}
              className="sm:col-span-3"
              maxLength={SUB_DEPARTMENT_MAX_LENGTH}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleEditArea} disabled={isEditingArea} className="min-h-11">
            {isEditingArea ? 'Saving location' : 'Save location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const renderDeleteDialog = (area: StoreArea, triggerClassName: string, dialogKey: string) => (
    <AlertDialog
      open={deleteDialogKey === dialogKey}
      onOpenChange={(open) => {
        setDeleteDialogKey(open ? dialogKey : null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          className={triggerClassName}
          aria-label={`Delete ${area.name}`}
          disabled={deletingAreaId !== null}
        >
          {deletingAreaId === area.id ? 'Deleting' : 'Delete'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {area.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the location from future expiry checks.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletingAreaId !== null}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-semantic-critical text-semantic-critical-foreground hover:bg-semantic-critical-hover active:bg-semantic-critical-active focus-visible:ring-semantic-critical/20 dark:focus-visible:ring-semantic-critical/40"
            disabled={deletingAreaId !== null}
            onClick={() => handleDeleteArea(area)}
          >
            {deletingAreaId === area.id ? 'Deleting' : 'Delete location'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4 lg:px-6">
      <Card className="mx-auto w-full">
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-left sm:text-center">Store Area Management</CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {error && (
            <p role="alert" className="text-semantic-critical text-sm text-center mt-4">
              Error: {error}
            </p>
          )}
          {successMessage && (
            <p role="status" className="text-semantic-success text-sm text-center mt-4">
              {successMessage}
            </p>
          )}

          <FloorProgressSection
            floorProgress={floorProgress}
            isLoadingProgress={isLoadingProgress}
            isCompletingCycle={isCompletingCycle}
            isStartingCycle={isStartingCycle}
            checkingBayId={checkingBayId}
            newCycleName={newCycleName}
            onNewCycleNameChange={setNewCycleName}
            onStartCycle={handleStartCycle}
            onCompleteCycle={handleCompleteCycle}
            onRecordBayCheck={handleRecordBayCheck}
          />

          <div className="mb-6">
            <h3 className="text-lg font-semibold font-heading mb-2">Add expiry-check location</h3>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="newAreaName">Area name</Label>
                <Input
                  id="newAreaName"
                  type="text"
                  placeholder="Dispensary shelf"
                  value={newAreaName}
                  onChange={(e) => {
                    setNewAreaName(e.target.value);
                    if (invalidField === 'addAreaName' && e.target.value.trim()) {
                      setInvalidField(null);
                    }
                  }}
                  aria-invalid={invalidField === 'addAreaName'}
                  maxLength={AREA_NAME_MAX_LENGTH}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="newSubDepartmentName">Sub-department</Label>
                <Input
                  id="newSubDepartmentName"
                  type="text"
                  placeholder="Optional"
                  value={newSubDepartmentName}
                  onChange={(e) => setNewSubDepartmentName(e.target.value)}
                  maxLength={SUB_DEPARTMENT_MAX_LENGTH}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="newParentDepartmentId">Parent department</Label>
                <select
                  id="newParentDepartmentId"
                  aria-label="Parent department"
                  value={newParentDepartmentId}
                  onChange={(e) => setNewParentDepartmentId(e.target.value)}
                  className="border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">None</option>
                  {departmentOptions.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={handleAddArea}
                disabled={isAddingArea}
                className="min-h-11 w-full md:w-auto"
              >
                {isAddingArea ? 'Adding location' : 'Add location'}
              </Button>
            </div>
          </div>

          <h3 className="text-lg font-semibold font-heading mb-2">Expiry-check locations</h3>
          {isLoadingAreas ? (
            <p role="status" className="text-center text-semantic-text-secondary">
              Loading store areas...
            </p>
          ) : storeAreas.length === 0 ? (
            <p className="text-center text-semantic-text-tertiary">
              No store areas yet. Add the first location used for expiry checks.
            </p>
          ) : (
            <>
              <ul aria-label="Store areas" className="grid gap-3 sm:hidden">
                {storeAreas.map((area) => (
                  <li
                    key={area.id}
                    aria-label={area.name}
                    className="rounded-md border border-hairline bg-semantic-surface-1 p-3"
                  >
                    <div className="grid gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                          Area
                        </p>
                        <p className="break-words text-sm font-medium text-semantic-text-primary">
                          {area.name}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                            ID
                          </p>
                          <p className="text-sm text-semantic-text-primary">{area.id}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                            Last checked
                          </p>
                          <p className="text-sm text-semantic-text-primary">
                            {formatLastChecked(area.lastChecked)}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase text-semantic-text-secondary">
                          Sub-department
                        </p>
                        <p className="break-words text-sm text-semantic-text-primary">
                          {area.subDepartment || 'None recorded'}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {renderEditDialog(area, 'min-h-11 w-full', `mobile-${area.id}`)}
                        {renderDeleteDialog(area, 'min-h-11 w-full', `mobile-${area.id}`)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Sub-department</TableHead>
                      <TableHead>Last checked</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storeAreas.map((area) => (
                      <TableRow key={area.id}>
                        <TableCell>{area.id}</TableCell>
                        <TableCell className="max-w-64 whitespace-normal break-words">
                          {area.name}
                        </TableCell>

                        <TableCell className="max-w-64 whitespace-normal break-words">
                          {area.subDepartment || 'None recorded'}
                        </TableCell>
                        <TableCell>{formatLastChecked(area.lastChecked)}</TableCell>
                        <TableCell className="text-right">
                          {renderEditDialog(area, 'mr-2 min-h-11', `desktop-${area.id}`)}
                          {renderDeleteDialog(area, 'min-h-11', `desktop-${area.id}`)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
