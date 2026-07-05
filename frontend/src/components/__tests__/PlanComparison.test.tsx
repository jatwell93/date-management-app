import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlanComparison } from '../PlanComparison';

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
