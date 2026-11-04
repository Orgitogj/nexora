export type MaybePromise<T> = T | Promise<T>;

export interface InterceptorManager<T> {
  use(handler: (value: T) => MaybePromise<T>): number;

  eject(id: number): void;

  clear(): void;

  run(value: T): Promise<T>;
}

export interface RequestInterceptorContext {
  url: string;
  init: RequestInit;
}

export type RequestInterceptor = (
  context: RequestInterceptorContext,
) => MaybePromise<RequestInterceptorContext>;

export type ResponseInterceptor = (response: Response) => MaybePromise<Response>;

export type ErrorInterceptor = (error: unknown) => MaybePromise<unknown>;
