"use client";

import { useSyncExternalStore } from "react";
import type { ActionState } from "@/app/actions";
import { ActionToast } from "./toast";

/** Tiny app-wide toast store, for results whose form unmounts after the action (e.g. review queue moves on). */
let current: ActionState = null;
const listeners = new Set<() => void>();

export function pushToast(state: ActionState) {
  current = state;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function GlobalToaster() {
  const state = useSyncExternalStore(subscribe, () => current, () => null);
  return <ActionToast state={state} />;
}
