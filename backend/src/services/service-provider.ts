import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getDefaultStorageProvider } from '../storage/storage-factory';
import { StorageProvider } from '../storage/storage-provider.interface';
import { getDb } from '../database';
import Database from 'better-sqlite3';
import { AnalyticsService } from './analytics.service';
import { ReportService } from './report.service';
import { AuthService } from './auth.service';
import { CSVParserService } from './csv-parser.service';
import { StorageQuotaService } from './storage-quota.service';
import { UploadService } from './upload.service';
import { UserService } from './user.service';

export class ServiceProvider {
  private prisma: PrismaClient;
  private storageProvider: StorageProvider;
  private db: DB;
  private authService?: AuthService;
  private userService?: UserService;
  private csvParserService?: CSVParserService;
  private storageQuotaService?: StorageQuotaService;
  private uploadService?: UploadService;
  private analyticsService?: AnalyticsService;
  private reportService?: ReportService;

  constructor(prismaClient?: PrismaClient, storageProvider?: StorageProvider) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.storageProvider = storageProvider ?? getDefaultStorageProvider();
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
      this.userService = new UserService(this.prisma, this.getAuthService());
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
      this.storageQuotaService = new StorageQuotaService();
    }
    return this.storageQuotaService;
  }

  getUploadService(): UploadService {
    if (!this.uploadService) {
      this.uploadService = new UploadService(
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
}
