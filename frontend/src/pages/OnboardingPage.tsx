import { type ComponentType, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreateOrganization, useAuth, useOrganization } from '@clerk/clerk-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { apiService } from '../lib/api.service';
import { Loader2 } from 'lucide-react';

type OnboardingStep = 0 | 1 | 2;
const MAX_STEP: OnboardingStep = 2;

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

/**
 * Step 0: Organization Creation
 * - Render Clerk's CreateOrganization component
 * - Redirect to step 1 on completion
 */
function Step0(_props: StepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Set Up Your Organisation</CardTitle>
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

/**
 * Step 1: Catalog Choice
 * - Option 1: Upload CSV file (routes to /csv-upload with return URL)
 * - Option 2: Load Demo Data (calls seed endpoint, then advances to step 2)
 */
function Step1({ onNext }: StepProps) {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCSVUpload = () => {
    // Navigate to CSV upload page with return URL to step 2
    navigate('/csv-upload?return=/onboarding?step=2');
  };

  const handleDemoData = async () => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Set Up Your Catalog</CardTitle>
        <CardDescription>How would you like to load your pharmacy inventory?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="bg-semantic-critical-muted border border-semantic-critical-muted text-semantic-critical px-4 py-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CSV Upload Option */}
          <div className="border-2 border-dashed border-hairline rounded-lg p-6 hover:border-semantic-primary hover:bg-semantic-secondary-muted transition cursor-pointer">
            <button
              onClick={handleCSVUpload}
              disabled={isLoading}
              className="w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-center mb-3">
                <svg
                  className="size-8 text-semantic-secondary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-semantic-text-primary">Upload CSV File</h3>
              <p className="text-sm text-semantic-text-secondary mt-2">
                Import your existing product catalog from a CSV file
              </p>
            </button>
          </div>

          {/* Demo Data Option */}
          <div className="border-2 border-dashed border-hairline rounded-lg p-6 hover:border-semantic-success hover:bg-semantic-success-muted transition cursor-pointer relative">
            <button
              onClick={handleDemoData}
              disabled={isLoading}
              className="w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-center mb-3">
                {isLoading ? (
                  <Loader2 className="size-8 text-semantic-success animate-spin" />
                ) : (
                  <svg
                    className="size-8 text-semantic-success"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                )}
              </div>
              <h3 className="font-semibold text-semantic-text-primary">
                {isLoading ? 'Seeding Data...' : 'Load Demo Data'}
              </h3>
              <p className="text-sm text-semantic-text-secondary mt-2">
                Get started quickly with sample pharmacy products
              </p>
            </button>
          </div>
        </div>

        <div className="text-sm text-semantic-text-tertiary text-center mt-6">
          You can change your catalog settings anytime in Settings
        </div>
      </CardContent>
    </Card>
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

  const slides = [
    {
      title: 'Welcome to Your Dashboard',
      description:
        'This is your command center. See inventory summary, expiry alerts, and team activity at a glance.',
      icon: '📊',
    },
    {
      title: 'Manage Your Catalog',
      description:
        'View all your products, update pricing and suppliers, and organize your inventory.',
      icon: '📦',
    },
    {
      title: 'Start Scanning',
      description: 'Add items to inventory by scanning barcodes or manually entering details.',
      icon: '📱',
    },
  ];

  const currentSlide = slides[slideIndex];

  const handleNext = () => {
    if (slideIndex < slides.length - 1) {
      setSlideIndex(slideIndex + 1);
    } else {
      // Last slide - navigate to dashboard
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
        <CardTitle className="text-center text-2xl font-semibold">{currentSlide.icon}</CardTitle>
        <CardTitle className="text-center text-xl font-semibold mt-2">
          {currentSlide.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-center text-semantic-text-secondary text-lg leading-relaxed">
          {currentSlide.description}
        </p>

        {/* Carousel Indicators */}
        <div className="flex justify-center gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => setSlideIndex(index)}
              className={`size-2 rounded-full transition ${
                index === slideIndex ? 'bg-semantic-secondary w-8' : 'bg-semantic-surface-4'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>

        {/* Navigation Buttons */}
        <div className="flex justify-between gap-3 pt-4">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={slideIndex === 0}
            className="flex-1"
          >
            Back
          </Button>
          <Button onClick={handleNext} className="flex-1">
            {slideIndex === slides.length - 1 ? 'Go to Dashboard' : 'Next'}
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

export function OnboardingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(0);

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
    <div className="flex items-center justify-center min-h-screen bg-semantic-surface-2">
      <div className="w-full max-w-2xl px-4">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-semibold font-heading text-semantic-text-primary">
            {stepConfig.title}
          </h1>
          <p className="mt-2 text-semantic-text-secondary">{stepConfig.description}</p>
        </div>

        {/* Progress Indicator */}
        <div className="flex justify-center gap-2 mb-8">
          {Array.from({ length: MAX_STEP + 1 }, (_, i) => i).map((step) => (
            <div
              key={step}
              className={`h-2 flex-1 rounded-full transition ${
                step <= currentStep ? 'bg-semantic-secondary' : 'bg-semantic-surface-4'
              }`}
            />
          ))}
        </div>

        {/* Step Content */}
        <StepComponent
          onNext={handleNext}
          onBack={handleBack}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
        />

        {/* Step Counter */}
        <div className="text-center text-sm text-semantic-text-tertiary mt-6">
          Step {currentStep + 1} of 3
        </div>
      </div>
    </div>
  );
}
