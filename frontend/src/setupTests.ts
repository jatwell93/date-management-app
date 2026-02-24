// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import fetchMock from 'jest-fetch-mock';
fetchMock.enableMocks();

// Mock localforage to prevent "No available storage method found" in JSDOM
jest.mock('localforage', () => {
  let store: Record<string, any> = {};
  return {
    config: jest.fn(),
    createInstance: jest.fn().mockReturnThis(),
    setItem: jest.fn((key, value) => {
      store[key] = value;
      return Promise.resolve(value);
    }),
    getItem: jest.fn((key) => {
      return Promise.resolve(store[key] || null);
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store = {};
      return Promise.resolve();
    }),
    keys: jest.fn(() => {
      return Promise.resolve(Object.keys(store));
    }),
    INDEXEDDB: 'asyncStorage',
    WEBSQL: 'webSQLStorage',
    LOCALSTORAGE: 'localStorageWrapper',
  };
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

  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.HTMLElement.prototype.hasPointerCapture = jest.fn();
  window.HTMLElement.prototype.releasePointerCapture = jest.fn();
  window.HTMLElement.prototype.setPointerCapture = jest.fn();
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock uuid to fix ESM import issues in tests
jest.mock('uuid', () => ({
  __esModule: true,
  v4: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  default: {
    v4: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  },
}));
