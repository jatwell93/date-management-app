const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
  style: {
    postcss: {
      plugins: [require('tailwindcss'), require('autoprefixer')],
    },
  },
  webpack: {
    configure: (webpackConfig) => {
      // Add bundle analyzer plugin only when BUNDLE_ANALYZE environment variable is set
      if (process.env.BUNDLE_ANALYZE) {
        webpackConfig.plugins.push(new BundleAnalyzerPlugin());
      }
      return webpackConfig;
    },
  },
  devServer: (devServerConfig) => ({
    ...devServerConfig,
    historyApiFallback: {
      ...(typeof devServerConfig.historyApiFallback === 'object'
        ? devServerConfig.historyApiFallback
        : {}),
      disableDotRule: true,
      index: '/index.html',
    },
  }),
  jest: {
    configure: {
      transformIgnorePatterns: ['node_modules/(?!uuid|react-router|react-router-dom)'],
      moduleNameMapper: {
        '^uuid$': '<rootDir>/src/__mocks__/uuid.js',
      },
    },
  },
};
