import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { FieldError } from './FieldError';
import type { StoreAreaAction } from './storeAreaReducer';
import {
  AREA_NAME_MAX_LENGTH,
  AREA_NAME_REQUIRED_MESSAGE,
  SUB_DEPARTMENT_MAX_LENGTH,
  fieldErrorProps,
  type InvalidField,
  type StoreArea,
} from './types';

const EDIT_NAME_ERROR_ID = 'editedAreaName-error';

interface AreaEditDialogProps {
  area: StoreArea;
  triggerClassName: string;
  dialogKey: string;
  editingDialogKey: string | null;
  editedAreaName: string;
  editedSubDepartmentName: string;
  invalidField: InvalidField;
  error: string | null;
  isEditingArea: boolean;
  dispatch: React.Dispatch<StoreAreaAction>;
  onSave: () => void;
}

/**
 * The page-level error sits behind the modal overlay (and outside the dialog's
 * accessible tree), so a save failure is repeated inside the dialog. Errors that
 * were already showing when the dialog opened belong to another action and stay out,
 * and so does the validation message, which the inline field error already covers.
 */
function useErrorRaisedWhileOpen(
  open: boolean,
  error: string | null,
  ignoreCurrent: boolean,
): string | null {
  const [snapshot, setSnapshot] = useState({ open, error });
  if (snapshot.open !== open || (ignoreCurrent && snapshot.error !== error)) {
    setSnapshot({ open, error });
    return null;
  }
  return open && error !== snapshot.error ? error : null;
}

export function AreaEditDialog({
  area,
  triggerClassName,
  dialogKey,
  editingDialogKey,
  editedAreaName,
  editedSubDepartmentName,
  invalidField,
  error,
  isEditingArea,
  dispatch,
  onSave,
}: AreaEditDialogProps) {
  const open = editingDialogKey === dialogKey;
  const nameInvalid = invalidField === 'editAreaName';
  const saveError = useErrorRaisedWhileOpen(open, error, nameInvalid);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          dispatch({ type: 'OPEN_EDIT_DIALOG_WITH_KEY', area, dialogKey });
          return;
        }
        dispatch({ type: 'CLOSE_EDIT_DIALOG', areaId: area.id, dialogKey });
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={triggerClassName}
          aria-label={`Edit ${area.name}`}
          onClick={() => dispatch({ type: 'OPEN_EDIT_DIALOG', area })}
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
              onChange={(e) => dispatch({ type: 'SET_EDITED_AREA_NAME', value: e.target.value })}
              {...fieldErrorProps(EDIT_NAME_ERROR_ID, nameInvalid)}
              className="sm:col-span-3"
              maxLength={AREA_NAME_MAX_LENGTH}
            />
            <div className="sm:col-span-3 sm:col-start-2">
              <FieldError id={EDIT_NAME_ERROR_ID} show={nameInvalid}>
                {AREA_NAME_REQUIRED_MESSAGE}
              </FieldError>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
            <Label htmlFor="editedSubDepartmentName" className="sm:text-right">
              Sub-department
            </Label>
            <Input
              id="editedSubDepartmentName"
              value={editedSubDepartmentName}
              onChange={(e) =>
                dispatch({ type: 'SET_EDITED_SUB_DEPARTMENT', value: e.target.value })
              }
              className="sm:col-span-3"
              maxLength={SUB_DEPARTMENT_MAX_LENGTH}
            />
          </div>
          {saveError && (
            <p role="alert" className="text-sm text-semantic-critical-muted-foreground">
              {saveError}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" className="min-h-11">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={onSave} disabled={isEditingArea} className="min-h-11">
            {isEditingArea ? 'Saving location' : 'Save location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
