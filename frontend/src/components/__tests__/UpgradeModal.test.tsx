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

    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Professional')).toBeInTheDocument();
    expect(screen.getByText('Premium')).toBeInTheDocument();
    expect(screen.getByText('Concierge')).toBeInTheDocument();
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

    expect(screen.getByText(/Max SKUs/i)).toBeInTheDocument();
    expect(screen.getByText(/Max Users/i)).toBeInTheDocument();
    expect(screen.getByText(/Advanced Analytics/i)).toBeInTheDocument();
  });

  it('highlights current tier', () => {
    const { container } = render(
      <UpgradeModal
        isOpen={true}
        onClose={mockOnClose}
        onSelectPlan={mockOnSelectPlan}
        currentTier="professional"
      />,
    );

    const professionalCard = container.querySelector('[data-tier="professional"]');
    expect(professionalCard).toHaveClass('border-blue-500');
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

    const upgradeButton = screen.getAllByText(/Upgrade/i)[0];
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

    const closeButton = screen.getByLabelText(/close/i);
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
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
