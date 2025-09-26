import "jest-fetch-mock";

declare global {
  const fetch: typeof import("jest-fetch-mock");
}
