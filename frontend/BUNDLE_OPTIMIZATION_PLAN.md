# Bundle Size Optimization Plan

## Current State
- Main bundle size: ~260.5 kB after gzip
- Target: Reduce by at least 30% (to ~180 kB)

## Identified Optimization Opportunities

### 1. Code Splitting with React.lazy (High Priority)
The main bundle includes all pages and components. Implementing code splitting will dramatically reduce initial load:

```jsx
// Example for App.tsx
const ScanPage = React.lazy(() => import('./pages/ScanPage'));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
// ... etc

// Then use Suspense wrappers for routes
<Suspense fallback={<LoadingSpinner />}>
  <ScanPage token={token} />
</Suspense>
```

Note: Requires components to be default exports or use a different import strategy.

### 2. Optimize Radix UI Imports (Medium Priority)
Instead of importing entire component sets, import only what's needed:

```jsx
// Instead of importing from the main radix package
import * as Select from "@radix-ui/react-select";

// Import specific parts directly
import Select from "@radix-ui/react-select";
import { SelectTrigger, SelectContent, SelectItem } from "@radix-ui/react-select";
```

### 3. Optimize Icon Usage (Medium Priority)
Instead of importing an entire icon library, consider:
- Only importing specific icons needed
- Using SVG sprites for frequently used icons
- Using CSS background images for simple icons

### 4. Tree-shaking Unused Code (Medium Priority)
- Check for unused components and remove them
- Use webpack-bundle-analyzer to identify largest packages
- Implement proper sideEffects flags in package.json

### 5. Optimize XLSX Library Usage (Low Priority)
The XLSX library is quite large for CSV/Excel functionality. Consider:
- Lazy loading this functionality only on the CSV upload page
- Using a smaller alternative if full Excel support isn't needed

### 6. Optimize LocalForage (Low Priority)
LocalForage has multiple backends. Ensure only the needed storage backend is included in the bundle.

## Implementation Strategy

### Phase 1: Code Splitting
1. Convert components to default exports or create intermediate modules for React.lazy
2. Implement routing-level code splitting first
3. Add loading states with Suspense boundaries

### Phase 2: Library Optimization
1. Analyze bundle with webpack-bundle-analyzer
2. Optimize the largest dependencies first
3. Implement proper import strategies

### Phase 3: Advanced Optimizations
1. Implement dynamic imports for non-critical features
2. Consider using smaller alternatives for large libraries where possible
3. Optimize images and assets

## Tools for Analysis

```bash
# To analyze bundle size
npm install --save-dev webpack-bundle-analyzer

# Add to craco.config.js:
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

// In webpack config:
configure: (webpackConfig) => {
  if (process.env.ANALYZE) {
    webpackConfig.plugins.push(new BundleAnalyzerPlugin());
  }
  return webpackConfig;
}

# Run analysis:
ANALYZE=true npm run build
```

## Expected Impact
- Code splitting: 40-60% reduction in initial bundle
- Library import optimization: 10-20% reduction
- Total expected reduction: 50-70% reduction in initial bundle