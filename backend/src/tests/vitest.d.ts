/// <reference types="vitest/globals" />
// Compatibility shim for the jest -> vitest migration (backend).
//
// The runtime suite was codemodded from `jest.*` to `vi.*`, but ~415 type
// annotations still reference the `jest` namespace in *type position*
// (e.g. `x as jest.Mock`, `const m: jest.Mocked<T>`). Type annotations are
// erased by the SWC transform at run time, and `tsconfig.json` excludes the
// test tree from `tsc`, so these are never compiled — but this shim keeps the
// IDE/type-checker honest by mapping the `jest` type namespace onto Vitest's
// equivalents. The runtime calls all use `vi.*`.
declare global {
  namespace jest {
    type Mock<TReturn = any, TArgs extends any[] = any[]> = import('vitest').Mock<
      (...args: TArgs) => TReturn
    >;
    type Mocked<T> = import('vitest').Mocked<T>;
    type MockedFunction<T extends (...args: any[]) => any> = import('vitest').MockedFunction<T>;
    type MockedClass<T extends abstract new (...args: any[]) => any> =
      import('vitest').MockedClass<T>;
    type SpyInstance = import('vitest').MockInstance;
  }
}

export {};
