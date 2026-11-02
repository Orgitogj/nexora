export async function parseJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();

  return data as T;
}
