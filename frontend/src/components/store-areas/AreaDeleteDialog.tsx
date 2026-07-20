import { Button } from '../ui/button';
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
} from '../ui/alert-dialog';
import type { StoreAreaAction } from './storeAreaReducer';
import type { StoreArea } from './types';

interface AreaDeleteDialogProps {
  area: StoreArea;
  triggerClassName: string;
  dialogKey: string;
  deleteDialogKey: string | null;
  deletingAreaId: number | null;
  dispatch: React.Dispatch<StoreAreaAction>;
  onDelete: (area: StoreArea) => void;
}

export function AreaDeleteDialog({
  area,
  triggerClassName,
  dialogKey,
  deleteDialogKey,
  deletingAreaId,
  dispatch,
  onDelete,
}: AreaDeleteDialogProps) {
  return (
    <AlertDialog
      open={deleteDialogKey === dialogKey}
      onOpenChange={(open) =>
        dispatch({ type: 'SET_DELETE_DIALOG_KEY', dialogKey: open ? dialogKey : null })
      }
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
            onClick={() => onDelete(area)}
          >
            {deletingAreaId === area.id ? 'Deleting' : 'Delete location'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
