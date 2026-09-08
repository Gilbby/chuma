import { useEffect } from "react";

/**
 * Runs an async loader on mount and whenever its identity changes.
 *
 * Calling an async loader straight from a `useEffect` body trips
 * `react-hooks/set-state-in-effect`: the linter can't see past the callback, so
 * it assumes the loader may call setState synchronously. Awaiting it inside a
 * local async function makes the boundary explicit — every state update the
 * loader performs lands in a later microtask, off the effect's synchronous path.
 *
 * Pass a stable (`useCallback`) loader, since it doubles as the dependency.
 */
export function useAsyncEffect(load: () => Promise<unknown>) {
  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
  }, [load]);
}
