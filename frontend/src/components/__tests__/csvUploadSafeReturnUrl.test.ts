import { toSafeReturnPath } from '../csv-upload/safeReturnUrl';

describe('toSafeReturnPath', () => {
  it.each([
    ['/scan', '/scan'],
    ['/expiry-tracking?tab=due#top', '/expiry-tracking?tab=due#top'],
    ['/a/../scan', '/scan'],
  ])('accepts the same-origin in-app path %s', (candidate, expected) => {
    expect(toSafeReturnPath(candidate)).toBe(expected);
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['slash-backslash', '/\\evil.com'],
    ['double backslash', '\\\\evil.com'],
    ['backslash after a path segment', '/scan\\..\\evil'],
    // Encoded backslash is a same-origin path to the URL parser, but some proxies decode it
    // before routing; no in-app route needs one, so it is rejected.
    ['encoded backslash', '/%5Cevil.com'],
    ['encoded backslash, lower case', '/%5cevil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['absolute https URL', 'https://evil.com'],
    ['tab between slashes', '/\t/evil.com'],
    ['newline between slashes', '/\n/evil.com'],
    ['carriage return', '/\r/evil.com'],
    ['leading space', ' /scan'],
    ['NUL character', '/\u0000/evil.com'],
    ['relative path', 'scan'],
    ['empty string', ''],
  ])('rejects %s', (_label, candidate) => {
    expect(toSafeReturnPath(candidate)).toBeNull();
  });

  it('rejects missing values', () => {
    expect(toSafeReturnPath(null)).toBeNull();
    expect(toSafeReturnPath(undefined)).toBeNull();
  });
});
