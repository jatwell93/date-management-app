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
  isEditingArea: boolean;
  deleteDialogKey: string | null;
  deletingAreaId: number | null;
  dispatch: React.Dispatch<StoreAreaAction>;
  onSaveEdit: () => void;
  onDelete: (area: StoreArea) => void;
}

export function AreasList({
  storeAreas,
  isLoadingAreas,
  editingDialogKey,
  editedAreaName,
  editedSubDepartmentName,
  invalidField,
  isEditingArea,
  deleteDialogKey,
  deletingAreaId,
  dispatch,
  onSaveEdit,
  onDelete,
}: AreasListProps) {
  const renderEditDialog = (area: StoreArea, triggerClassName: string, dialogKey: string) => (
    <AreaEditDialog
      area={area}
      triggerClassName={triggerClassName}
      dialogKey={dialogKey}
      editingDialogKey={editingDialogKey}
      editedAreaName={editedAreaName}
      editedSubDepartmentName={editedSubDepartmentName}
      invalidField={invalidField}
      isEditingArea={isEditingArea}
      dispatch={dispatch}
      onSave={onSaveEdit}
    />
  );

  const renderDeleteDialog = (area: StoreArea, triggerClassName: string, dialogKey: string) => (
    <AreaDeleteDialog
      area={area}
      triggerClassName={triggerClassName}
      dialogKey={dialogKey}
      deleteDialogKey={deleteDialogKey}
      deletingAreaId={deletingAreaId}
      dispatch={dispatch}
      onDelete={onDelete}
    />
  );

  return (
    <>
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
    </>
  );
}
