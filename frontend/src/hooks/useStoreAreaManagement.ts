import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { apiService } from '../lib/api.service';
import { useFreshApiToken } from './useFreshApiToken';
import {
  getUnknownErrorMessage,
  normalizeStoreArea,
  type FloorProgress,
  type FloorProgressBay,
  type StoreArea,
  type StoreAreaApiResponse,
} from '../components/store-areas/types';
import {
  initialStoreAreaViewState,
  storeAreaReducer,
} from '../components/store-areas/storeAreaReducer';

/**
 * Encapsulates all data fetching, mutations, and view state for the store-area
 * management page. View state (forms, dialog keys, messaging) lives in a reducer;
 * fetched data and in-flight flags stay as useState. Behavior is intentionally
 * identical to the original inline implementation — this is a pure extraction.
 */
export function useStoreAreaManagement(token: string | null) {
  const getFreshApiToken = useFreshApiToken(token);

  const [view, dispatch] = useReducer(storeAreaReducer, initialStoreAreaViewState);

  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [floorProgress, setFloorProgress] = useState<FloorProgress | null>(null);
  const [isLoadingAreas, setIsLoadingAreas] = useState<boolean>(false);
  const [isLoadingProgress, setIsLoadingProgress] = useState<boolean>(false);
  const [isAddingArea, setIsAddingArea] = useState<boolean>(false);
  const [isEditingArea, setIsEditingArea] = useState<boolean>(false);
  const [isStartingCycle, setIsStartingCycle] = useState<boolean>(false);
  const [isCompletingCycle, setIsCompletingCycle] = useState<boolean>(false);
  const [checkingBayId, setCheckingBayId] = useState<number | null>(null);
  const [deletingAreaId, setDeletingAreaId] = useState<number | null>(null);
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
          dispatch({ type: 'CLEAR_ERROR' });
        }
      } catch (err: unknown) {
        if (signal?.aborted) return;
        dispatch({
          type: 'SET_ERROR',
          message: err instanceof Error ? err.message : getUnknownErrorMessage('load store areas'),
        });
      } finally {
        if (!signal?.aborted) {
          setIsLoadingAreas(false);
        }
      }
    },
    [token, getFreshApiToken],
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
          dispatch({ type: 'CLEAR_ERROR' });
        }
      } catch (err: unknown) {
        if (signal?.aborted) return;
        dispatch({
          type: 'SET_ERROR',
          message:
            err instanceof Error ? err.message : getUnknownErrorMessage('load floor progress'),
        });
      } finally {
        if (!signal?.aborted) {
          setIsLoadingProgress(false);
        }
      }
    },
    [token, getFreshApiToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kicks off an abortable data fetch on deps change
    fetchStoreAreas(controller.signal);
    return () => controller.abort();
  }, [fetchStoreAreas]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kicks off an abortable data fetch on deps change
    fetchFloorProgress(controller.signal);
    return () => controller.abort();
  }, [fetchFloorProgress]);

  const handleAddArea = useCallback(async () => {
    if (addInFlightRef.current) return;

    if (!token || !view.newAreaName.trim()) {
      dispatch({ type: 'ADD_VALIDATION_ERROR' });
      return;
    }
    addInFlightRef.current = true;
    setIsAddingArea(true);
    try {
      const authToken = await getFreshApiToken('store-area-create');
      const payload: { name: string; subDepartment: string; parentId?: number } = {
        name: view.newAreaName.trim(),
        subDepartment: view.newSubDepartmentName.trim(),
      };
      if (view.newParentDepartmentId) {
        payload.parentId = Number(view.newParentDepartmentId);
      }
      await apiService.post('/store-areas', payload, authToken);
      dispatch({ type: 'ADD_SUCCESS', name: view.newAreaName.trim() });
      fetchStoreAreas();
      fetchFloorProgress();
    } catch (err: unknown) {
      dispatch({
        type: 'ADD_FAILURE',
        message: err instanceof Error ? err.message : getUnknownErrorMessage('add this location'),
      });
    } finally {
      addInFlightRef.current = false;
      setIsAddingArea(false);
    }
  }, [
    token,
    getFreshApiToken,
    view.newAreaName,
    view.newSubDepartmentName,
    view.newParentDepartmentId,
    fetchStoreAreas,
    fetchFloorProgress,
  ]);

  const handleStartCycle = useCallback(async () => {
    if (!token || !view.newCycleName.trim() || isStartingCycle) {
      return;
    }

    setIsStartingCycle(true);
    try {
      const authToken = await getFreshApiToken('store-area-cycle-create');
      const cycle = await apiService.post<FloorProgress['activeCycle']>(
        '/store-areas/check-cycles',
        { name: view.newCycleName.trim() },
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
      dispatch({ type: 'START_CYCLE_SUCCESS', name: view.newCycleName.trim() });
    } catch (err: unknown) {
      dispatch({
        type: 'CYCLE_FAILURE',
        message: err instanceof Error ? err.message : getUnknownErrorMessage('start this walk'),
      });
    } finally {
      setIsStartingCycle(false);
    }
  }, [token, view.newCycleName, isStartingCycle, getFreshApiToken]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional: deps intentionally exclude derived values to keep the callback stable
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
      dispatch({ type: 'COMPLETE_CYCLE_SUCCESS', name: floorProgress.activeCycle.name });
      fetchFloorProgress();
    } catch (err: unknown) {
      dispatch({
        type: 'CYCLE_FAILURE',
        message: err instanceof Error ? err.message : getUnknownErrorMessage('complete this walk'),
      });
    } finally {
      setIsCompletingCycle(false);
    }
  }, [token, floorProgress?.activeCycle, isCompletingCycle, getFreshApiToken, fetchFloorProgress]);

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
        dispatch({ type: 'BAY_CHECK_SUCCESS', name: bay.name });
        fetchStoreAreas();
        fetchFloorProgress();
      } catch (err: unknown) {
        dispatch({
          type: 'BAY_CHECK_FAILURE',
          message: err instanceof Error ? err.message : getUnknownErrorMessage('record this bay'),
        });
      } finally {
        setCheckingBayId(null);
      }
    },
    [token, checkingBayId, getFreshApiToken, fetchStoreAreas, fetchFloorProgress],
  );

  const handleEditArea = useCallback(async () => {
    if (isEditingArea) return;

    if (!token || !view.editingArea || !view.editedAreaName.trim()) {
      dispatch({ type: 'EDIT_VALIDATION_ERROR' });
      return;
    }
    setIsEditingArea(true);
    try {
      const authToken = await getFreshApiToken('store-area-update');
      await apiService.put(
        `/store-areas/${view.editingArea.id}`,
        {
          name: view.editedAreaName.trim(),
          subDepartment: view.editedSubDepartmentName.trim(),
        },
        authToken,
      );
      dispatch({ type: 'EDIT_SUCCESS', name: view.editedAreaName.trim() });
      fetchStoreAreas();
    } catch (err: unknown) {
      dispatch({
        type: 'EDIT_FAILURE',
        message: err instanceof Error ? err.message : getUnknownErrorMessage('save this location'),
      });
    } finally {
      setIsEditingArea(false);
    }
  }, [
    token,
    getFreshApiToken,
    view.editingArea,
    view.editedAreaName,
    view.editedSubDepartmentName,
    isEditingArea,
    fetchStoreAreas,
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
        dispatch({ type: 'DELETE_SUCCESS', name: area.name });
        fetchStoreAreas();
      } catch (err: unknown) {
        dispatch({
          type: 'DELETE_FAILURE',
          message:
            err instanceof Error ? err.message : getUnknownErrorMessage('delete this location'),
        });
      } finally {
        setDeletingAreaId(null);
      }
    },
    [token, getFreshApiToken, deletingAreaId, fetchStoreAreas],
  );

  return {
    // View state (forms, dialogs, messaging)
    view,
    dispatch,
    // Data
    storeAreas,
    floorProgress,
    departmentOptions,
    // In-flight flags
    isLoadingAreas,
    isLoadingProgress,
    isAddingArea,
    isEditingArea,
    isStartingCycle,
    isCompletingCycle,
    checkingBayId,
    deletingAreaId,
    // Handlers
    handleAddArea,
    handleEditArea,
    handleDeleteArea,
    handleStartCycle,
    handleCompleteCycle,
    handleRecordBayCheck,
  };
}
