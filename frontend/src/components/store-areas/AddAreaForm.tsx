import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { FieldError } from './FieldError';
import {
  AREA_NAME_MAX_LENGTH,
  AREA_NAME_REQUIRED_MESSAGE,
  SUB_DEPARTMENT_MAX_LENGTH,
  fieldErrorProps,
  type InvalidField,
  type StoreArea,
} from './types';

const ADD_NAME_ERROR_ID = 'newAreaName-error';

// Native select (so scanners and phones get the OS picker), sized and focused like Input.
const SELECT_CLASS =
  'border-input min-h-11 w-full rounded-md border bg-transparent px-3 py-1 text-base text-semantic-text-primary dark:bg-semantic-surface-2 outline-hidden focus-visible:border-semantic-primary focus-visible:ring-semantic-primary/50 focus-visible:ring-[3px]';

interface AddAreaFormProps {
  newAreaName: string;
  newSubDepartmentName: string;
  newParentDepartmentId: string;
  invalidField: InvalidField;
  departmentOptions: StoreArea[];
  isAddingArea: boolean;
  onAreaNameChange: (value: string) => void;
  onSubDepartmentChange: (value: string) => void;
  onParentChange: (value: string) => void;
  onSubmit: () => void;
}

export function AddAreaForm({
  newAreaName,
  newSubDepartmentName,
  newParentDepartmentId,
  invalidField,
  departmentOptions,
  isAddingArea,
  onAreaNameChange,
  onSubDepartmentChange,
  onParentChange,
  onSubmit,
}: AddAreaFormProps) {
  const nameInvalid = invalidField === 'addAreaName';
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold font-heading mb-2">Add expiry-check location</h2>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="newAreaName">Area name</Label>
          <Input
            id="newAreaName"
            type="text"
            placeholder="Dispensary shelf"
            value={newAreaName}
            onChange={(e) => onAreaNameChange(e.target.value)}
            {...fieldErrorProps(ADD_NAME_ERROR_ID, nameInvalid)}
            maxLength={AREA_NAME_MAX_LENGTH}
            className="min-h-11"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="newSubDepartmentName">Sub-department (optional)</Label>
          <Input
            id="newSubDepartmentName"
            type="text"
            value={newSubDepartmentName}
            onChange={(e) => onSubDepartmentChange(e.target.value)}
            maxLength={SUB_DEPARTMENT_MAX_LENGTH}
            className="min-h-11"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="newParentDepartmentId">Parent department</Label>
          <select
            id="newParentDepartmentId"
            value={newParentDepartmentId}
            onChange={(e) => onParentChange(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">None</option>
            {departmentOptions.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={onSubmit} disabled={isAddingArea} className="min-h-11 w-full md:w-auto">
          {isAddingArea ? 'Adding location' : 'Add location'}
        </Button>
      </div>
      {nameInvalid && (
        <div className="mt-1.5">
          <FieldError id={ADD_NAME_ERROR_ID}>{AREA_NAME_REQUIRED_MESSAGE}</FieldError>
        </div>
      )}
    </div>
  );
}
