import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { SupplierCreditService, type SupplierInput } from '../services/supplier-credit.service';

export class SupplierCreditController {
  constructor(private serviceFactory: (orgId?: string) => SupplierCreditService) {}

  private getService(req: AuthRequest): SupplierCreditService {
    return this.serviceFactory(req.organizationId);
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
      const supplier = await this.getService(req).createSupplier(req.body as SupplierInput);
      res.status(201).json(supplier);
    } catch (error) {
      next(error);
    }
  }

  async updateSupplier(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      const supplier = await this.getService(req).updateSupplier(id, req.body as SupplierInput);
      res.json(supplier);
    } catch (error) {
      next(error);
    }
  }

  async assignProductSupplier(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = Number(req.params.productId);
      const { supplierId } = req.body as { supplierId: number | null };
      const result = await this.getService(req).assignProductSupplier(productId, supplierId);
      res.json(result);
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
