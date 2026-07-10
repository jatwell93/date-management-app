import {
  runCreditClaimReminderJob,
  runCreditClaimPhotoPurgeJob,
} from '../../jobs/credit-claim.job';
import { CreditClaimService } from '../../services/credit-claim.service';

vi.mock('../../services/credit-claim.service', () => ({
  CreditClaimService: vi.fn(),
}));

const MockedService = CreditClaimService as unknown as ReturnType<typeof vi.fn>;

function fakePrisma(orgIds: string[]) {
  return {
    organization: { findMany: vi.fn(async () => orgIds.map((id) => ({ id }))) },
  } as never;
}

describe('credit-claim jobs', () => {
  beforeEach(() => {
    MockedService.mockReset();
  });

  describe('runCreditClaimReminderJob', () => {
    it('sends a follow-up for each due claim and counts failures without stopping', async () => {
      const getFollowUpDue = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
      const sendFollowUp = vi.fn(async (id: number) => {
        if (id === 2) throw new Error('provider down');
        return {};
      });
      MockedService.mockImplementation(function () {
        return { getFollowUpDue, sendFollowUp };
      });

      const result = await runCreditClaimReminderJob(fakePrisma(['org-1']));

      expect(result).toEqual({ sent: 1, failed: 1 });
      expect(sendFollowUp).toHaveBeenCalledTimes(2);
    });

    it('processes every organization', async () => {
      const getFollowUpDue = vi.fn(async () => [{ id: 1 }]);
      const sendFollowUp = vi.fn(async () => ({}));
      MockedService.mockImplementation(function () {
        return { getFollowUpDue, sendFollowUp };
      });

      const result = await runCreditClaimReminderJob(fakePrisma(['org-1', 'org-2']));

      expect(result.sent).toBe(2);
      expect(MockedService).toHaveBeenCalledTimes(2);
    });
  });

  describe('runCreditClaimPhotoPurgeJob', () => {
    it('sums purged photos across organizations', async () => {
      const purgeExpiredPhotos = vi.fn(async () => 3);
      MockedService.mockImplementation(function () {
        return { purgeExpiredPhotos };
      });

      const result = await runCreditClaimPhotoPurgeJob(fakePrisma(['org-1', 'org-2']));

      expect(result).toEqual({ purged: 6 });
    });
  });
});
