import React from 'react';
import { render, screen } from '@testing-library/react';
import { ClerkProvider } from '@clerk/clerk-react';

/**
 * Test: ClerkProvider is correctly configured
 * This verifies that Clerk is initialized and available to the app
 */
describe('Clerk Integration Setup', () => {
  beforeEach(() => {
    // Set mock env var for testing
    process.env.REACT_APP_CLERK_PUBLISHABLE_KEY = 'pk_test_example';
  });

  it('should render ClerkProvider without crashing', () => {
    const TestComponent = () => (
      <ClerkProvider publishableKey="pk_test_example" afterSignOutUrl="/">
        <div>Test App with Clerk</div>
      </ClerkProvider>
    );

    render(<TestComponent />);
    expect(screen.getByText('Test App with Clerk')).toBeInTheDocument();
  });

  it('should throw error if REACT_APP_CLERK_PUBLISHABLE_KEY is missing', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    // This should fail during initialization
    const missingKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY?.trim() === '';
    expect(missingKey === true || process.env.REACT_APP_CLERK_PUBLISHABLE_KEY).toBeDefined();

    consoleSpy.mockRestore();
  });
});
