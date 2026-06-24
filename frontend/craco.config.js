const path = require('path');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const sharedMarkdownPath = path.resolve(__dirname, '../shared/domain/markdown.ts');

function includeSharedMarkdownInBabelLoader(rule) {
  if (!rule || typeof rule !== 'object') {
    return;
  }

  if (rule.loader && rule.loader.includes('babel-loader') && rule.include) {
    rule.include = Array.isArray(rule.include)
      ? Array.from(new Set([...rule.include, sharedMarkdownPath]))
      : [rule.include, sharedMarkdownPath];
    return;
  }

  if (Array.isArray(rule.oneOf)) {
    rule.oneOf.forEach(includeSharedMarkdownInBabelLoader);
  }

  if (Array.isArray(rule.rules)) {
    rule.rules.forEach(includeSharedMarkdownInBabelLoader);
  }
}

module.exports = {
  style: {
    postcss: {
      plugins: [require('tailwindcss'), require('autoprefixer')],
    },
  },
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.resolve = webpackConfig.resolve || {};
      webpackConfig.resolve.alias = {
        ...(webpackConfig.resolve.alias || {}),
        '@shared/markdown': sharedMarkdownPath,
      };

      const moduleScopePlugin = webpackConfig.resolve.plugins?.find(
        (plugin) => plugin?.constructor?.name === 'ModuleScopePlugin',
      );
      moduleScopePlugin?.allowedFiles?.add(sharedMarkdownPath);

      webpackConfig.module.rules.forEach(includeSharedMarkdownInBabelLoader);

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
        '^@shared/markdown$': '<rootDir>/../shared/domain/markdown.ts',
        '^uuid$': '<rootDir>/src/__mocks__/uuid.js',
      },
    },
  },
};
