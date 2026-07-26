import type { NightShiftApi } from "./contracts";

declare global {
  interface Window { nightShift: NightShiftApi }
}

export {};
