# Graph Report - date-management-app (2026-05-03)

## Corpus Check

- 553 files · ~1,534,981 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 2003 nodes · 2923 edges · 79 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 167 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)

- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 119|Community 119]]

## God Nodes (most connected - your core abstractions)

1. `getDefaultDatabaseClient()` - 78 edges
2. `fetch()` - 50 edges
3. `Logger` - 46 edges
4. `jsonResponse()` - 45 edges
5. `authenticateApiRequest()` - 36 edges
6. `errorResponse()` - 33 edges
7. `OfflineSyncService` - 32 edges
8. `WebhookService` - 31 edges
9. `getDb()` - 27 edges
10. `InventoryService` - 27 edges

## Surprising Connections (you probably didn't know these)

- `checkFeature()` --calls--> `getDefaultDatabaseClient()` [INFERRED]
  backend\src\middleware\feature-gate.middleware.ts → backend\src\database\database-factory.ts
- `createRouter()` --calls--> `createUploadRoleMiddleware()` [INFERRED]
  workers\src\index.ts → workers\src\middleware\require-role.middleware.ts
- `createItemTransaction()` --calls--> `getDb()` [INFERRED]
  backend\src\models\item-transaction.model.ts → backend\src\database.ts
- `createWorkersDatabase()` --calls--> `createDatabaseClient()` [INFERRED]
  workers\src\index.ts → backend\src\database\database-factory.ts
- `initializeDiContainer()` --calls--> `getDefaultDatabaseClient()` [INFERRED]
  backend\src\di\container.ts → backend\src\database\database-factory.ts

## Communities

### Community 0 - "Community 0"

Cohesion: 0.02
Nodes (76): ManageSubscriptionButton(), MarkdownCalculator(), fetchData(), TrialBanner(), fetchTrialStatus(), handleUpgrade(), ApiService, buildApiUrl() (+68 more)

### Community 1 - "Community 1"

Cohesion: 0.02
Nodes (37): UploadController, createDatabaseClient(), detectEnvironment(), disconnectDatabase(), getDatabaseProvider(), getDatabaseUrl(), getDefaultDatabaseClient(), getLogOptions() (+29 more)

### Community 2 - "Community 2"

Cohesion: 0.06
Nodes (89): createWorkersDatabase(), appendVaryHeader(), applyRateLimitHeaders(), authenticateApiRequest(), authenticateClerkRequest(), authenticateRequest(), canManageUsers(), checkRateLimit() (+81 more)

### Community 3 - "Community 3"

Cohesion: 0.03
Nodes (16): resolveUnlimitedLimit(), InventoryController, DailyReportEmailJob, startDunningJob(), extractTierFromStripeSubscription(), normalizeStatus(), runStripeSyncJob(), startStripeSyncJob() (+8 more)

### Community 4 - "Community 4"

Cohesion: 0.03
Nodes (39): addUserIdHeader(), authenticateRequest(), createAuthMiddleware(), createJWT(), extractToken(), getPublicEndpoints(), isPublicEndpoint(), unauthorized() (+31 more)

### Community 5 - "Community 5"

Cohesion: 0.04
Nodes (18): ClerkSignInPage(), ClerkSignUpPage(), ClerkAuthProvider(), useAuthContext(), HandheldScanToolbar(), HandheldProvider(), useHandheldDetectionContext(), useHandheldDetection() (+10 more)

### Community 6 - "Community 6"

Cohesion: 0.04
Nodes (24): canUpload(), hasEqualOrHigherRole(), hasPermission(), isValidRole(), normalizeRole(), getDiContainer(), initializeDiContainer(), createInventoryController() (+16 more)

### Community 7 - "Community 7"

Cohesion: 0.07
Nodes (11): validateDataConsistency(), validateReferentialIntegrity(), UpdateMarkdownStatusesMigration, createItemTransaction(), DashboardService, DatabaseMonitoringService, ExpiredItemService, SchedulerService (+3 more)

### Community 8 - "Community 8"

Cohesion: 0.07
Nodes (17): ProductController, AuthenticationError, AuthorizationError, BaseError, ConflictError, InternalError, isBaseError(), NotFoundError (+9 more)

### Community 9 - "Community 9"

Cohesion: 0.06
Nodes (9): MockStorageProvider, TestStorageProvider, ServiceProvider, createStorageProvider(), detectEnvironment(), getDefaultLocalPath(), getDefaultStorageProvider(), getStorageProviderType() (+1 more)

### Community 10 - "Community 10"

Cohesion: 0.09
Nodes (3): invalidateSubscriptionCache(), dispatchStripeWebhookEvent(), WebhookService

### Community 11 - "Community 11"

Cohesion: 0.11
Nodes (14): detectProductImportFileType(), findColumnByAlternatives(), findColumnIndexByAlternatives(), getAllowedProductImportHeadersFromCsvState(), getAllowedProductImportHeadersFromXlsxState(), getAllowedProductImportHeaderValues(), getProductImportCsvColumnState(), getProductImportCsvRowValues() (+6 more)

### Community 12 - "Community 12"

Cohesion: 0.11
Nodes (15): getDashboardData(), countProducts(), createProduct(), deleteProduct(), getProductByBarcode(), getProductById(), getProducts(), countStoreAreas() (+7 more)

### Community 13 - "Community 13"

Cohesion: 0.07
Nodes (2): PrismaAnalyticsAdapter, SQLiteAnalyticsAdapter

### Community 14 - "Community 14"

Cohesion: 0.11
Nodes (5): CSVParserService, isValidDateParts(), normalizeYear(), parseExpiryImportDate(), toIsoDate()

### Community 15 - "Community 15"

Cohesion: 0.12
Nodes (24): authenticateToken(), extractTokenFromRequest(), getAuthorizedParties(), getTierVersion(), handleAuthError(), hasRequiredTokenFields(), isBillingCycle(), isTierLevel() (+16 more)

### Community 16 - "Community 16"

Cohesion: 0.12
Nodes (6): hasActiveStripeAccessWindow(), getPriceIdForTier(), mapStripeSubscriptionStatusToLocal(), getErrorMessage(), SubscriptionService, buildTrialSubscriptionSetup()

### Community 17 - "Community 17"

Cohesion: 0.12
Nodes (1): InventoryService

### Community 18 - "Community 18"

Cohesion: 0.16
Nodes (2): SaasMetricsService, validateAlertThresholds()

### Community 19 - "Community 19"

Cohesion: 0.24
Nodes (15): countSourceRows(), createSqliteTable(), ensureDirFor(), fetchTableRows(), getTimestamp(), insertRows(), listColumns(), listPrimaryKeyColumns() (+7 more)

### Community 20 - "Community 20"

Cohesion: 0.16
Nodes (1): ApplicationMonitoringService

### Community 21 - "Community 21"

Cohesion: 0.19
Nodes (7): SubscriptionController, getStripeClient(), isStripeConfigured(), resetStripeClient(), validateStripeConfig(), validateRedirectUrl(), validateStripePriceId()

### Community 22 - "Community 22"

Cohesion: 0.15
Nodes (1): AnalyticsService

### Community 23 - "Community 23"

Cohesion: 0.42
Nodes (13): addSearchBox(), addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns() (+5 more)

### Community 24 - "Community 24"

Cohesion: 0.22
Nodes (1): ClerkWebhookService

### Community 25 - "Community 25"

Cohesion: 0.36
Nodes (13): addSearchBox(), addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns() (+5 more)

### Community 26 - "Community 26"

Cohesion: 0.13
Nodes (1): ReportService

### Community 27 - "Community 27"

Cohesion: 0.14
Nodes (3): CameraScanner(), useHardwareScan(), triggerHaptic()

### Community 28 - "Community 28"

Cohesion: 0.14
Nodes (1): ReportRepository

### Community 29 - "Community 29"

Cohesion: 0.16
Nodes (1): AuthService

### Community 30 - "Community 30"

Cohesion: 0.5
Nodes (10): a(), B(), c(), D(), g(), i(), k(), o() (+2 more)

### Community 31 - "Community 31"

Cohesion: 0.19
Nodes (2): DailyMetricsJob, HourlyWebhookCheckJob

### Community 32 - "Community 32"

Cohesion: 0.44
Nodes (10): a(), B(), c(), D(), g(), i(), k(), o() (+2 more)

### Community 33 - "Community 33"

Cohesion: 0.29
Nodes (1): ProductRepository

### Community 34 - "Community 34"

Cohesion: 0.32
Nodes (8): authenticateWorkerRequest(), extractJWTFromHeader(), extractOrganizationId(), isSubscriptionStatus(), isTierLevel(), querySubscriptionTier(), validateOrganizationStatus(), verifyJWT()

### Community 35 - "Community 35"

Cohesion: 0.51
Nodes (10): checkOrganizationWebhooks(), checkRecentWebhookHealth(), checkWebhookEvent(), formatDate(), logSection(), logStatus(), logSubsection(), parseArguments() (+2 more)

### Community 36 - "Community 36"

Cohesion: 0.35
Nodes (8): fail(), normalizeNodeEnv(), parseNumber(), resolveCorsOrigin(), resolveFrontendUrl(), resolveJwtSecret(), setWorkerConfig(), validateEnvironment()

### Community 37 - "Community 37"

Cohesion: 0.33
Nodes (10): detectCrossTenantAccess(), extractOrganizationIdFromRequest(), getFromBody(), getFromParams(), getFromQuery(), handleCrossTenantViolation(), handleTenantAccessViolation(), isAccessAllowed() (+2 more)

### Community 38 - "Community 38"

Cohesion: 0.18
Nodes (1): StoreAreaModel

### Community 39 - "Community 39"

Cohesion: 0.18
Nodes (1): InventoryRepository

### Community 40 - "Community 40"

Cohesion: 0.29
Nodes (1): LocalStorageProvider

### Community 41 - "Community 41"

Cohesion: 0.2
Nodes (2): assertSupportedDatabaseUrl(), isCiRuntime()

### Community 42 - "Community 42"

Cohesion: 0.2
Nodes (1): InventoryItemModel

### Community 43 - "Community 43"

Cohesion: 0.38
Nodes (1): SubscriptionRepository

### Community 44 - "Community 44"

Cohesion: 0.22
Nodes (1): R2StorageProvider

### Community 46 - "Community 46"

Cohesion: 0.36
Nodes (5): globalSetup(), enterOtpCode(), signInAsManager(), signUpAsManager(), getOtpFromMailinator()

### Community 47 - "Community 47"

Cohesion: 0.56
Nodes (8): error(), exec(), info(), log(), main(), step(), success(), warn()

### Community 48 - "Community 48"

Cohesion: 0.31
Nodes (1): UploadService

### Community 49 - "Community 49"

Cohesion: 0.22
Nodes (1): InMemoryStorageProvider

### Community 51 - "Community 51"

Cohesion: 0.25
Nodes (1): InMemoryStorageProvider

### Community 52 - "Community 52"

Cohesion: 0.25
Nodes (2): ErrorBoundary, renderWarning()

### Community 53 - "Community 53"

Cohesion: 0.5
Nodes (7): countInventoryItems(), createInventoryItem(), deleteInventoryItem(), getConnectionString(), getExpiringItems(), getInventoryItemById(), getInventoryItems()

### Community 54 - "Community 54"

Cohesion: 0.43
Nodes (6): checkFeatureAccess(), checkUsageLimit(), enforceUsageLimit(), formatFeatureUpgradeCTA(), formatUsageLimitCTA(), requireFeatureAccess()

### Community 55 - "Community 55"

Cohesion: 0.71
Nodes (4): goToNext(), goToPrevious(), makeCurrent(), toggleClass()

### Community 56 - "Community 56"

Cohesion: 0.38
Nodes (3): isClerkWebhookEventPayload(), isNonRecoverableStripeWebhookError(), WebhookController

### Community 57 - "Community 57"

Cohesion: 0.29
Nodes (1): AnalyticsRepository

### Community 58 - "Community 58"

Cohesion: 0.29
Nodes (3): FileNotFoundError, FileSizeLimitError, StorageProviderError

### Community 59 - "Community 59"

Cohesion: 0.43
Nodes (5): createMockMiddleware(), createSubscriptions(), seedFeatureFlags(), setupTestApp(), setupTestData()

### Community 61 - "Community 61"

Cohesion: 0.29
Nodes (3): GS1ParseError, HandheldError, HardwareScanError

### Community 62 - "Community 62"

Cohesion: 0.73
Nodes (4): goToNext(), goToPrevious(), makeCurrent(), toggleClass()

### Community 63 - "Community 63"

Cohesion: 0.6
Nodes (5): analyzeMemoryGrowth(), generateTestCSV(), getMemorySnapshot(), main(), processCSVWithMemoryTracking()

### Community 64 - "Community 64"

Cohesion: 0.33
Nodes (1): MockPointerEvent

### Community 65 - "Community 65"

Cohesion: 0.53
Nodes (4): displayResults(), ensureMemvidAvailable(), retrieveContext(), runMemvid()

### Community 66 - "Community 66"

Cohesion: 0.7
Nodes (4): main(), question(), seedTierFlags(), verifyMigration()

### Community 67 - "Community 67"

Cohesion: 0.4
Nodes (1): AuditLogModel

### Community 68 - "Community 68"

Cohesion: 0.6
Nodes (4): escapeHtml(), escapeHtmlString(), extractCostValueEnhanced(), normalizeNumericString()

### Community 69 - "Community 69"

Cohesion: 0.5
Nodes (2): register(), registerValidSW()

### Community 70 - "Community 70"

Cohesion: 0.5
Nodes (1): ClerkWebhookSignatureService

### Community 71 - "Community 71"

Cohesion: 0.5
Nodes (1): StripeWebhookSignatureService

### Community 73 - "Community 73"

Cohesion: 0.83
Nodes (3): retryWithBackoff(), withApiRetry(), withDatabaseRetry()

### Community 76 - "Community 76"

Cohesion: 0.83
Nodes (3): ensureMemvidAvailable(), escapeForShell(), logMemory()

### Community 78 - "Community 78"

Cohesion: 1.0
Nodes (2): auditOrganizationIds(), main()

### Community 79 - "Community 79"

Cohesion: 1.0
Nodes (2): backfillRoles(), normalizeRole()

### Community 80 - "Community 80"

Cohesion: 1.0
Nodes (2): main(), question()

### Community 81 - "Community 81"

Cohesion: 1.0
Nodes (2): main(), question()

### Community 82 - "Community 82"

Cohesion: 1.0
Nodes (2): printSummary(), runTests()

### Community 83 - "Community 83"

Cohesion: 0.67
Nodes (1): generateSKU()

### Community 87 - "Community 87"

Cohesion: 1.0
Nodes (2): generate(), htmlSnippet()

### Community 119 - "Community 119"

Cohesion: 1.0
Nodes (1): Database

## Knowledge Gaps

- **1 isolated node(s):** `Database`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 13`** (32 nodes): `PrismaAnalyticsAdapter`, `.cleanupOldData()`, `.constructor()`, `.endSession()`, `.getActiveUserCount()`, `.getEventCountByType()`, `.getMetrics()`, `.initialize()`, `.isAvailable()`, `.logPendingModels()`, `.startSession()`, `.storeEventsBatch()`, `.updateSession()`, `SQLiteAnalyticsAdapter`, `.cleanupOldData()`, `.constructor()`, `.endSession()`, `.getActiveUserCount()`, `.getEventCountByType()`, `.getMetrics()`, `.initialize()`, `.isAvailable()`, `.startSession()`, `.storeEventsBatch()`, `.updateSession()`, `PrismaAnalyticsAdapter.ts`, `SQLiteAnalyticsAdapter.ts`, `index.ts`, `analytics-adapter.test.ts`, `isFrontendIndexAvailable()`, `shutdown()`, `startServer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (26 nodes): `InventoryService`, `.autoCalculateMarkdownStatus()`, `.bulkUpdateMarkdownStatuses()`, `.calculateMarkdownPrice()`, `.calculateMarkdownStatus()`, `.calculateMarkdownStatusInternal()`, `.calculateMarkdownStatusSync()`, `.createAuditLogBase()`, `.createAuditLogInTransaction()`, `.createInventoryItem()`, `.decrementInventoryCount()`, `.deleteInventoryItem()`, `.formatChangeDescription()`, `.getAllInventoryItems()`, `.getInventoryItemById()`, `.getInventoryItemsByLocationId()`, `.getInventoryItemsByProductId()`, `.getRecentInventoryItemsByProductId()`, `.handlePrismaError()`, `.logTransaction()`, `.logTransactionInternal()`, `.mapPrismaToModel()`, `.updateInventoryItem()`, `.validateLocationOwnership()`, `.validateProductOwnership()`, `.validateResourceOwnership()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (19 nodes): `saas-metrics.service.ts`, `SaasMetricsService`, `.calculateAvgRevenuePerUser()`, `.calculateChurnRate()`, `.calculatePaymentFailureRate()`, `.calculateTrialConversionRate()`, `.calculateWebhookFailureRate()`, `.checkAlerts()`, `.constructor()`, `.getDailyWebhookErrorCount()`, `.getProcessedWebhookEventGrowthRate()`, `.getSaasMetrics()`, `.getTierDistribution()`, `.recordWebhookMetrics()`, `.sendAlert()`, `.storeDailyMetrics()`, `subscription.js`, `subscription.ts`, `validateAlertThresholds()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (18 nodes): `application.monitoring.service.ts`, `ApplicationMonitoringService`, `.checkForAlerts()`, `.collectMetrics()`, `.constructor()`, `.emitAlert()`, `.getInstance()`, `.getMetrics()`, `.getSaasMetrics()`, `.getWebhookMetrics()`, `.initialize()`, `.recordRequest()`, `.recordWebhookEvent()`, `.requestTrackingMiddleware()`, `.startMonitoring()`, `.stopMonitoring()`, `.storeDailyMetrics()`, `.trackUserJourney()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (17 nodes): `analytics.service.ts`, `AnalyticsService`, `.cleanOldData()`, `.constructor()`, `.endSession()`, `.exportData()`, `.generateSessionId()`, `.getEventCountByType()`, `.getInstance()`, `.getMetrics()`, `.initialize()`, `.processEventQueue()`, `.resetInstance()`, `.startBatchProcessing()`, `.startSession()`, `.stopBatchProcessing()`, `.trackEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (16 nodes): `ClerkWebhookService`, `.constructor()`, `.createDefaultOrganization()`, `.ensureTrialSubscription()`, `.findOrCreateOrganization()`, `.handleEvent()`, `.handleOrganizationCreated()`, `.handleOrganizationMembershipCreated()`, `.handleOrganizationMembershipDeleted()`, `.handleUserCreated()`, `.handleUserUpdated()`, `.isNewEvent()`, `.markEventProcessed()`, `.sendError()`, `.sendSuccess()`, `.verifySignature()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (15 nodes): `report.service.ts`, `ReportService`, `.constructor()`, `.getDailyUsageReport()`, `.getDashboardAnalytics()`, `.getDetailedExpiryReport()`, `.getItemsByDateReport()`, `.getItemsByUserReport()`, `.getLossByDepartmentReport()`, `.getLossBySkuReport()`, `.getMonthlyExpiryReport()`, `.getMonthlyMarkdownReport()`, `.getOverallExpiryReport()`, `.getUsageReport()`, `.updateAllMarkdownStatuses()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (14 nodes): `report.repository.ts`, `ReportRepository`, `.constructor()`, `.getDailyUsageReport()`, `.getDashboardAnalytics()`, `.getDetailedExpiryReport()`, `.getItemsByDateReport()`, `.getItemsByUserReport()`, `.getLossByDepartmentReport()`, `.getLossBySkuReport()`, `.getMonthlyExpiryReport()`, `.getMonthlyMarkdownReport()`, `.getOverallExpiryReport()`, `.getUsageReport()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (14 nodes): `auth.service.ts`, `AuthService`, `.cleanupExpiredTokens()`, `.constructor()`, `.generateTokens()`, `.hashPin()`, `.isPredictablePattern()`, `.isSequential()`, `.login()`, `.refreshAccessToken()`, `.revokeRefreshToken()`, `.validatePin()`, `.verifyPin()`, `.verifyToken()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (13 nodes): `daily-metrics.job.ts`, `DailyMetricsJob`, `.acquireLock()`, `.constructor()`, `.cronExpression()`, `.execute()`, `.getJobConfig()`, `.releaseLock()`, `HourlyWebhookCheckJob`, `.constructor()`, `.cronExpression()`, `.execute()`, `.getJobConfig()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (12 nodes): `product.repository.ts`, `ProductRepository`, `.constructor()`, `.countByOrganization()`, `.create()`, `.delete()`, `.findAll()`, `.findByBarcode()`, `.findById()`, `.findBySku()`, `.getClient()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (11 nodes): `store-area.model.ts`, `StoreAreaModel`, `.constructor()`, `.create()`, `.createTable()`, `.delete()`, `.findAll()`, `.findById()`, `.findByName()`, `.findByNameAndSubDepartment()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (11 nodes): `inventory.repository.ts`, `InventoryRepository`, `.constructor()`, `.create()`, `.delete()`, `.findAll()`, `.findById()`, `.findByLocationId()`, `.findByProductId()`, `.findRecentByProductId()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (11 nodes): `local-storage.provider.ts`, `LocalStorageProvider`, `.constructor()`, `.delete()`, `.download()`, `.ensureDirectory()`, `.exists()`, `.getFullPath()`, `.getMetadata()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (11 nodes): `setup-after-env.ts`, `assertSupportedDatabaseUrl()`, `cleanupAllTablesForPostgres()`, `cleanupTablesForSqlite()`, `cleanupTierFlagsForPostgres()`, `cleanupTierFlagsForSqlite()`, `isCiRuntime()`, `isPostgresRuntime()`, `isUnitTestSuite()`, `seedDefaultOrganizationAndUsers()`, `stopBackgroundServices()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (10 nodes): `inventory-item.model.ts`, `InventoryItemModel`, `.constructor()`, `.create()`, `.createTable()`, `.delete()`, `.findById()`, `.findByLocationId()`, `.findByProductId()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (10 nodes): `subscription.repository.ts`, `SubscriptionRepository`, `.constructor()`, `.create()`, `.createUsage()`, `.findByOrganizationId()`, `.findUsageByOrganizationId()`, `.getClient()`, `.update()`, `.updateUsage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (10 nodes): `r2-storage.provider.ts`, `R2StorageProvider`, `.constructor()`, `.delete()`, `.download()`, `.exists()`, `.getMetadata()`, `.getPresignedDownloadUrl()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (9 nodes): `upload.service.ts`, `UploadService`, `.assertOrganizationScopedKey()`, `.buildExpiryRejectedRows()`, `.completeUpload()`, `.constructor()`, `.deleteUpload()`, `.handleDirectUpload()`, `.initiateUpload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (9 nodes): `upload-flow.test.ts`, `createTestApp()`, `getEnvConfig()`, `InMemoryStorageProvider`, `.delete()`, `.download()`, `.exists()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (8 nodes): `upload-load.test.ts`, `createTestApp()`, `InMemoryStorageProvider`, `.delete()`, `.download()`, `.exists()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (8 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `ErrorBoundary.tsx`, `StorageQuotaWarning.test.tsx`, `renderWarning()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (7 nodes): `analytics.repository.ts`, `AnalyticsRepository`, `.constructor()`, `.createMetricsSnapshot()`, `.createWebhookMetrics()`, `.findLatestMetricsSnapshot()`, `.findWebhookMetricsByDateRange()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (6 nodes): `setupTests.ts`, `disconnect()`, `MockPointerEvent`, `.constructor()`, `observe()`, `unobserve()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (5 nodes): `audit-log.model.ts`, `AuditLogModel`, `.constructor()`, `.createTable()`, `.logChange()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (5 nodes): `serviceWorkerRegistration.ts`, `checkValidServiceWorker()`, `register()`, `registerValidSW()`, `unregister()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (4 nodes): `clerk-webhook-signature.service.ts`, `ClerkWebhookSignatureService`, `.constructor()`, `.verifySignature()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (4 nodes): `stripe-webhook-signature.service.ts`, `StripeWebhookSignatureService`, `.constructor()`, `.verifySignature()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (3 nodes): `audit-org-ids.ts`, `auditOrganizationIds()`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (3 nodes): `backfill-canonical-roles.js`, `backfillRoles()`, `normalizeRole()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (3 nodes): `migrate-production-doppler.js`, `main()`, `question()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (3 nodes): `migrate-production-simple.js`, `main()`, `question()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `test-r2-connection.ts`, `printSummary()`, `runTests()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (3 nodes): `multi-tenant-concurrency-load.test.ts`, `sku-generator.ts`, `generateSKU()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (3 nodes): `generate-favicons.ts`, `generate()`, `htmlSnippet()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (2 nodes): `shims-better-sqlite3.d.ts`, `Database`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `getDefaultDatabaseClient()` connect `Community 1` to `Community 3`, `Community 6`, `Community 8`, `Community 9`, `Community 10`, `Community 14`, `Community 15`, `Community 16`, `Community 48`, `Community 18`, `Community 21`, `Community 24`, `Community 59`, `Community 29`, `Community 31`?**
  _High betweenness centrality (0.232) - this node is a cross-community bridge._
- **Why does `Logger` connect `Community 3` to `Community 1`, `Community 37`, `Community 6`, `Community 7`, `Community 8`, `Community 13`, `Community 14`, `Community 16`, `Community 48`, `Community 18`, `Community 20`, `Community 22`, `Community 29`, `Community 31`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `normalizeRole()` connect `Community 6` to `Community 1`, `Community 4`, `Community 5`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Are the 29 inferred relationships involving `getDefaultDatabaseClient()` (e.g. with `.exportExcess()` and `.status()`) actually correct?**
  _`getDefaultDatabaseClient()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Database` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
