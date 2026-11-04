export class NexoraResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NexoraResponseError";
  }
}
