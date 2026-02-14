/**
 * Haptic Feedback Utility
 * Provides vibration feedback for barcode scan confirmation on handheld devices
 * Uses the Web Vibration API (navigator.vibrate)
 */

/**
 * Trigger a haptic vibration on the device
 * @param durationMs - Duration of vibration in milliseconds (default: 50ms)
 * @returns void
 *
 * Gracefully handles devices without Vibration API support or when API is unavailable
 */
export function triggerHaptic(durationMs = 50): void {
  try {
    // Check if Vibration API is available
    if (navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(durationMs);
    }
  } catch (_error) {
    // Silently ignore errors (device has vibration disabled, permission denied, etc.)
    // Continue app operation without haptic feedback
  }
}
