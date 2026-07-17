import { render, screen } from '@testing-library/react';
import { ExpectQaStatus } from '../App';

describe('Expect QA diagnostics overlay', () => {
  // Regression: ISSUE-QA-003 — desktop diagnostics intercepted page actions beneath it
  // Found by /qa on 2026-07-17
  // Report: Browser QA for enhance-supplier-policy-capture
  it('does not receive pointer events in its desktop presentation', () => {
    process.env.REACT_APP_EXPECT_QA_STATUS = 'true';
    window.innerWidth = 1024;

    render(
      <ExpectQaStatus
        isLoggedIn
        isFullySignedIn
        hasOrganization
        userId={42}
        userName="Expect Admin"
        frontendRole="admin"
        backendRole="admin"
        organizationId="org-expect"
        bootstrapStatus="ready"
        bootstrapError={null}
        hasToken
      />,
    );

    expect(screen.getByRole('region', { name: 'Expect QA auth diagnostics' })).toHaveClass(
      'pointer-events-none',
    );
  });
});
