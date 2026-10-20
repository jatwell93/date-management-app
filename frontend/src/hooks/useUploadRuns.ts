import { useCallback, useEffect, useRef } from 'react';

/** One upload attempt. Cancel/reset supersede it, which also aborts its requests. */
export interface UploadRun {
  readonly signal: AbortSignal;
  isCurrent: () => boolean;
  /**
   * Called as the request that queues the import is sent. Aborting it from here on cannot
   * tell whether the server already queued the file.
   */
  markHandOffPending: () => void;
  /** Called once the server has accepted the file for import (it runs on regardless). */
  markHandedOff: () => void;
}

/** How far the file got: not sent for import, import request in flight, or accepted. */
export type HandOffState = 'none' | 'pending' | 'done';

interface RunState {
  controller: AbortController;
  handOff: HandOffState;
}

/**
 * Tracks the active upload run so a superseded run stops at its next step, has its
 * in-flight requests aborted, and never writes results or unlocks the form under a
 * newer run.
 */
export function useUploadRuns() {
  const activeRef = useRef<RunState | null>(null);

  const supersede = useCallback((): { handOff: HandOffState } | null => {
    const previous = activeRef.current;
    activeRef.current = null;
    previous?.controller.abort();
    return previous ? { handOff: previous.handOff } : null;
  }, []);

  // Leaving the page ends the run: no status polling or token refreshes in the background.
  useEffect(
    () => () => {
      supersede();
    },
    [supersede],
  );

  const begin = useCallback((): UploadRun => {
    supersede();
    const state: RunState = { controller: new AbortController(), handOff: 'none' };
    activeRef.current = state;
    return {
      signal: state.controller.signal,
      isCurrent: () => activeRef.current === state,
      markHandOffPending: () => {
        if (state.handOff === 'none') state.handOff = 'pending';
      },
      markHandedOff: () => {
        state.handOff = 'done';
      },
    };
  }, [supersede]);

  return { begin, supersede };
}
