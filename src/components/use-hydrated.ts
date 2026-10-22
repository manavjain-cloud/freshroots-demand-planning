"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * false during server render and before hydration, true once React is running.
 * Action buttons stay disabled until then, so an early click can't fall back to a
 * full-page form post (which renders poorly with streamed pages).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
