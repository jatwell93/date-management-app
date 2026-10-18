import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { AreaDeleteDialog } from './AreaDeleteDialog';
import { AreaEditDialog } from './AreaEditDialog';
import type { StoreAreaAction } from './storeAreaReducer';
import { formatLastChecked, type InvalidField, type StoreArea } from './types';

interface AreasListProps {
  storeAreas: StoreArea[];
  isLoadingAreas: boolean;
  editingDialogKey: string | null;
  editedAreaName: string;
  editedSubDepartmentName: string;
  invalidField: InvalidField;
  error: string | null;
  isEditingArea: boolean;
  deleteDialogKey: string | null;
  deletingAreaId: number | null;
  dispatch: React.Dispatch<StoreAreaAction>;
  onSaveEdit: () => void;
  onDelete: (area: StoreArea) => void;
}

type RowActions = (area: StoreArea, triggerClassName: string, dialogKey: string) => React.ReactNode;

function MobileField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-semantic-text-secondary">{label}</dt>
      <dd className={className ?? 'text-sm text-semantic-text-primary'}>{children}</dd>
    </div>
  );
}

function MobileAreaCards({
  storeAreas,
  actions,
}: {
  storeAreas: StoreArea[];
  actions: RowActions;
}) {
  return (
    <ul aria-label="Store areas" className="grid gap-3 sm:hidden">
      {storeAreas.map((area) => (
        <li
          key={area.id}
          aria-label={area.name}
          className="rounded-md border border-hairline bg-semantic-surface-1 p-3"
        >
          <div className="grid gap-3">
            <dl className="grid gap-3">
              <MobileField
                label="Area"
                className="break-words text-sm font-medium text-semantic-text-primary"
              >
                {area.name}
              </MobileField>
              <div className="grid grid-cols-2 gap-3">
                <MobileField label="ID">{area.id}</MobileField>
                <MobileField label="Last checked">
                  {formatLastChecked(area.lastChecked)}
                </MobileField>
              </div>
              <MobileField
                label="Sub-department"
                className="break-words text-sm text-semantic-text-primary"
              >
                {area.subDepartment || 'None recorded'}
              </MobileField>
            </dl>
            <div className="grid grid-cols-2 gap-2">
              {actions(area, 'min-h-11 w-full', `mobile-${area.id}`)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DesktopAreaTable({
  storeAreas,
  actions,
}: {
  storeAreas: StoreArea[];
  actions: RowActions;
}) {
  return (
    <div className="hidden sm:block">
      <Table aria-label="Store areas">
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
              <TableCell className="max-w-64 whitespace-normal break-words">{area.name}</TableCell>
              <TableCell className="max-w-64 whitespace-normal break-words">
                {area.subDepartment || 'None recorded'}
              </TableCell>
              <TableCell>{formatLastChecked(area.lastChecked)}</TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-2">
                  {actions(area, 'min-h-11', `desktop-${area.id}`)}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function AreasList({
  storeAreas,
  isLoadingAreas,
  editingDialogKey,
  editedAreaName,
  editedSubDepartmentName,
  invalidField,
  error,
  isEditingArea,
  deleteDialogKey,
  deletingAreaId,
  dispatch,
  onSaveEdit,
  onDelete,
}: AreasListProps) {
  const renderActions: RowActions = (area, triggerClassName, dialogKey) => (
    <>
      <AreaEditDialog
        area={area}
        triggerClassName={triggerClassName}
        dialogKey={dialogKey}
        editingDialogKey={editingDialogKey}
        editedAreaName={editedAreaName}
        editedSubDepartmentName={editedSubDepartmentName}
        invalidField={invalidField}
        error={error}
        isEditingArea={isEditingArea}
        dispatch={dispatch}
        onSave={onSaveEdit}
      />
      <AreaDeleteDialog
        area={area}
        triggerClassName={triggerClassName}
        dialogKey={dialogKey}
        deleteDialogKey={deleteDialogKey}
        deletingAreaId={deletingAreaId}
        dispatch={dispatch}
        onDelete={onDelete}
      />
    </>
  );

  return (
    <section aria-labelledby="store-areas-heading">
      <h2 id="store-areas-heading" className="text-lg font-semibold font-heading mb-2">
        Expiry-check locations
      </h2>
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
          <MobileAreaCards storeAreas={storeAreas} actions={renderActions} />
          <DesktopAreaTable storeAreas={storeAreas} actions={renderActions} />
        </>
      )}
    </section>
  );
}
