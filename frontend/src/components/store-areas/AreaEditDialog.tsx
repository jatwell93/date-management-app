import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import type { StoreAreaAction } from './storeAreaReducer';
import {
  AREA_NAME_MAX_LENGTH,
  SUB_DEPARTMENT_MAX_LENGTH,
  type InvalidField,
  type StoreArea,
} from './types';

interface AreaEditDialogProps {
  area: StoreArea;
  triggerClassName: string;
  dialogKey: string;
  editingDialogKey: string | null;
  editedAreaName: string;
  editedSubDepartmentName: string;
  invalidField: InvalidField;
  isEditingArea: boolean;
  dispatch: React.Dispatch<StoreAreaAction>;
  onSave: () => void;
}

export function AreaEditDialog({
  area,
  triggerClassName,
  dialogKey,
  editingDialogKey,
  editedAreaName,
  editedSubDepartmentName,
  invalidField,
  isEditingArea,
  dispatch,
  onSave,
}: AreaEditDialogProps) {
  return (
    <Dialog
      open={editingDialogKey === dialogKey}
      onOpenChange={(open) => {
        if (open) {
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
              onChange={(e) =>
                dispatch({ type: 'SET_EDITED_SUB_DEPARTMENT', value: e.target.value })
              }
              className="sm:col-span-3"
              maxLength={SUB_DEPARTMENT_MAX_LENGTH}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onSave} disabled={isEditingArea} className="min-h-11">
            {isEditingArea ? 'Saving location' : 'Save location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
