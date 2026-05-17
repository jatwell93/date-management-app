import fs from 'fs';
import path from 'path';

const phaseThreeFiles = [
  '../DashboardPage.tsx',
  '../ExpiredItemsPage.tsx',
  '../DetailedExpiryReportPage.tsx',
  '../UsageReportPage.tsx',
  '../StoreAreaManagementPage.tsx',
  '../UserManagementPage.tsx',
  '../../components/ExpiredLossReport.tsx',
  '../../components/MarkdownCalculator.tsx',
  '../../components/SubscriptionDashboard.tsx',
  '../CSVUploadPage.tsx',
  '../ReportsPage.tsx',
  '../SettingsPage.tsx',
  '../SubscriptionSettingsPage.tsx',
  '../OnboardingPage.tsx',
] as const;

const readSource = (relativeFile: (typeof phaseThreeFiles)[number]) =>
  fs.readFileSync(path.resolve(__dirname, relativeFile), 'utf8');

describe('phase 3 semantic page surfaces', () => {
  it('removes legacy inventory token classes from migrated wave 3 surfaces', () => {
    phaseThreeFiles.forEach((file) => {
      expect(readSource(file)).not.toMatch(/className=(?:`|"|')[^`"']*inventory-/);
    });
  });

  it('uses semantic tokens for dashboard, reporting, and upload page states', () => {
    expect(readSource('../DashboardPage.tsx')).toContain('text-semantic-critical');
    expect(readSource('../ExpiredItemsPage.tsx')).toContain('text-semantic-text-tertiary');
    expect(readSource('../CSVUploadPage.tsx')).toContain('bg-semantic-primary');
    expect(readSource('../ReportsPage.tsx')).toContain('bg-semantic-secondary-muted');
    expect(readSource('../OnboardingPage.tsx')).toContain('border-semantic-primary');
  });

  it('uses semantic data-viz and surface tokens in Phase 3 visualization components', () => {
    expect(readSource('../../components/ExpiredLossReport.tsx')).toContain(
      'text-semantic-critical',
    );
    expect(readSource('../../components/MarkdownCalculator.tsx')).toContain(
      'bg-semantic-surface-2',
    );
    expect(readSource('../../components/SubscriptionDashboard.tsx')).toContain(
      'bg-semantic-secondary',
    );
  });
});
