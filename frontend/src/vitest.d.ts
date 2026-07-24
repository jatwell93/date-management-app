/// <reference types="vitest/globals" />
// Compatibility shim for the jest -> vitest migration.
//
// Legacy tests use `jest.Mock` / `jest.Mocked` / `jest.MockedFunction` /
// `jest.SpyInstance` in *type position* (e.g. `x as jest.Mock`). Rather than
// editing ~130 type annotations across the suite, we map the `jest` type
// namespace onto Vitest's equivalents. Type annotations are erased at compile
// time, so this is purely a typing convenience — the runtime calls use `vi.*`.
declare global {
  namespace jest {
    type Mock<TReturn = any, TArgs extends any[] = any[]> = import('vitest').Mock<
      (...args: TArgs) => TReturn
    >;
    type Mocked<T> = import('vitest').Mocked<T>;
    type MockedFunction<T extends (...args: any[]) => any> = import('vitest').MockedFunction<T>;
    type SpyInstance = import('vitest').MockInstance;
  }
}

export {};
