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
  window.PointerEvent = class PointerEvent extends Event {
    public pointerId: number = 0;
    public width: number = 0;
    public height: number = 0;
    public pressure: number = 0;
    public tangentialPressure: number = 0;
    public tiltX: number = 0;
    public tiltY: number = 0;
    public twist: number = 0;
    public pointerType: string = '';
    public isPrimary: boolean = false;
    
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      Object.assign(this, params);
    }
  } as any;
  
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
