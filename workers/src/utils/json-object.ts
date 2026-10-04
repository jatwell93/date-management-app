/**
 * True for a parsed JSON value that is an object with named members: not `null`,
 * not an array, not a string or number.
 *
 * `JSON.parse` returns `unknown` wire data. A webhook body that passed signature
 * verification is authentic, not necessarily shaped like an event, so receivers
 * check this before reading any property.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
