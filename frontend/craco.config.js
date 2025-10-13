const path = require("path");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

module.exports = {
  style: {
    postcss: {
      plugins: [require("tailwindcss"), require("autoprefixer")],
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
};
