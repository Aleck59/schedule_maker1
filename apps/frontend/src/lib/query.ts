import { QueryClient, useMutation, useQuery, useQueryClient, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, errorMessage, type RequestOptions } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

/** GET-запрос с кэшированием */
export function useApi<T>(
  key: QueryKey,
  path: string | null,
  query?: RequestOptions['query'],
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T>({
    queryKey: [...key, query ?? {}],
    queryFn: ({ signal }) => api.get<T>(path!, query, { signal }),
    enabled: !!path && (options?.enabled ?? true),
    ...options,
  });
}

/** Мутация с уведомлением об успехе и ошибке и сбросом кэша */
export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  options: {
    success?: string | ((result: TResult) => string);
    invalidate?: QueryKey[];
    onSuccess?: (result: TResult, vars: TVars) => void;
    onError?: (error: unknown, vars: TVars) => boolean | void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TVars>({
    mutationFn: fn,
    onSuccess: (result, vars) => {
      if (options.success) toast.success(typeof options.success === 'function' ? options.success(result) : options.success);
      for (const key of options.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      options.onSuccess?.(result, vars);
    },
    onError: (error, vars) => {
      const handled = options.onError?.(error, vars);
      if (!handled) toast.error(errorMessage(error));
    },
  });
}
