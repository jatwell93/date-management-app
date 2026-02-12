# LLXPRT - Date Management Application (React Frontend)

This is a Progressive Web App (PWA) for pharmacy inventory date management and markdown tracking. The app is optimized for both desktop and handheld pharmacy PDT devices (Zebra TC21-HC, CipherLab RS36, etc.).

## Handheld UI Components Documentation

The application includes specialized components for pharmacy PDT devices:

- **[Handheld Components Guide](../../docs/handheld-components.md)** - Usage examples for HandheldScanner, HandheldScanToolbar, and HandheldLayout
- **[Accessibility Guidelines](../../docs/handheld-accessibility.md)** - Touch target sizes, color contrast, keyboard navigation, screen reader support
- **[PWA Configuration](../../docs/handheld-pwa.md)** - Manifest.json setup, service worker, HTTPS deployment
- **[Testing Guide](../../docs/handheld-testing.md)** - Unit tests, integration tests, device emulation, actual hardware testing

## Quick Start

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm start
```

Opens [http://localhost:3000](http://localhost:3000) with hot reload.

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch

# Handheld component tests only
npm test -- --testPathPattern="ScanPage"
```

### Production Build

```bash
npm run build
```

Builds the app for production to the `build/` folder with optimizations.

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── HandheldScanner.tsx          # Full-screen camera scanner for PDT
│   │   ├── HandheldScanToolbar.tsx      # Floating sync/settings toolbar
│   │   ├── Scanner.tsx                  # Base scanner component
│   │   └── ...
│   ├── layouts/
│   │   └── HandheldLayout.tsx           # Conditional handheld/desktop layout
│   ├── pages/
│   │   ├── ScanPage.tsx                 # Primary scan workflow page
│   │   └── ...
│   ├── contexts/
│   │   └── HandheldContext.tsx          # Device detection context
│   ├── services/
│   │   ├── apiService.ts                # API client
│   │   └── ...
│   └── types/
│       └── handheld.ts                  # TypeScript interfaces
├── public/
│   ├── manifest.json                    # PWA manifest (portrait, standalone)
│   ├── index.html                       # HTML entry point
│   └── ...
├── package.json
└── README.md
```

## Available Scripts (CRA)

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
