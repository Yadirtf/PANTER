'use client';

import { useQuery } from '@tanstack/react-query';
import type { ApiError } from '@/shared/api';
import { getHealth, type HealthResponse } from '../api/get-health';

export const healthQueryKey = ['health'] as const;

export function useHealth() {
  return useQuery<HealthResponse, ApiError>({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => getHealth({ signal }),
    staleTime: 30_000,
    retry: 1,
  });
}
