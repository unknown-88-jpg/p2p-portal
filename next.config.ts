import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Akar Turbopack = folder proyek ini (menghindari peringatan bila ada package-lock.json lain di folder induk).
  turbopack: { root: process.cwd() },
};

export default config;
