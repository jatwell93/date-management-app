import { apiService } from '../lib/api.service';
import * as service from '../services/platformCatalogueService';

vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('platform catalogue service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the platform provenance and pending-correction contracts', async () => {
    await service.getCatalogueProvenance('token');
    await service.getPendingCatalogueCorrections('token');
    await service.reviewCatalogueCorrection(12, 'ACCEPTED', 'token');

    expect(apiService.get).toHaveBeenCalledWith('/platform/catalogue/provenance', 'token');
    expect(apiService.get).toHaveBeenCalledWith(
      '/platform/catalogue-corrections?status=PENDING',
      'token',
    );
    expect(apiService.patch).toHaveBeenCalledWith(
      '/platform/catalogue-corrections/12',
      { status: 'ACCEPTED' },
      'token',
    );
  });
});
