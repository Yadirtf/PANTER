import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @panter/contracts se publica como TypeScript sin compilar dentro del monorepo.
  transpilePackages: ['@panter/contracts'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;

// Expone los bindings de Cloudflare (getCloudflareContext) durante `next dev`.
if (process.env.NODE_ENV === 'development') {
  void initOpenNextCloudflareForDev();
}
