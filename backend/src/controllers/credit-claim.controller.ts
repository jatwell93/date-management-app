import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ValidationError } from '../errors';
import {
  CreditClaimService,
  type BuildClaimInput,
  type ClaimOutcome,
} from '../services/credit-claim.service';

const OPEN_STATUSES = ['DRAFT', 'SENT', 'ACKNOWLEDGED'];
const SETTLED_STATUSES = ['CREDITED', 'PARTIALLY_CREDITED', 'REJECTED', 'CANCELLED'];

export class CreditClaimController {
  constructor(private serviceFactory: (orgId?: string) => CreditClaimService) {}

  private getService(req: AuthRequest): CreditClaimService {
    return this.serviceFactory(req.organizationId);
  }

  async listClaims(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const view = req.query.view;
      const statuses =
        view === 'open' ? OPEN_STATUSES : view === 'settled' ? SETTLED_STATUSES : undefined;
      res.json(await this.getService(req).listClaims(statuses));
    } catch (error) {
      next(error);
    }
  }

  async getClaim(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).getClaim(Number(req.params.id)));
    } catch (error) {
      next(error);
    }
  }

  async buildClaim(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as BuildClaimInput;
      const claim = await this.getService(req).buildClaim(input, req.userId ?? null);
      res.status(201).json(claim);
    } catch (error) {
      next(error);
    }
  }

  async addPhoto(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) {
        throw new ValidationError('A photo file is required.');
      }
      const { originalname, mimetype, buffer } = req.file;
      const photo = await this.getService(req).addPhoto(
        Number(req.params.id),
        Number(req.params.lineId),
        { buffer, originalName: originalname, contentType: mimetype },
      );
      res.status(201).json(photo);
    } catch (error) {
      next(error);
    }
  }

  async sendClaim(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).sendClaim(Number(req.params.id)));
    } catch (error) {
      next(error);
    }
  }

  async sendFollowUp(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).sendFollowUp(Number(req.params.id)));
    } catch (error) {
      next(error);
    }
  }

  async getRecoveryReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await this.getService(req).getRecoveryReport());
    } catch (error) {
      next(error);
    }
  }

  async recordOutcome(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { outcome, creditedValue, note } = req.body as {
        outcome: ClaimOutcome;
        creditedValue?: number | null;
        note?: string | null;
      };
      const claim = await this.getService(req).recordOutcome(
        Number(req.params.id),
        outcome,
        creditedValue ?? null,
        note ?? null,
      );
      res.json(claim);
    } catch (error) {
      next(error);
    }
  }
}

export function createCreditClaimController(): CreditClaimController {
  return new CreditClaimController(
    (organizationId?: string) => new CreditClaimService(organizationId),
  );
}
