import { useCallback, useRef } from 'react';

/** One upload attempt. Cancel/reset supersede it, which also aborts its requests. */
export interface UploadRun {
  readonly signal: AbortSignal;
  isCurrent: () => boolean;
  /** Called once the server has accepted the file for import (it runs on regardless). */
  markHandedOff: () => void;
}

interface RunState {
  controller: AbortController;
  handedOff: boolean;
}

/**
 * Tracks the active upload run so a superseded run stops at its next step, has its
 * in-flight requests aborted, and never writes results or unlocks the form under a
 * newer run.
 */
export function useUploadRuns() {
  const activeRef = useRef<RunState | null>(null);

  const supersede = useCallback((): { handedOff: boolean } | null => {
    const previous = activeRef.current;
    activeRef.current = null;
    previous?.controller.abort();
    return previous ? { handedOff: previous.handedOff } : null;
  }, []);

  const begin = useCallback((): UploadRun => {
    supersede();
    const state: RunState = { controller: new AbortController(), handedOff: false };
    activeRef.current = state;
    return {
      signal: state.controller.signal,
      isCurrent: () => activeRef.current === state,
      markHandedOff: () => {
        state.handedOff = true;
      },
    };
  }, [supersede]);

  return { begin, supersede };
}
