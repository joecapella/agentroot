/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Tell Next.js this is the workspace root so it doesn't get confused by
  // lockfiles in parent directories (e.g. ~/package-lock.json).
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    '*': ['./src/CalculatorAgent/**', './src/CofounderAgent/**', './.venv/**', './.azure/**'],
  },
};

export default nextConfig;
