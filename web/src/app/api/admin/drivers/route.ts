import type { NextRequest } from 'next/server';
import { driversRouteDeps } from '@/features/drivers/server/deps';
import { handleListDrivers } from '@/features/drivers/server/drivers-routes';

export function GET(request: NextRequest) {
  return handleListDrivers(request, driversRouteDeps);
}
