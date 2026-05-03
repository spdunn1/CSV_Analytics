/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['csv-parse', 'fft.js', 'parquetjs-lite'],
  },
  webpack: (config) => {
    // plotly needs these
    config.resolve.fallback = { fs: false, path: false };
    return config;
  },
};

export default nextConfig;
