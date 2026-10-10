/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config, { isServer }) => {
    return config
  },
}

module.exports = nextConfig
