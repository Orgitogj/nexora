import { createInterceptorManager } from "./interceptor-manager.js";

import type {
  ErrorInterceptor,
  RequestInterceptor,
  RequestInterceptorContext,
  ResponseInterceptor,
} from "./interceptor-types.js";

export function createInterceptors() {
  const requestManager = createInterceptorManager<RequestInterceptorContext>();

  const responseManager = createInterceptorManager<Response>();

  const errorManager = createInterceptorManager<unknown>();

  function useRequest(handler: RequestInterceptor): number {
    return requestManager.use(handler);
  }

  function useResponse(handler: ResponseInterceptor): number {
    return responseManager.use(handler);
  }

  function useError(handler: ErrorInterceptor): number {
    return errorManager.use(handler);
  }

  return {
    request: {
      use: useRequest,
      eject: (id: number) => requestManager.eject(id),
      clear: () => requestManager.clear(),
      run: (context: RequestInterceptorContext) => requestManager.run(context),
    },

    response: {
      use: useResponse,
      eject: (id: number) => responseManager.eject(id),
      clear: () => responseManager.clear(),
      run: (response: Response) => responseManager.run(response),
    },

    error: {
      use: useError,
      eject: (id: number) => errorManager.eject(id),
      clear: () => errorManager.clear(),
      run: (error: unknown) => errorManager.run(error),
    },
  };
}
