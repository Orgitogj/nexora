import { NexoraError } from "./errors.js";

async function parseErrorData(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function createHttpError(response: Response): Promise<NexoraError> {
  const data = await parseErrorData(response);

  const message = response.statusText || `HTTP request failed with status ${response.status}`;

  return new NexoraError(message, {
    status: response.status,
    statusText: response.statusText,
    data,
  });
}
