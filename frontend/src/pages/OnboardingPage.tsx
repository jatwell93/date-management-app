import { type ComponentType, type ReactNode, useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreateOrganization, useAuth, useOrganization } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { apiService } from '../lib/api.service';
import { FileText, Loader2, Zap } from 'lucide-react';

type OnboardingStep = 0 | 1 | 2;
const MAX_STEP: OnboardingStep = 2;
const STEP_COUNT = MAX_STEP + 1;

/**
 * Validates if a value is a valid OnboardingStep.
 */
const isValidStep = (step: unknown): step is OnboardingStep =>
  typeof step === 'number' && step >= 0 && step <= MAX_STEP;

/**
 * Normalizes step to prevent users from returning to Step 0 after org creation.
 */
const normalizeStep = (step: OnboardingStep, hasOrg: boolean): OnboardingStep =>
  step === 0 && hasOrg ? 1 : step;

interface StepConfig {
  title: string;
  description: string;
  component: ComponentType<StepProps>;
}

interface StepProps {
  onNext: () => void;
  onBack?: () => void;
  isFirstStep: boolean;
  isLastStep: boolean;
}

/** CardTitle renders a div; expose it to assistive tech as a level-2 heading. */
function StepHeading({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <CardTitle role="heading" aria-level={2} className={className}>
      {children}
    </CardTitle>
  );
}

/**
 * Step 0: Organization Creation
 * - Render Clerk's CreateOrganization component
 * - Redirect to step 1 on completion
 */
function Step0(_props: StepProps) {
  return (
    <Card>
      <CardHeader>
        <StepHeading className="text-xl font-semibold">Set Up Your Organisation</StepHeading>
        <CardDescription>
          Your organisation groups your team and inventory data together. You&apos;ll be the admin
          and can invite others once it&apos;s created.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateOrganization
          routing="path"
          path="/onboarding?step=1"
          afterCreateOrganizationUrl="/onboarding?step=1"
          skipInvitationScreen
        />
      </CardContent>
    </Card>
  );
}

interface CatalogOptionProps {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
  className: string;
}

/** A whole-card button so the full padded area is clickable and focusable. */
function CatalogOption({
  icon,
  title,
  description,
  onClick,
  disabled,
  className,
}: CatalogOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left border-2 border-dashed border-hairline rounded-lg p-6 motion-safe:transition-colors cursor-pointer outline-hidden focus-visible:border-semantic-primary focus-visible:ring-[3px] focus-visible:ring-semantic-primary/50 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <span className="flex items-center justify-center mb-3">{icon}</span>
      <span className="block font-semibold text-semantic-text-primary">{title}</span>
      <span className="block text-sm text-semantic-text-secondary mt-2">{description}</span>
    </button>
  );
}

function DemoDataIcon({ isLoading }: { isLoading: boolean }) {
  if (isLoading) {
    return (
      <Loader2
        aria-hidden="true"
        className="size-8 text-semantic-success motion-safe:animate-spin"
      />
    );
  }
  return <Zap aria-hidden="true" className="size-8 text-semantic-success" />;
}

function useSeedDemoData(onNext: () => void) {
  const { getToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seed = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication required');

      await apiService.post('/api/organization/seed-demo-data', {}, token);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demo data');
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, error, seed };
}

function SeedError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="bg-semantic-critical-muted border border-semantic-critical-muted-foreground/20 text-semantic-critical-muted-foreground px-4 py-3 rounded-md text-sm mb-4"
    >
      {message}
    </div>
  );
}

/**
 * Step 1: Catalog Choice
 * - Option 1: Upload CSV file (routes to /csv-upload with return URL)
 * - Option 2: Load Demo Data (calls seed endpoint, then advances to step 2)
 */
function Step1({ onNext }: StepProps) {
  const navigate = useNavigate();
  const { isLoading, error, seed } = useSeedDemoData(onNext);

  const handleCSVUpload = () => {
    // Navigate to CSV upload page with return URL to step 2
    navigate('/csv-upload?return=/onboarding?step=2');
  };

  return (
    <Card>
      <CardHeader>
        <StepHeading className="text-xl font-semibold">Set Up Your Catalog</StepHeading>
        <CardDescription>How would you like to load your pharmacy inventory?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <SeedError message={error} />}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy={isLoading}>
          <CatalogOption
            icon={<FileText aria-hidden="true" className="size-8 text-semantic-secondary" />}
            title="Upload CSV File"
            description="Import your existing product catalog from a CSV file"
            onClick={handleCSVUpload}
            disabled={isLoading}
            className="hover:border-semantic-primary hover:bg-semantic-secondary-muted"
          />
          <CatalogOption
            icon={<DemoDataIcon isLoading={isLoading} />}
            title={isLoading ? 'Seeding Data...' : 'Load Demo Data'}
            description="Get started quickly with sample pharmacy products"
            onClick={() => void seed()}
            disabled={isLoading}
            className="hover:border-semantic-success hover:bg-semantic-success-muted"
          />
        </div>

        <p role="status" className="sr-only">
          {isLoading ? 'Loading demo data' : ''}
        </p>

        <div className="text-sm text-semantic-text-tertiary text-center mt-6">
          You can change your catalog settings anytime in Settings
        </div>
      </CardContent>
    </Card>
  );
}

const TOUR_SLIDES = [
  {
    id: 'dashboard',
    title: 'Welcome to Your Dashboard',
    description:
      'This is your command center. See inventory summary, expiry alerts, and team activity at a glance.',
    icon: '📊',
  },
  {
    id: 'catalog',
    title: 'Manage Your Catalog',
    description:
      'View all your products, update pricing and suppliers, and organize your inventory.',
    icon: '📦',
  },
  {
    id: 'scanning',
    title: 'Start Scanning',
    description: 'Add items to inventory by scanning barcodes or manually entering details.',
    icon: '📱',
  },
] as const;

interface TourDotsProps {
  slideIndex: number;
  onSelect: (index: number) => void;
}

function TourDots({ slideIndex, onSelect }: TourDotsProps) {
  return (
    <div className="flex justify-center gap-2">
      {TOUR_SLIDES.map((slide, index) => {
        const isCurrent = index === slideIndex;
        return (
          <button
            key={slide.id}
            type="button"
            onClick={() => onSelect(index)}
            aria-current={isCurrent ? 'true' : undefined}
            aria-label={`Slide ${index + 1} of ${TOUR_SLIDES.length}: ${slide.title}`}
            className="flex items-center justify-center size-11 rounded-full outline-hidden focus-visible:ring-[3px] focus-visible:ring-semantic-primary/50"
          >
            <span
              aria-hidden="true"
              className={`block h-2 rounded-full motion-safe:transition-colors ${
                isCurrent ? 'bg-semantic-secondary w-8' : 'bg-semantic-surface-4 w-2'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Step 2: Orientation Carousel
 * - 3-slide carousel explaining Dashboard > Catalog > Scans
 * - Final button redirects to /scan
 */
function Step2(_props: StepProps) {
  const navigate = useNavigate();
  const [slideIndex, setSlideIndex] = useState(0);

  const currentSlide = TOUR_SLIDES[slideIndex];
  const isLastSlide = slideIndex === TOUR_SLIDES.length - 1;

  const handleNext = () => {
    if (!isLastSlide) {
      setSlideIndex(slideIndex + 1);
    } else {
      navigate('/scan');
    }
  };

  const handleBack = () => {
    if (slideIndex > 0) {
      setSlideIndex(slideIndex - 1);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div aria-live="polite">
          <p className="sr-only">
            Slide {slideIndex + 1} of {TOUR_SLIDES.length}
          </p>
          <div aria-hidden="true" className="text-center text-2xl font-semibold">
            {currentSlide.icon}
          </div>
          <StepHeading className="text-center text-xl font-semibold mt-2">
            {currentSlide.title}
          </StepHeading>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-center text-semantic-text-secondary text-lg leading-relaxed">
          {currentSlide.description}
        </p>

        <TourDots slideIndex={slideIndex} onSelect={setSlideIndex} />

        <div className="flex justify-between gap-3 pt-4">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={slideIndex === 0}
            className="flex-1 min-h-11"
          >
            Back
          </Button>
          <Button onClick={handleNext} className="flex-1 min-h-11">
            {isLastSlide ? 'Go to Dashboard' : 'Next'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const STEPS: Record<OnboardingStep, StepConfig> = {
  0: {
    title: 'Welcome to Inventory Manager',
    description:
      'Create your organisation to get started. You can invite team members after setup.',
    component: Step0,
  },
  1: {
    title: 'Set Up Your Catalog',
    description: 'Choose how to load your pharmacy inventory',
    component: Step1,
  },
  2: {
    title: 'Quick Tour',
    description: 'Learn the basics of your new inventory system',
    component: Step2,
  },
};

const STEP_ORDER: OnboardingStep[] = [0, 1, 2];

function StepProgress({ currentStep }: { currentStep: OnboardingStep }) {
  return (
    <ol aria-label="Onboarding progress" className="flex justify-center gap-2 mb-8">
      {STEP_ORDER.map((step) => (
        <li
          key={step}
          aria-current={step === currentStep ? 'step' : undefined}
          className={`h-2 flex-1 rounded-full motion-safe:transition-colors ${
            step <= currentStep ? 'bg-semantic-secondary' : 'bg-semantic-surface-4'
          }`}
        >
          <span className="sr-only">
            {`Step ${step + 1}: ${STEPS[step].title}${step < currentStep ? ' (done)' : ''}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Moves focus to the step heading whenever the step changes (not on first render). */
function useFocusOnStepChange(currentStep: OnboardingStep) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(currentStep);

  useEffect(() => {
    if (previousStep.current !== currentStep) {
      previousStep.current = currentStep;
      headingRef.current?.focus();
    }
  }, [currentStep]);

  return headingRef;
}

export function OnboardingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(0);
  const headingRef = useFocusOnStepChange(currentStep);

  // Initialize step from URL query param or organization state
  useEffect(() => {
    if (!isOrgLoaded) return;

    const stepParam = searchParams.get('step');
    if (stepParam !== null) {
      const step = parseInt(stepParam, 10);
      if (isValidStep(step)) {
        const normalized = normalizeStep(step, !!organization);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncs step state with the URL query param
        setCurrentStep(normalized);
        if (normalized !== step) {
          setSearchParams({ step: String(normalized) });
        }
      }
    } else if (organization) {
      // If they have an org but no step param, start at step 1
      setCurrentStep(1);
      setSearchParams({ step: '1' });
    }
  }, [searchParams, organization, isOrgLoaded, setSearchParams]);

  const handleNext = () => {
    if (currentStep < MAX_STEP) {
      const nextStep = (currentStep + 1) as OnboardingStep;
      setCurrentStep(nextStep);
      setSearchParams({ step: String(nextStep) });
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      const prevStep = (currentStep - 1) as OnboardingStep;
      const normalized = normalizeStep(prevStep, !!organization);
      if (normalized === prevStep) {
        // Only go back if not blocked by org check
        setCurrentStep(normalized);
        setSearchParams({ step: String(normalized) });
      }
    }
  };

  const stepConfig = STEPS[currentStep];
  const StepComponent = stepConfig.component;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === MAX_STEP;

  return (
    <section aria-labelledby="onboarding-title" className="flex justify-center py-6">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-semantic-text-secondary">
            Step {currentStep + 1} of {STEP_COUNT}
          </p>
          <h1
            id="onboarding-title"
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 text-3xl font-semibold font-heading text-semantic-text-primary outline-hidden"
          >
            {stepConfig.title}
          </h1>
          <p className="mt-2 text-semantic-text-secondary">{stepConfig.description}</p>
        </div>

        <StepProgress currentStep={currentStep} />

        <StepComponent
          onNext={handleNext}
          onBack={handleBack}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
        />
      </div>
    </section>
  );
}
