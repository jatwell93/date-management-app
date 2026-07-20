// jest-dom adds custom matchers for asserting on DOM nodes.
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { fetchMock } from './test-utils/fetchMock';

fetchMock.enableMocks();

// Mock localforage to prevent "No available storage method found" in JSDOM
vi.mock('localforage', () => {
  let store: Record<string, any> = {};
  const localforage = {
    config: vi.fn(),
    createInstance: vi.fn().mockReturnThis(),
    setItem: vi.fn((key, value) => {
      store[key] = value;
      return Promise.resolve(value);
    }),
    getItem: vi.fn((key) => {
      return Promise.resolve(store[key] || null);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      store = {};
      return Promise.resolve();
    }),
    keys: vi.fn(() => {
      return Promise.resolve(Object.keys(store));
    }),
    INDEXEDDB: 'asyncStorage',
    WEBSQL: 'webSQLStorage',
    LOCALSTORAGE: 'localStorageWrapper',
  };
  return { ...localforage, default: localforage };
});

// Mock Pointer Events for Radix UI
if (typeof window !== 'undefined') {
  // Fix for "TypeError: Cannot set property bubbles of [object Event] which has only a getter"
  class MockPointerEvent extends Event {
    pointerId: number;
    width: number;
    height: number;
    pressure: number;
    tangentialPressure: number;
    tiltX: number;
    tiltY: number;
    twist: number;
    pointerType: string;
    isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId || 0;
      this.width = params.width || 0;
      this.height = params.height || 0;
      this.pressure = params.pressure || 0;
      this.tangentialPressure = params.tangentialPressure || 0;
      this.tiltX = params.tiltX || 0;
      this.tiltY = params.tiltY || 0;
      this.twist = params.twist || 0;
      this.pointerType = params.pointerType || '';
      this.isPrimary = params.isPrimary || false;
    }
  }

  (window as any).PointerEvent = MockPointerEvent;

  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock uuid to fix ESM import issues in tests
vi.mock('uuid', () => ({
  __esModule: true,
  v4: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  default: {
    v4: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  },
}));
