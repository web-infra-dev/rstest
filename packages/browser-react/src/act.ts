import * as React from 'react';

let activeActs = 0;

function setActEnvironment(value: boolean | undefined): void {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = value;
}

function updateActEnvironment(): void {
  setActEnvironment(activeActs > 0);
}

// React 18+ exports act, React 17 has unstable_act
const _act = (React as Record<string, unknown>).act as
  | ((callback: () => unknown) => Promise<void>)
  | undefined;

type ActFunction = (callback: () => unknown) => Promise<void>;

/**
 * Wraps a callback in React's act() for proper state updates.
 * Automatically manages IS_REACT_ACT_ENVIRONMENT.
 */
export const act: ActFunction =
  typeof _act !== 'function'
    ? async (callback: () => unknown): Promise<void> => {
        await callback();
      }
    : async (callback: () => unknown): Promise<void> => {
        activeActs++;
        updateActEnvironment();
        try {
          await _act(callback);
        } finally {
          activeActs--;
          updateActEnvironment();
        }
      };
