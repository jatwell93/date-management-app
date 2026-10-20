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
          <h2 id="floor-progress-heading" className="text-lg font-semibold font-heading">
            Floor progress
          </h2>
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
                className="min-h-11"
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

function CoverageBar({ percent }: { percent: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span id="store-coverage-label" className="font-medium text-semantic-text-primary">
          Store coverage
        </span>
        <span className="tabular-nums text-semantic-text-secondary">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby="store-coverage-label"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% of bays checked`}
        className="h-2 rounded bg-semantic-surface-3"
      >
        <div className="h-2 rounded bg-semantic-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function bayButtonText(bay: FloorProgressBay, checkingBayId: number | null): string {
  if (checkingBayId === bay.id) return 'Checking';
  return bay.state === 'checked' ? 'Checked' : 'Mark checked';
}

function BayRow({
  bay,
  checkingBayId,
  onRecordBayCheck,
}: {
  bay: FloorProgressBay;
  checkingBayId: number | null;
  onRecordBayCheck: (bay: FloorProgressBay) => void;
}) {
  const isChecked = bay.state === 'checked';
  return (
    <li className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="font-medium text-semantic-text-primary">{bay.name}</p>
        <p
          className={
            bay.state === 'overdue'
              ? 'text-sm font-medium text-semantic-warning-muted-foreground'
              : 'text-sm text-semantic-text-secondary'
          }
        >
          {renderBayState(bay)}
          {bay.checkedBy?.name ? ` by ${bay.checkedBy.name}` : ''}
          {bay.checkedAt ? ` at ${formatLastChecked(bay.checkedAt)}` : ''}
        </p>
      </div>
      <Button
        variant={isChecked ? 'outline' : 'default'}
        className="min-h-11"
        disabled={isChecked || checkingBayId !== null}
        onClick={() => onRecordBayCheck(bay)}
        aria-label={isChecked ? `${bay.name} checked` : `Mark ${bay.name} checked`}
      >
        {bayButtonText(bay, checkingBayId)}
      </Button>
    </li>
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
      <CoverageBar percent={floorProgress.summary.coveragePercent} />

      {floorProgress.departments.length === 0 ? (
        <p className="text-sm text-semantic-text-tertiary">
          Add bays under departments to track this walk.
        </p>
      ) : (
        <div className="space-y-4">
          {floorProgress.departments.map((department) => (
            <div
              key={department.department.id ?? department.department.name}
              className="rounded-md border border-hairline bg-semantic-surface-2 p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-heading text-base font-semibold">
                  {department.department.name}
                </h3>
                <span className="text-sm tabular-nums text-semantic-text-secondary">
                  {department.summary.coveragePercent}%
                </span>
              </div>
              <ul
                aria-label={`${department.department.name} bays`}
                className="divide-y divide-hairline"
              >
                {department.bays.map((bay) => (
                  <BayRow
                    key={bay.id}
                    bay={bay}
                    checkingBayId={checkingBayId}
                    onRecordBayCheck={onRecordBayCheck}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
