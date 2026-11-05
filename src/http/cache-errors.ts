export class NexoraCacheMissError extends Error {
  constructor(public readonly key: string) {
    super(`No valid cache entry for key: ${key}`);
    this.name = "NexoraCacheMissError";
  }
}
