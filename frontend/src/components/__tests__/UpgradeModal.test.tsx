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
        currentTier="starter"
      />,
    );

    expect(screen.getByTestId('tier-card-starter')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-professional')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-premium')).toBeInTheDocument();
    expect(screen.getByTestId('tier-card-concierge')).toBeInTheDocument();
  });

  it('displays pricing for each tier', () => {
    render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="starter"
      />,
    );

    expect(screen.getByText(/\$99/)).toBeInTheDocument(); // Starter
    expect(screen.getByText(/\$249/)).toBeInTheDocument(); // Professional
    expect(screen.getByText(/\$499/)).toBeInTheDocument(); // Premium
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
});
