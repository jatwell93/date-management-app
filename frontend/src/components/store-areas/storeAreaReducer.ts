import type { InvalidField, StoreArea } from './types';

/**
 * View state for the store-area management page: the add/edit forms, the dialog
 * open keys, and the error/success/validation messaging. Kept in one reducer so the
 * many interrelated fields update atomically (mirrors the original clustered useState).
 *
 * Genuinely independent concerns — fetched data and in-flight flags — stay as useState
 * in the hook; they are not part of this cluster.
 */
export interface StoreAreaViewState {
  // Add-area form
  newAreaName: string;
  newSubDepartmentName: string;
  newParentDepartmentId: string;
  // Edit dialog
  editingArea: StoreArea | null;
  editingDialogKey: string | null;
  editedAreaName: string;
  editedSubDepartmentName: string;
  // Delete dialog
  deleteDialogKey: string | null;
  // Cycle
  newCycleName: string;
  // Messaging
  error: string | null;
  invalidField: InvalidField;
  successMessage: string | null;
}

export const initialStoreAreaViewState: StoreAreaViewState = {
  newAreaName: '',
  newSubDepartmentName: '',
  newParentDepartmentId: '',
  editingArea: null,
  editingDialogKey: null,
  editedAreaName: '',
  editedSubDepartmentName: '',
  deleteDialogKey: null,
  newCycleName: '',
  error: null,
  invalidField: null,
  successMessage: null,
};

export type StoreAreaAction =
  // Add-area form inputs
  | { type: 'SET_NEW_AREA_NAME'; value: string }
  | { type: 'SET_NEW_SUB_DEPARTMENT'; value: string }
  | { type: 'SET_NEW_PARENT'; value: string }
  | { type: 'SET_NEW_CYCLE_NAME'; value: string }
  // Edit dialog inputs
  | { type: 'SET_EDITED_AREA_NAME'; value: string }
  | { type: 'SET_EDITED_SUB_DEPARTMENT'; value: string }
  // Dialog open/close
  | { type: 'OPEN_EDIT_DIALOG'; area: StoreArea }
  | { type: 'OPEN_EDIT_DIALOG_WITH_KEY'; area: StoreArea; dialogKey: string }
  | { type: 'CLOSE_EDIT_DIALOG'; areaId: number; dialogKey: string }
  | { type: 'SET_DELETE_DIALOG_KEY'; dialogKey: string | null }
  // Messaging (fetch results)
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR'; message: string }
  // Add flow
  | { type: 'ADD_VALIDATION_ERROR' }
  | { type: 'ADD_SUCCESS'; name: string }
  | { type: 'ADD_FAILURE'; message: string }
  // Edit flow
  | { type: 'EDIT_VALIDATION_ERROR' }
  | { type: 'EDIT_SUCCESS'; name: string }
  | { type: 'EDIT_FAILURE'; message: string }
  // Delete flow
  | { type: 'DELETE_SUCCESS'; name: string }
  | { type: 'DELETE_FAILURE'; message: string }
  // Cycle flow
  | { type: 'START_CYCLE_SUCCESS'; name: string }
  | { type: 'COMPLETE_CYCLE_SUCCESS'; name: string }
  | { type: 'CYCLE_FAILURE'; message: string }
  // Bay check flow
  | { type: 'BAY_CHECK_SUCCESS'; name: string }
  | { type: 'BAY_CHECK_FAILURE'; message: string };

export function storeAreaReducer(
  state: StoreAreaViewState,
  action: StoreAreaAction,
): StoreAreaViewState {
  switch (action.type) {
    case 'SET_NEW_AREA_NAME':
      return {
        ...state,
        newAreaName: action.value,
        invalidField:
          state.invalidField === 'addAreaName' && action.value.trim() ? null : state.invalidField,
      };
    case 'SET_NEW_SUB_DEPARTMENT':
      return { ...state, newSubDepartmentName: action.value };
    case 'SET_NEW_PARENT':
      return { ...state, newParentDepartmentId: action.value };
    case 'SET_NEW_CYCLE_NAME':
      return { ...state, newCycleName: action.value };

    case 'SET_EDITED_AREA_NAME':
      return {
        ...state,
        editedAreaName: action.value,
        invalidField:
          state.invalidField === 'editAreaName' && action.value.trim() ? null : state.invalidField,
      };
    case 'SET_EDITED_SUB_DEPARTMENT':
      return { ...state, editedSubDepartmentName: action.value };

    case 'OPEN_EDIT_DIALOG':
      return {
        ...state,
        invalidField: null,
        editingArea: action.area,
        editedAreaName: action.area.name,
        editedSubDepartmentName: action.area.subDepartment || '',
      };
    case 'OPEN_EDIT_DIALOG_WITH_KEY':
      return {
        ...state,
        invalidField: null,
        editingArea: action.area,
        editedAreaName: action.area.name,
        editedSubDepartmentName: action.area.subDepartment || '',
        editingDialogKey: action.dialogKey,
      };
    case 'CLOSE_EDIT_DIALOG':
      return {
        ...state,
        editingDialogKey:
          state.editingDialogKey === action.dialogKey ? null : state.editingDialogKey,
        editingArea:
          state.editingArea?.id === action.areaId && state.editingDialogKey === action.dialogKey
            ? null
            : state.editingArea,
      };
    case 'SET_DELETE_DIALOG_KEY':
      return { ...state, deleteDialogKey: action.dialogKey };

    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'SET_ERROR':
      return { ...state, error: action.message };

    case 'ADD_VALIDATION_ERROR':
      return {
        ...state,
        error: 'Store area name cannot be empty.',
        invalidField: 'addAreaName',
        successMessage: null,
      };
    case 'ADD_SUCCESS':
      return {
        ...state,
        successMessage: `${action.name} added.`,
        error: null,
        invalidField: null,
        newAreaName: '',
        newSubDepartmentName: '',
        newParentDepartmentId: '',
      };
    case 'ADD_FAILURE':
      return {
        ...state,
        invalidField: null,
        error: action.message,
        successMessage: null,
      };

    case 'EDIT_VALIDATION_ERROR':
      return {
        ...state,
        error: 'Store area name cannot be empty.',
        invalidField: 'editAreaName',
        successMessage: null,
      };
    case 'EDIT_SUCCESS':
      return {
        ...state,
        successMessage: `${action.name} updated.`,
        error: null,
        invalidField: null,
        editingArea: null,
        editingDialogKey: null,
        editedAreaName: '',
        editedSubDepartmentName: '',
      };
    case 'EDIT_FAILURE':
      return {
        ...state,
        invalidField: null,
        error: action.message,
        successMessage: null,
      };

    case 'DELETE_SUCCESS':
      return {
        ...state,
        successMessage: `${action.name} deleted.`,
        error: null,
        deleteDialogKey: null,
      };
    case 'DELETE_FAILURE':
      return { ...state, error: action.message, successMessage: null };

    case 'START_CYCLE_SUCCESS':
      return {
        ...state,
        successMessage: `${action.name} started.`,
        error: null,
        newCycleName: '',
      };
    case 'COMPLETE_CYCLE_SUCCESS':
      return { ...state, successMessage: `${action.name} completed.`, error: null };
    case 'CYCLE_FAILURE':
      return { ...state, successMessage: null, error: action.message };

    case 'BAY_CHECK_SUCCESS':
      return { ...state, successMessage: `${action.name} checked.`, error: null };
    case 'BAY_CHECK_FAILURE':
      return { ...state, successMessage: null, error: action.message };

    default:
      return state;
  }
}
