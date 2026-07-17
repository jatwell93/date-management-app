import { apiService } from '../lib/api.service';
import * as service from '../services/supplierCreditService';

vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  buildApiUrl: vi.fn(),
}));

describe('supplierCreditService policy contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses PATCH for partial supplier edits and retains full PUT replacement', async () => {
    await service.updateSupplier(12, { representativeName: 'Sam' }, 'token');
    await service.replaceSupplier(12, { name: 'Acme' }, 'token');

    expect(apiService.patch).toHaveBeenCalledWith(
      '/supplier-credits/suppliers/12',
      { representativeName: 'Sam' },
      'token',
    );
    expect(apiService.put).toHaveBeenCalledWith(
      '/supplier-credits/suppliers/12',
      { name: 'Acme' },
      'token',
    );
  });

  it('builds policy-review filters and calls clear and bulk endpoints', async () => {
    await service.getPolicyReview('token', {
      brand: 'Nature Plus',
      supplier: 'Sigma',
      status: 'MISSING',
    });
    await service.clearSupplierPolicy(12, 'token');
    await service.bulkAttachPolicy({ supplierId: 12, brandIds: [4, 9] }, 'token');
    await service.bulkLinkProducts({ brandName: 'Nature Plus', productIds: [2, 3] }, 'token');

    expect(apiService.get).toHaveBeenCalledWith(
      '/supplier-credits/policy-review?brand=Nature+Plus&supplier=Sigma&status=MISSING',
      'token',
    );
    expect(apiService.delete).toHaveBeenCalledWith(
      '/supplier-credits/suppliers/12/policy',
      'token',
    );
    expect(apiService.post).toHaveBeenCalledWith(
      '/supplier-credits/policy-review/bulk-attach',
      { supplierId: 12, brandIds: [4, 9] },
      'token',
    );
    expect(apiService.post).toHaveBeenCalledWith(
      '/supplier-credits/brands/bulk-link',
      { brandName: 'Nature Plus', productIds: [2, 3] },
      'token',
    );
  });

  it('builds numbered catalogue title filters and ordering', async () => {
    await service.getBrandReview('token', {
      state: 'NEEDS_BRAND',
      page: 3,
      pageSize: 25,
      title: 'Vitamin C',
      titleMatch: 'startsWith',
      sort: 'titleDesc',
    } as never);

    expect(apiService.get).toHaveBeenCalledWith(
      '/supplier-credits/brand-review?state=NEEDS_BRAND&page=3&pageSize=25&title=Vitamin+C&titleMatch=startsWith&sort=titleDesc',
      'token',
    );
  });
});
