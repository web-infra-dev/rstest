/**
 * Module-level state shared by both test files. Under `isolate: false` one
 * worker keeps this module loaded across the files of a single run, so the
 * counter only goes back to 0 when the runtime itself is fresh.
 */
export const counter = { value: 0 };
