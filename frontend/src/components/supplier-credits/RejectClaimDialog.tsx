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

interface RejectClaimDialogProps {
  claimId: number;
  supplierName: string;
  disabled: boolean;
  onConfirm: () => void;
}

/**
 * Confirm step before recording a claim as REJECTED. The outcome is final on the
 * server (a settled claim refuses a second outcome), so a mis-tap cannot be undone.
 */
export function RejectClaimDialog({
  claimId,
  supplierName,
  disabled,
  onConfirm,
}: RejectClaimDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="text-semantic-critical border-semantic-critical min-h-11"
          disabled={disabled}
        >
          Rejected
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Reject claim #{claimId} from {supplierName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This records that the supplier refused the claim. Follow-up reminders stop and no credit
            is recorded. A rejected claim is final and cannot be changed later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11 bg-semantic-critical text-semantic-critical-foreground hover:bg-semantic-critical-hover active:bg-semantic-critical-active focus-visible:ring-semantic-critical/20"
            onClick={onConfirm}
          >
            Reject claim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
