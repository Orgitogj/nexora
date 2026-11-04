import type { InterceptorManager, MaybePromise } from "./interceptor-types.js";

export function createInterceptorManager<T>(): InterceptorManager<T> {
  const handlers = new Map<number, (value: T) => MaybePromise<T>>();

  let nextId = 0;

  function use(handler: (value: T) => MaybePromise<T>): number {
    const id = nextId++;
    handlers.set(id, handler);
    return id;
  }

  function eject(id: number): void {
    handlers.delete(id);
  }

  function clear(): void {
    handlers.clear();
  }

  async function run(value: T): Promise<T> {
    let current = value;

    // Snapshot prevents modifications during execution
    // from affecting the current chain.
    const snapshot = [...handlers.values()];

    for (const handler of snapshot) {
      current = await handler(current);
    }

    return current;
  }

  return {
    use,
    eject,
    clear,
    run,
  };
}
