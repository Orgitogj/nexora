export interface NexoraErrorOptions {
  status: number;
  statusText: string;
  data: unknown;
}

export class NexoraError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly data: unknown;

  constructor(message: string, options: NexoraErrorOptions) {
    super(message);

    this.name = "NexoraError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.data = options.data;
  }
}
