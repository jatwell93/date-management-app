import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  SupplierCreditService,
  type AddBrandInput,
  type BulkAttachInput,
  type BulkLinkInput,
  type SupplierInput,
} from '../services/supplier-credit.service';
import { AuthenticationError, AuthorizationError } from '../errors';

export function isPlatformAdminUser(
  userId: number | undefined,
  configuration = process.env.PLATFORM_ADMIN_USER_IDS,
): boolean {
  if (userId == null || !configuration) return false;
  const tokens = configuration.split(',').map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => !/^[1-9]\d*$/.test(token))) {
    return false;
  }
  return tokens.map(Number).includes(userId);
}

export class SupplierCreditController {
  constructor(private serviceFactory: (orgId?: string) => SupplierCreditService) {}

  private getService(req: AuthRequest): SupplierCreditService {
    return this.serviceFactory(req.organizationId);
  }

  private getUserId(req: AuthRequest): number {
    const userId = req.userId ?? req.user?.id;
    if (userId == null) throw new AuthenticationError();
    return userId;
  }

  private getRole(req: AuthRequest): string | undefined {
    return req.user?.role ?? req.userRole;
  }

  private requirePlatformAdmin(req: AuthRequest): void {
    if (!isPlatformAdminUser(this.getUserId(req))) {
      throw new AuthorizationError('Platform catalogue review access required');
    }
  }

  async listSuppliers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).listSuppliers());
    } catch (error) {
      next(error);
    }
  }

  async createSupplier(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const supplier = await this.getService(req).createSupplier(
        req.body as SupplierInput,
        this.getRole(req),
      );
      res.status(201).json(supplier);
    } catch (error) {
      next(error);
    }
  }

  async updateSupplier(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      const supplier = await this.getService(req).replaceSupplier(
        id,
        req.body as SupplierInput,
        this.getRole(req),
      );
      res.json(supplier);
    } catch (error) {
      next(error);
    }
  }

  async patchSupplier(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const supplier = await this.getService(req).updateSupplier(
        Number(req.params.id),
        req.body as SupplierInput,
        this.getRole(req),
      );
      res.json(supplier);
    } catch (error) {
      next(error);
    }
  }

  async clearSupplierPolicy(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(
        await this.getService(req).clearSupplierPolicy(Number(req.params.id), this.getRole(req)),
      );
    } catch (error) {
      next(error);
    }
  }

  async listPolicyReview(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(
        await this.getService(req).listPolicyReview({
          brand: typeof req.query.brand === 'string' ? req.query.brand : undefined,
          supplier: typeof req.query.supplier === 'string' ? req.query.supplier : undefined,
          status:
            req.query.status === 'ATTACHED' || req.query.status === 'MISSING'
              ? req.query.status
              : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  async bulkAttachPolicy(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(
        await this.getService(req).bulkAttachPolicy(
          req.body as BulkAttachInput,
          this.getRole(req),
          this.getUserId(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async bulkLinkProducts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(
        await this.getService(req).bulkLinkProducts(req.body as BulkLinkInput, this.getUserId(req)),
      );
    } catch (error) {
      next(error);
    }
  }

  async assignProductSupplier(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = Number(req.params.productId);
      const { supplierId } = req.body as { supplierId: number | null };
      const result = await this.getService(req).assignProductSupplier(
        productId,
        supplierId,
        this.getUserId(req),
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async listBrands(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).listBrands());
    } catch (error) {
      next(error);
    }
  }

  async reviewBrands(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(
        await this.getService(req).reviewBrands({
          state: typeof req.query.state === 'string' ? req.query.state : undefined,
          group: typeof req.query.group === 'string' ? req.query.group : undefined,
          cursor: typeof req.query.cursor === 'string' ? Number(req.query.cursor) : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  async addBrand(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const brand = await this.getService(req).addBrand(
        req.body as AddBrandInput,
        this.getUserId(req),
      );
      res.status(201).json(brand);
    } catch (error) {
      next(error);
    }
  }

  async confirmBrandSupplier(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const brand = await this.getService(req).confirmBrandSupplier(
        Number(req.params.id),
        (req.body as { supplierId: number }).supplierId,
      );
      res.json(brand);
    } catch (error) {
      next(error);
    }
  }

  async disposeWriteOff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).disposeWriteOff(Number(req.params.transactionId)));
    } catch (error) {
      next(error);
    }
  }

  async listCatalogueCorrections(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.requirePlatformAdmin(req);
      res.json(
        await this.getService(req).listCatalogueCorrections({
          status: typeof req.query.status === 'string' ? req.query.status : 'PENDING',
          cursor: typeof req.query.cursor === 'string' ? Number(req.query.cursor) : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  async reviewCatalogueCorrection(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.requirePlatformAdmin(req);
      res.json(
        await this.getService(req).reviewCatalogueCorrection(
          Number(req.params.id),
          (req.body as { status: 'ACCEPTED' | 'REJECTED' }).status,
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async getClaimablePool(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).getClaimablePool());
    } catch (error) {
      next(error);
    }
  }
}

export function createSupplierCreditController(): SupplierCreditController {
  return new SupplierCreditController(
    (organizationId?: string) => new SupplierCreditService(organizationId),
  );
}
