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
import { getOrganizationId, TEST_AUTH_BYPASS_ORG_ID } from '../utils/auth-bypass';

export interface ServiceProviderConfig {
  organizationId?: string;
  prisma?: PrismaClient;
  storageProvider?: StorageProvider;
}

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

  constructor(config: ServiceProviderConfig = {}) {
    this.organizationId = getOrganizationId(config.organizationId);
    this.prisma = config.prisma ?? getDefaultDatabaseClient();
    this.storageProvider = config.storageProvider ?? getDefaultStorageProvider();
    this.db = getDb();
  }

  // Factory methods for common patterns
  static forOrganization(
    organizationId: string,
    config?: Omit<ServiceProviderConfig, 'organizationId'>,
  ): ServiceProvider {
    return new ServiceProvider({ ...config, organizationId });
  }

  static forTesting(config?: ServiceProviderConfig): ServiceProvider {
    return new ServiceProvider({ organizationId: TEST_AUTH_BYPASS_ORG_ID, ...config });
  }

  static withClients(
    prisma: PrismaClient,
    storageProvider?: StorageProvider,
    config?: Omit<ServiceProviderConfig, 'prisma' | 'storageProvider'>,
  ): ServiceProvider {
    return new ServiceProvider({ prisma, storageProvider, ...config });
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
