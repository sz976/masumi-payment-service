import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'dist',
  basePath: '/admin',
  images: {
    unoptimized: true
  }
};

export default nextConfig;
