import fs from 'fs';
import path from 'path';

describe('App route performance boundaries', () => {
  it('does not statically import non-scan workflow routes into the app shell', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

    [
      './pages/DashboardPage',
      './pages/ReportsPage',
      './pages/UsageReportPage',
      './components/MarkdownCalculator',
      './pages/UserManagementPage',
      './pages/StoreAreaManagementPage',
      './pages/CSVUploadPage',
      './pages/DetailedExpiryReportPage',
      './pages/ExpiryEntriesPage',
      './pages/ExpiredItemsPage',
      './pages/SubscriptionSettingsPage',
    ].forEach((modulePath) => {
      expect(appSource).not.toContain(` from '${modulePath}'`);
      expect(appSource).toContain(`import('${modulePath}')`);
    });
  });

  it('keeps the markdown calculator route behind the app shell lazy boundary', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

    expect(appSource).toMatch(
      /const MarkdownCalculator = React\.lazy\(\(\) =>\s*import\('\.\/components\/MarkdownCalculator'\)/,
    );
    expect(appSource).toContain('path="/markdown-calculator"');
  });
});
