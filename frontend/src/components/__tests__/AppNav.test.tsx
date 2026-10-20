import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AppNav } from '../AppNav';

const renderNav = (pathname: string, isMobileMenuOpen = false) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppNav
        effectiveUserRole={null}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={() => undefined}
        handleLogout={() => undefined}
        pathname={pathname}
        isPlatformAdmin={false}
      />
    </MemoryRouter>,
  );

describe('AppNav landmarks and current page', () => {
  it('labels the navigation landmark and marks the current desktop link', () => {
    renderNav('/dashboard');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    const primary = within(nav).getByRole('list', { name: 'Primary navigation' });
    expect(within(primary).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(primary).getByRole('link', { name: 'Scan' })).not.toHaveAttribute('aria-current');
  });

  it('ties the mobile toggle to the menu and gives mobile rows a 44px floor', () => {
    renderNav('/scan', true);

    const toggle = screen.getByRole('button', { name: 'Close navigation menu' });
    const menuId = toggle.getAttribute('aria-controls');
    expect(menuId).toBeTruthy();
    const menu = document.getElementById(menuId as string) as HTMLElement;
    expect(menu).toBeInTheDocument();

    const scan = within(menu).getByRole('link', { name: 'Scan' });
    expect(scan).toHaveAttribute('aria-current', 'page');
    expect(scan).toHaveClass('min-h-11', 'text-base');
    expect(within(menu).getByRole('button', { name: 'Logout' })).toHaveClass('min-h-11');
  });

  it('keeps the mobile menu items and order', () => {
    renderNav('/scan', true);
    const toggle = screen.getByRole('button', { name: 'Close navigation menu' });
    const menu = document.getElementById(toggle.getAttribute('aria-controls') as string)!;

    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Scan',
      'Dashboard',
      'Reports',
      'Markdown Worklist',
      'All Expiry Entries',
      'Expired Items',
      'Supplier Credits',
      'Usage Report',
      'Markdown Calculator',
      'Profile',
      'Billing',
    ]);
    fireEvent.click(toggle);
  });
});
