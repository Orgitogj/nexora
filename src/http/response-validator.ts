export type ResponseValidator<T> = (value: unknown) => T;

export interface ResponseOptions<T> {
  validate?: ResponseValidator<T>;
}
