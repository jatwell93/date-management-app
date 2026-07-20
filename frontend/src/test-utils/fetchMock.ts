import createFetchMock from 'vitest-fetch-mock';
import { vi } from 'vitest';

// Drop-in replacement for the former jest-fetch-mock singleton. Tests that need
// to script fetch responses import this and use the same API
// (mockResponseOnce / mockRejectOnce / resetMocks / etc.).
export const fetchMock = createFetchMock(vi);
