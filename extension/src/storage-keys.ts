/** Keys and defaults for chrome.storage.local used by the extension */

export const STORAGE_KEYS = {
  SHOW_MOVABLE_ORB: 'showMovableOrb',
  FAB_POSITION: 'fabPosition',
  USE_FLOATING_WINDOW: 'useFloatingWindow',
} as const;

export const DEFAULTS = {
  [STORAGE_KEYS.SHOW_MOVABLE_ORB]: true,
  [STORAGE_KEYS.FAB_POSITION]: null as { x: number; y: number } | null,
  [STORAGE_KEYS.USE_FLOATING_WINDOW]: false,
} as const;

export type FabPosition = { x: number; y: number };
