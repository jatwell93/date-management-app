import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlanComparison } from '../PlanComparison';
import { PROFESSIONAL_TRIAL_DAYS } from '@shared/subscription-types';

describe('PlanComparison', () => {
  const onSelectPlan = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all four launch tiers', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    expect(screen.getByTestId('tier-card-free')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-starter')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-professional')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-enterprise')).toBeInTheDocument();
  });

  it('states the trial length from the shared constant', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    expect(
      screen.getByText(new RegExp(`No-card ${PROFESSIONAL_TRIAL_DAYS}-day Professional trial`)),
    ).toBeInTheDocument();
  });

  it('emits the selected tier and billing cycle when Upgrade is clicked', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    const professional = screen.getByTestId('tier-card-professional');
    fireEvent.click(within(professional).getByRole('button', { name: /upgrade/i }));

    expect(onSelectPlan).toHaveBeenCalledWith('professional', 'monthly');
  });

  it('switches to annual pricing via the toggle', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    fireEvent.click(screen.getByRole('button', { name: /Annual/i }));

    const professional = screen.getByTestId('tier-card-professional');
    fireEvent.click(within(professional).getByRole('button', { name: /upgrade/i }));

    expect(onSelectPlan).toHaveBeenCalledWith('professional', 'annual');
    expect(within(professional).getByText(/Billed A\$990 annually/)).toBeInTheDocument();
  });

  it('drives upgrades only — tiers below the current plan are not selectable', () => {
    render(<PlanComparison currentTier="professional" onSelectPlan={onSelectPlan} />);

    // Downgrades: free and starter have no upgrade CTA.
    const free = screen.getByTestId('tier-card-free');
    const starter = screen.getByTestId('tier-card-starter');
    expect(within(free).queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    expect(within(starter).queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    expect(within(free).getByRole('button')).toBeDisabled();

    // Current tier is highlighted and locked.
    const professional = screen.getByTestId('tier-card-professional');
    expect(professional).toHaveClass('border-semantic-primary');
    const currentButton = within(professional).getByRole('button');
    expect(currentButton).toHaveTextContent(/Current Plan/i);
    expect(currentButton).toBeDisabled();
  });

  it('keeps downgrade cards at full opacity so their text stays AA legible', () => {
    render(<PlanComparison currentTier="professional" onSelectPlan={onSelectPlan} />);

    expect(screen.getByTestId('tier-card-free')).not.toHaveClass('opacity-60');
    expect(screen.getByTestId('tier-card-starter')).not.toHaveClass('opacity-60');
  });

  it('uses AA-contrast tokens for the annual saving badge', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    const badge = screen.getByText('Save 17%');
    expect(badge).toHaveClass('text-semantic-success-muted-foreground', 'text-sm');
    expect(badge).not.toHaveClass('bg-semantic-success');
  });

  it('exposes the billing-cycle toggle state with aria-pressed', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    const group = screen.getByRole('group', { name: 'Billing cycle' });
    const monthly = within(group).getByRole('button', { name: 'Monthly' });
    const annual = within(group).getByRole('button', { name: /Annual/ });
    expect(monthly).toHaveAttribute('aria-pressed', 'true');
    expect(annual).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(annual);

    expect(monthly).toHaveAttribute('aria-pressed', 'false');
    expect(annual).toHaveAttribute('aria-pressed', 'true');
  });

  it('names each tier CTA after its plan and exposes tier names as headings', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    expect(screen.getByRole('button', { name: 'Upgrade (Starter plan)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade (Professional plan)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current Plan (Free plan)' })).toBeDisabled();
    expect(screen.getByRole('heading', { level: 2, name: 'Professional' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Included' }).length).toBeGreaterThan(0);
  });

  it('nests headings one level deeper when rendered inside a dialog', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} headingLevel={3} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Professional' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('locks every tier while a checkout is in flight', () => {
    render(
      <PlanComparison currentTier="free" onSelectPlan={onSelectPlan} busyTier="professional" />,
    );

    const starter = within(screen.getByTestId('tier-card-starter')).getByRole('button');
    expect(starter).toBeDisabled();
    fireEvent.click(starter);
    expect(onSelectPlan).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId('tier-card-professional')).getByRole('button'),
    ).toHaveAttribute('aria-busy', 'true');
  });

  it('never exposes Enterprise self-serve checkout', () => {
    render(<PlanComparison currentTier="free" onSelectPlan={onSelectPlan} />);

    const enterprise = screen.getByTestId('tier-card-enterprise');
    expect(enterprise).toHaveTextContent('Contact Us');
    fireEvent.click(within(enterprise).getByRole('button'));
    expect(onSelectPlan).not.toHaveBeenCalled();
  });

  it('shows a Processing state for the busy tier', () => {
    render(
      <PlanComparison currentTier="free" onSelectPlan={onSelectPlan} busyTier="professional" />,
    );

    const professional = screen.getByTestId('tier-card-professional');
    const button = within(professional).getByRole('button');
    expect(button).toHaveTextContent('Processing...');
    expect(button).toBeDisabled();
  });
});
