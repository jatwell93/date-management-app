import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getDefaultStorageProvider } from '../storage/storage-factory';
import { StorageProvider } from '../storage/storage-provider.interface';
import { getDb, type DB } from '../database';
import { AnalyticsService } from './analytics.service';
import { ReportService } from './report.service';
import { AuthService } from './auth.service';
import { CSVParserService } from './csv-parser.service';
import { StorageQuotaService } from './storage-quota.service';
import { UploadService } from './upload.service';
import { UserService } from './user.service';
import { SubscriptionService } from './subscription.service';
import { TEST_AUTH_BYPASS_ORG_ID } from '../middleware/auth.middleware';

export class ServiceProvider {
  private prisma: PrismaClient;
  private storageProvider: StorageProvider;
  private db: DB;
  private organizationId: string;
  private authService?: AuthService;
  private userService?: UserService;
  private csvParserService?: CSVParserService;
  private storageQuotaService?: StorageQuotaService;
  private uploadService?: UploadService;
  private analyticsService?: AnalyticsService;
  private reportService?: ReportService;
  private subscriptionService?: SubscriptionService;

  constructor(
    organizationIdOrPrisma?: string | PrismaClient,
    prismaOrStorageProvider?: PrismaClient | StorageProvider,
    storageProviderArg?: StorageProvider,
  ) {
    if (typeof organizationIdOrPrisma === 'string') {
      this.organizationId = organizationIdOrPrisma;
      this.prisma =
        (prismaOrStorageProvider as PrismaClient | undefined) ?? getDefaultDatabaseClient();
      this.storageProvider = storageProviderArg ?? getDefaultStorageProvider();
    } else {
      this.organizationId = TEST_AUTH_BYPASS_ORG_ID;
      this.prisma = organizationIdOrPrisma ?? getDefaultDatabaseClient();
      this.storageProvider =
        (prismaOrStorageProvider as StorageProvider | undefined) ?? getDefaultStorageProvider();
    }
    this.db = getDb();
  }

  getAuthService(): AuthService {
    if (!this.authService) {
      this.authService = new AuthService(this.prisma);
    }
    return this.authService;
  }

  getUserService(): UserService {
    if (!this.userService) {
      this.userService = new UserService(this.organizationId, this.prisma, this.getAuthService());
    }
    return this.userService;
  }

  getCSVParserService(): CSVParserService {
    if (!this.csvParserService) {
      this.csvParserService = new CSVParserService(this.prisma);
    }
    return this.csvParserService;
  }

  getStorageQuotaService(): StorageQuotaService {
    if (!this.storageQuotaService) {
      this.storageQuotaService = new StorageQuotaService(this.organizationId);
    }
    return this.storageQuotaService;
  }

  getUploadService(): UploadService {
    if (!this.uploadService) {
      this.uploadService = new UploadService(
        this.organizationId,
        this.storageProvider,
        this.getCSVParserService(),
        this.getStorageQuotaService(),
      );
    }
    return this.uploadService;
  }

  getAnalyticsService(): AnalyticsService {
    if (!this.analyticsService) {
      this.analyticsService = new AnalyticsService(this.db);
    }
    return this.analyticsService;
  }

  getReportService(): ReportService {
    if (!this.reportService) {
      this.reportService = new ReportService(this.db);
    }
    return this.reportService;
  }

  getSubscriptionService(): SubscriptionService {
    if (!this.subscriptionService) {
      this.subscriptionService = new SubscriptionService(this.prisma);
    }
    return this.subscriptionService;
  }
}
