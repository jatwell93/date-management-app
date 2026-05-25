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

interface StoreArea {
  id: number;
  name: string;
  subDepartment?: string | null;
  lastChecked?: string | null;
}

interface StoreAreaApiResponse extends StoreArea {
  last_checked?: string | null;
}

interface StoreAreaManagementPageProps {
  token: string | null;
}

const storeAreaDateFormatter = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function normalizeStoreArea(area: StoreAreaApiResponse): StoreArea {
  return {
    id: area.id,
    name: area.name,
    subDepartment: area.subDepartment,
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

export function StoreAreaManagementPage({ token }: StoreAreaManagementPageProps) {
  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [newAreaName, setNewAreaName] = useState<string>('');
  const [newSubDepartmentName, setNewSubDepartmentName] = useState<string>('');
  const [editingArea, setEditingArea] = useState<StoreArea | null>(null);
  const [editingDialogKey, setEditingDialogKey] = useState<string | null>(null);
  const [editedAreaName, setEditedAreaName] = useState<string>('');
  const [editedSubDepartmentName, setEditedSubDepartmentName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoadingAreas, setIsLoadingAreas] = useState<boolean>(false);
  const [isAddingArea, setIsAddingArea] = useState<boolean>(false);
  const [isEditingArea, setIsEditingArea] = useState<boolean>(false);
  const [deletingAreaId, setDeletingAreaId] = useState<number | null>(null);
  const [deleteDialogKey, setDeleteDialogKey] = useState<string | null>(null);
  const addInFlightRef = useRef(false);

  const fetchStoreAreas = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setIsLoadingAreas(true);
      try {
        const data = await apiService.get<StoreAreaApiResponse[]>('/store-areas', token, signal);
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
    [token, setStoreAreas, setError, setIsLoadingAreas],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchStoreAreas(controller.signal);
    return () => controller.abort();
  }, [fetchStoreAreas]);

  const handleAddArea = useCallback(async () => {
    if (addInFlightRef.current) return;

    if (!token || !newAreaName.trim()) {
      setError('Store area name cannot be empty.');
      setSuccessMessage(null);
      return;
    }
    addInFlightRef.current = true;
    setIsAddingArea(true);
    try {
      await apiService.post(
        '/store-areas',
        {
          name: newAreaName.trim(),
          subDepartment: newSubDepartmentName.trim(),
        },
        token,
      );
      setSuccessMessage(`${newAreaName.trim()} added.`);
      setError(null);
      setNewAreaName('');
      setNewSubDepartmentName('');
      fetchStoreAreas();
    } catch (err: unknown) {
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
    newAreaName,
    newSubDepartmentName,
    fetchStoreAreas,
    setError,
    setSuccessMessage,
    setNewAreaName,
    setNewSubDepartmentName,
    setIsAddingArea,
  ]);

  const handleEditArea = useCallback(async () => {
    if (isEditingArea) return;

    if (!token || !editingArea || !editedAreaName.trim()) {
      setError('Store area name cannot be empty.');
      setSuccessMessage(null);
      return;
    }
    setIsEditingArea(true);
    try {
      await apiService.put(
        `/store-areas/${editingArea.id}`,
        {
          name: editedAreaName.trim(),
          subDepartment: editedSubDepartmentName.trim(),
        },
        token,
      );
      setSuccessMessage(`${editedAreaName.trim()} updated.`);
      setError(null);
      setEditingArea(null);
      setEditingDialogKey(null);
      setEditedAreaName('');
      setEditedSubDepartmentName('');
      fetchStoreAreas();
    } catch (err: unknown) {
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
    editingArea,
    editedAreaName,
    editedSubDepartmentName,
    isEditingArea,
    fetchStoreAreas,
    setError,
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
        await apiService.delete(`/store-areas/${area.id}`, token);
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
    [token, deletingAreaId, fetchStoreAreas, setError, setSuccessMessage, setDeletingAreaId],
  );

  const openEditDialog = useCallback((area: StoreArea) => {
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
        <Button variant="outline" className={triggerClassName} onClick={() => openEditDialog(area)}>
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
              onChange={(e) => setEditedAreaName(e.target.value)}
              className="sm:col-span-3"
              maxLength={100}
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
              maxLength={100}
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

          <div className="mb-6">
            <h3 className="text-lg font-semibold font-heading mb-2">Add expiry-check location</h3>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="newAreaName">Area name</Label>
                <Input
                  id="newAreaName"
                  type="text"
                  placeholder="Dispensary shelf"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  aria-invalid={error === 'Store area name cannot be empty.'}
                  maxLength={100}
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
                  maxLength={100}
                />
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
