/** Registry for in-flight requests; settled entries are removed automatically. */
export interface InflightStore {
  size(): number;
  has(key: string): boolean;
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}
