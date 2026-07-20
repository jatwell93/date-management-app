import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  formatLastChecked,
  renderBayState,
  type FloorProgress,
  type FloorProgressBay,
} from './types';

interface FloorProgressSectionProps {
  floorProgress: FloorProgress | null;
  isLoadingProgress: boolean;
  isCompletingCycle: boolean;
  isStartingCycle: boolean;
  checkingBayId: number | null;
  newCycleName: string;
  onNewCycleNameChange: (value: string) => void;
  onStartCycle: () => void;
  onCompleteCycle: () => void;
  onRecordBayCheck: (bay: FloorProgressBay) => void;
}

export function FloorProgressSection({
  floorProgress,
  isLoadingProgress,
  isCompletingCycle,
  isStartingCycle,
  checkingBayId,
  newCycleName,
  onNewCycleNameChange,
  onStartCycle,
  onCompleteCycle,
  onRecordBayCheck,
}: FloorProgressSectionProps) {
  return (
    <section className="mb-8 space-y-4" aria-labelledby="floor-progress-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="floor-progress-heading" className="text-lg font-semibold font-heading">
            Floor Progress
          </h3>
          {floorProgress?.activeCycle ? (
            <p className="text-sm text-semantic-text-secondary">{floorProgress.activeCycle.name}</p>
          ) : (
            <p className="text-sm text-semantic-text-secondary">No active store walk.</p>
          )}
        </div>
        {floorProgress?.activeCycle ? (
          <Button
            onClick={onCompleteCycle}
            disabled={isCompletingCycle}
            variant="outline"
            className="min-h-11"
          >
            {isCompletingCycle ? 'Completing walk' : 'Complete walk'}
          </Button>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="newCycleName">Walk name</Label>
              <Input
                id="newCycleName"
                value={newCycleName}
                onChange={(event) => onNewCycleNameChange(event.target.value)}
                placeholder="July walk"
                maxLength={100}
              />
            </div>
            <Button
              onClick={onStartCycle}
              disabled={isStartingCycle || !newCycleName.trim()}
              className="min-h-11"
            >
              {isStartingCycle ? 'Starting walk' : 'Start walk'}
            </Button>
          </div>
        )}
      </div>

      {isLoadingProgress ? (
        <p role="status" className="text-sm text-semantic-text-secondary">
          Loading floor progress...
        </p>
      ) : floorProgress ? (
        <FloorProgressDepartments
          floorProgress={floorProgress}
          checkingBayId={checkingBayId}
          onRecordBayCheck={onRecordBayCheck}
        />
      ) : null}
    </section>
  );
}

function FloorProgressDepartments({
  floorProgress,
  checkingBayId,
  onRecordBayCheck,
}: {
  floorProgress: FloorProgress;
  checkingBayId: number | null;
  onRecordBayCheck: (bay: FloorProgressBay) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium text-semantic-text-primary">Store coverage</span>
          <span className="tabular-nums text-semantic-text-secondary">
            {floorProgress.summary.coveragePercent}%
          </span>
        </div>
        <div className="h-2 rounded bg-semantic-surface-3">
          <div
            className="h-2 rounded bg-semantic-success"
            style={{ width: `${floorProgress.summary.coveragePercent}%` }}
          />
        </div>
      </div>

      {floorProgress.departments.length === 0 ? (
        <p className="text-sm text-semantic-text-tertiary">
          Add bays under departments to track this walk.
        </p>
      ) : (
        <div className="space-y-4">
          {floorProgress.departments.map((department) => (
            <section
              key={department.department.id ?? department.department.name}
              className="rounded-md border border-hairline bg-semantic-surface-2 p-3"
              aria-label={`${department.department.name} progress`}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="font-heading text-base font-semibold">
                  {department.department.name}
                </h4>
                <span className="text-sm tabular-nums text-semantic-text-secondary">
                  {department.summary.coveragePercent}%
                </span>
              </div>
              <div className="grid gap-2">
                {department.bays.map((bay) => (
                  <div
                    key={bay.id}
                    className="grid gap-2 rounded border border-hairline bg-semantic-surface-1 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-medium text-semantic-text-primary">{bay.name}</p>
                      <p className="text-sm text-semantic-text-secondary">
                        {renderBayState(bay)}
                        {bay.checkedBy?.name ? ` by ${bay.checkedBy.name}` : ''}
                        {bay.checkedAt ? ` at ${formatLastChecked(bay.checkedAt)}` : ''}
                      </p>
                    </div>
                    <Button
                      variant={bay.state === 'checked' ? 'outline' : 'default'}
                      className="min-h-11"
                      disabled={bay.state === 'checked' || checkingBayId !== null}
                      onClick={() => onRecordBayCheck(bay)}
                      aria-label={`Mark ${bay.name} checked`}
                    >
                      {checkingBayId === bay.id ? 'Checking' : 'Mark checked'}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
