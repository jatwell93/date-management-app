import { render, screen, fireEvent } from '@testing-library/react';
import { UpgradeModal } from '../UpgradeModal';

describe('UpgradeModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSelectPlan = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders tier comparison table with all 4 tiers', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="free"
      />,
    );

    expect(screen.getByTestId('tier-card-free')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-starter')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-professional')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-enterprise')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-card-premium')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tier-card-concierge')).not.toBeInTheDocument();
  });

  it('displays pricing for each tier', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="free"
      />,
    );

    expect(screen.getByText(/A\$0/)).toBeInTheDocument();
    expect(screen.getByText(/A\$39/)).toBeInTheDocument();
    expect(screen.getByText(/A\$99/)).toBeInTheDocument();
    expect(screen.getByText(/Contact Sales/)).toBeInTheDocument();
  });

  it('shows feature comparison with checkmarks', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    expect(screen.getAllByText(/Max SKUs/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Max Users/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Advanced Analytics/i).length).toBeGreaterThan(0);
  });

  it('highlights current tier', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="professional"
      />,
    );

    const professionalCard = screen.getByTestId('tier-card-professional');
    expect(professionalCard).toHaveClass('border-semantic-primary');
  });

  it('calls onSelectPlan when upgrade button clicked', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    const upgradeButton = screen.getAllByRole('button', { name: /upgrade/i })[0];
    fireEvent.click(upgradeButton);

    expect(mockOnSelectPlan).toHaveBeenCalled();
  });

  it('calls onClose when close button clicked', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('keeps modal content constrained to the mobile viewport so close remains reachable', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    expect(screen.getByTestId('upgrade-modal-content')).toHaveClass(
      'w-[calc(100vw-2rem)]',
      'max-w-[calc(100vw-2rem)]',
      'lg:max-w-6xl',
    );
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <UpgradeModal
        isOpen={false}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('disables upgrade button for current tier', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="professional"
      />,
    );

    const professionalCard = screen.getByTestId('tier-card-professional');
    const button = professionalCard.querySelector('button');
    expect(button).toHaveTextContent(/Current Plan/i);
    expect(button).toBeDisabled();
  });

  it('shows annual pricing option', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    expect(screen.getByText(/Annual/i)).toBeInTheDocument();
    expect(screen.getByText(/Monthly/i)).toBeInTheDocument();
  });

  it('selects Professional annual billing without exposing Enterprise checkout', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Annual/i }));
    const professionalCard = screen.getByTestId('tier-card-professional');
    fireEvent.click(professionalCard.querySelector('button') as HTMLButtonElement);

    expect(mockOnSelectPlan).toHaveBeenCalledWith('professional', 'annual');
    expect(screen.getByTestId('tier-card-enterprise')).toHaveTextContent('Contact Us');
  });
});
