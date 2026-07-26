import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver. Only App-level tests exercise it (via
// useOverflowCompaction watching the live print preview), so a minimal stub is enough —
// nothing in this codebase asserts on when observer callbacks actually fire in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}
