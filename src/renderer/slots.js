// The user's spool colours as slots (SPEC 3.5b), shared through React context.
import { createContext, useContext } from 'react';
import { U1_SLOTS } from '../core/filament.mjs';

export const SlotsContext = createContext(U1_SLOTS);
export const SetSpoolsContext = createContext(() => {});
export const useSlots = () => useContext(SlotsContext);
/** App-level spool state setter (call after window.api.setSpools persists). */
export const useSetSpools = () => useContext(SetSpoolsContext);
/** True when the slots are the untouched ideal CMYK defaults. */
export const isDefaultSlots = (slots) => slots.length === U1_SLOTS.length && slots.every((s, i) => s.hex === U1_SLOTS[i].hex);
