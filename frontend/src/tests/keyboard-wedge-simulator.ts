/**
 * Keyboard wedge input simulator for testing hardware barcode scanning
 * Simulates rapid keystroke sequences typical of barcode scanners
 */

import type { GS1ParseResult, HardwareScanResult } from '../types/handheld';

export interface KeyboardWedgeSimulatorOptions {
  typingSpeed?: number; // Delay between characters in ms (for human typing simulation)
  enterDelay?: number; // Delay before Enter key in ms
}

/**
 * Simulates hardware barcode scanning by dispatching rapid keydown events
 * @param barcode - The barcode string to simulate
 * @param options - Simulation options
 * @returns Promise that resolves when simulation is complete
 */
export const simulateHardwareScan = async (
  barcode: string,
  options: KeyboardWedgeSimulatorOptions = {},
): Promise<void> => {
  const { typingSpeed = 0, enterDelay = 0 } = options;

  // Create and dispatch keydown events for each character
  for (let i = 0; i < barcode.length; i++) {
    const char = barcode[i];
    const keydownEvent = new KeyboardEvent('keydown', {
      key: char,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(keydownEvent);

    // Small delay between characters if simulating slower hardware
    if (typingSpeed > 0) {
      await new Promise((resolve) => setTimeout(resolve, typingSpeed));
    }
  }

  // Wait for Enter key delay
  if (enterDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, enterDelay));
  }

  // Dispatch Enter key to complete the scan
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });

  document.dispatchEvent(enterEvent);
};

/**
 * Simulates human typing by dispatching keydown events with realistic delays
 * @param text - The text to type
 * @param options - Typing simulation options
 * @returns Promise that resolves when typing is complete
 */
export const simulateHumanTyping = async (
  text: string,
  options: { minDelay?: number; maxDelay?: number } = {},
): Promise<void> => {
  const { minDelay = 100, maxDelay = 300 } = options;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const keydownEvent = new KeyboardEvent('keydown', {
      key: char,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(keydownEvent);

    // Random delay between minDelay and maxDelay
    const delay = Math.random() * (maxDelay - minDelay) + minDelay;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // Simulate Enter key for completion
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });

  document.dispatchEvent(enterEvent);
};

/**
 * Simulates rapid Enter key presses (common issue with some scanners)
 * @param count - Number of Enter keys to press
 * @param delay - Delay between Enter keys in ms
 */
export const simulateRapidEnterPresses = async (count = 2, delay = 10): Promise<void> => {
  for (let i = 0; i < count; i++) {
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(enterEvent);

    if (delay > 0 && i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

/**
 * Waits for a scan result to be processed
 * @param timeout - Maximum time to wait in ms
 * @returns Promise that resolves with the scan result or null if timeout
 */
export const waitForScanResult = (
  _onScan: (result: HardwareScanResult) => void,
  timeout = 1000,
): Promise<HardwareScanResult | null> => {
  return new Promise((resolve) => {
    // This is a simplified version - in real tests, you'd need to mock the onScan callback
    // For now, we'll just return null after timeout
    setTimeout(() => resolve(null), timeout);
  });
};

/**
 * Test utility to create mock scan results for testing
 */
export const createMockScanResult = (
  barcode: string,
  overrides: Partial<HardwareScanResult> = {},
): HardwareScanResult => ({
  barcode,
  timestamp: Date.now(),
  source: 'hardware',
  ...overrides,
});

/**
 * Test utility to create GS1 mock scan results
 */
export const createMockGS1ScanResult = (
  barcode: string,
  gs1Data: GS1ParseResult,
): HardwareScanResult => ({
  barcode,
  timestamp: Date.now(),
  source: 'hardware',
  gs1Data,
});
