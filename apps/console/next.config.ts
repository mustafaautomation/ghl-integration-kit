import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(process.env.CONSOLE_EXPORT === '1'
    ? { output: 'export' as const, trailingSlash: true, images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
