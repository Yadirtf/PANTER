import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @panter/contracts y @panter/map-style se publican como TypeScript sin compilar (monorepo).
  transpilePackages: ['@panter/contracts', '@panter/map-style'],
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // forbidden() para responder 403 en /prohibido y /solo-personal (HU-107).
    authInterrupts: true,
  },
};

export default nextConfig;

// Expone los bindings de Cloudflare (getCloudflareContext) durante `next dev`.
if (process.env.NODE_ENV === 'development') {
  void initOpenNextCloudflareForDev();
}
