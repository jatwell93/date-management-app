# Graph Report - date-management-app  (2026-05-19)

## Corpus Check
- 614 files · ~1,516,942 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2430 nodes · 3582 edges · 97 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 204 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 136|Community 136]]

## God Nodes (most connected - your core abstractions)
1. `getDefaultDatabaseClient()` - 78 edges
2. `Logger` - 65 edges
3. `fetch()` - 50 edges
4. `jsonResponse()` - 45 edges
5. `authenticateApiRequest()` - 36 edges
6. `errorResponse()` - 33 edges
7. `WebhookService` - 32 edges
8. `OfflineSyncService` - 32 edges
9. `getDb()` - 28 edges
10. `InventoryService` - 27 edges

## Surprising Connections (you probably didn't know these)
- `authenticateTokenHandler()` --calls--> `authenticateToken()`  [INFERRED]
  backend\src\routes\org-bootstrap.routes.ts → backend\src\middleware\auth.middleware.ts
- `createRouter()` --calls--> `createUploadRoleMiddleware()`  [INFERRED]
  workers\src\index.ts → workers\src\middleware\require-role.middleware.ts
- `createItemTransaction()` --calls--> `getDb()`  [INFERRED]
  backend\src\models\item-transaction.model.ts → backend\src\database.ts
- `createWorkersDatabase()` --calls--> `createDatabaseClient()`  [INFERRED]
  workers\src\index.ts → backend\src\database\database-factory.ts
- `initializeDiContainer()` --calls--> `getDefaultDatabaseClient()`  [INFERRED]
  backend\src\di\container.ts → backend\src\database\database-factory.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (81): ManageSubscriptionButton(), MarkdownCalculator(), fetchData(), TrialBanner(), fetchTrialStatus(), handleUpgrade(), ApiService, buildApiUrl() (+73 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (36): createDatabaseClient(), detectEnvironment(), disconnectDatabase(), getDatabaseProvider(), getDatabaseUrl(), getDefaultDatabaseClient(), getLogOptions(), resetDefaultDatabaseClient() (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (19): PrismaAnalyticsAdapter, SQLiteAnalyticsAdapter, InventoryController, isClerkWebhookEventPayload(), isNonRecoverableStripeWebhookError(), sendWebhookError(), sendWebhookSuccess(), WebhookController (+11 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (92): createWorkersDatabase(), getCorsHeaders(), handleHealthCheck(), healthCheck(), appendVaryHeader(), applyRateLimitHeaders(), authenticateApiRequest(), authenticateClerkRequest() (+84 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (17): ClerkSignInPage(), ClerkSignUpPage(), ClerkAuthProvider(), useAuthContext(), HandheldScanToolbar(), HandheldProvider(), useHandheldDetectionContext(), useHandheldDetection() (+9 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (39): resolveUnlimitedLimit(), AdminMetricsController, getDiContainer(), initializeDiContainer(), resetDiContainer(), createInventoryController(), createProductController(), createStorageQuotaController() (+31 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (36): addUserIdHeader(), authenticateRequest(), createAuthMiddleware(), createJWT(), extractToken(), getPublicEndpoints(), isPublicEndpoint(), unauthorized() (+28 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (21): getErrorMessage(), HealthController, validateDataConsistency(), validateReferentialIntegrity(), UpdateMarkdownStatusesMigration, createItemTransaction(), initializeTierFlagValidation(), revalidateTierFlags() (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (25): canUpload(), hasEqualOrHigherRole(), hasPermission(), isValidRole(), normalizeRole(), requireManager(), clerkAuth(), clerkAuthOptional() (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (11): hasActiveStripeAccessWindow(), SubscriptionAccessService, getConfiguredStripePrices(), getPriceIdForTier(), mapStripeSubscriptionStatusToLocal(), SubscriptionBillingLifecycleService, mapPrismaSubscriptionTierToModel(), getErrorMessage() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (16): parseProductField(), CSVParserService, pureExtractField(), pureExtractFromParentheses(), pureHasInvalidLetterMixing(), pureNormalizeDecimalSeparator(), pureParseCostValue(), pureSanitizeValue() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (4): UploadController, MockStorageProvider, TestStorageProvider, ServiceProvider

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (5): invalidateSubscriptionCache(), dispatchStripeWebhookEvent(), applyCreationLockIfNeeded(), extractTierFromSubscriptionPrice(), WebhookService

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (12): OrgBootstrapController, OrganizationInviteController, AuthenticationError, AuthorizationError, BaseError, ConflictError, InternalError, isBaseError() (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.1
Nodes (16): detectProductImportFileType(), findColumnByAlternatives(), findColumnIndexByAlternatives(), getAllowedProductImportHeadersFromCsvState(), getAllowedProductImportHeadersFromXlsxState(), getAllowedProductImportHeaderValues(), getProductImportCsvColumnState(), getProductImportCsvRowValues() (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (15): getDashboardData(), countProducts(), createProduct(), deleteProduct(), getProductByBarcode(), getProductById(), getProducts(), countStoreAreas() (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.14
Nodes (7): ProductController, exportExcessProducts(), getCurrentSkuCount(), getExcessProducts(), getMaxSkus(), escapeCSVValue(), stringifyCSV()

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (4): calculateInventoryMarkdownPrice(), calculateInventoryMarkdownStatus(), daysUntil(), InventoryService

### Community 18 - "Community 18"
Cohesion: 0.13
Nodes (1): SubscriptionRepository

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (1): UserRepository

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (1): AnalyticsRepository

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (1): ApplicationMonitoringService

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (6): createMockMiddleware(), createSubscriptions(), seedFeatureFlags(), setupTestApp(), setupTestData(), AuthService

### Community 23 - "Community 23"
Cohesion: 0.1
Nodes (4): CameraScanner(), ScannerStateIndicator(), useHardwareScan(), triggerHaptic()

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (2): SaasMetricsService, validateAlertThresholds()

### Community 25 - "Community 25"
Cohesion: 0.24
Nodes (15): countSourceRows(), createSqliteTable(), ensureDirFor(), fetchTableRows(), getTimestamp(), insertRows(), listColumns(), listPrimaryKeyColumns() (+7 more)

### Community 26 - "Community 26"
Cohesion: 0.2
Nodes (1): ReportController

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (7): SubscriptionController, getStripeClient(), isStripeConfigured(), resetStripeClient(), validateStripeConfig(), validateRedirectUrl(), validateStripePriceId()

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (1): InventoryRepository

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (1): AnalyticsService

### Community 30 - "Community 30"
Cohesion: 0.42
Nodes (13): addSearchBox(), addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns() (+5 more)

### Community 31 - "Community 31"
Cohesion: 0.36
Nodes (13): addSearchBox(), addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns() (+5 more)

### Community 32 - "Community 32"
Cohesion: 0.23
Nodes (1): OrganizationInviteService

### Community 33 - "Community 33"
Cohesion: 0.24
Nodes (1): ProductRepository

### Community 34 - "Community 34"
Cohesion: 0.13
Nodes (1): ReportRepository

### Community 35 - "Community 35"
Cohesion: 0.13
Nodes (1): ReportService

### Community 36 - "Community 36"
Cohesion: 0.25
Nodes (1): OrganizationInviteRepository

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (1): OrganizationRepository

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (1): StoreAreaRepository

### Community 39 - "Community 39"
Cohesion: 0.5
Nodes (10): a(), B(), c(), D(), g(), i(), k(), o() (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.35
Nodes (1): StoreAreaController

### Community 41 - "Community 41"
Cohesion: 0.44
Nodes (10): a(), B(), c(), D(), g(), i(), k(), o() (+2 more)

### Community 42 - "Community 42"
Cohesion: 0.36
Nodes (1): UserController

### Community 43 - "Community 43"
Cohesion: 0.26
Nodes (2): EmailService, toTemplateRecord()

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (6): globalSetup(), createE2ETestPassword(), enterOtpCode(), signInAsManager(), signUpAsManager(), getOtpFromMailinator()

### Community 45 - "Community 45"
Cohesion: 0.32
Nodes (8): authenticateWorkerRequest(), extractJWTFromHeader(), extractOrganizationId(), isSubscriptionStatus(), isTierLevel(), querySubscriptionTier(), validateOrganizationStatus(), verifyJWT()

### Community 46 - "Community 46"
Cohesion: 0.51
Nodes (10): checkOrganizationWebhooks(), checkRecentWebhookHealth(), checkWebhookEvent(), formatDate(), logSection(), logStatus(), logSubsection(), parseArguments() (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.35
Nodes (8): fail(), normalizeNodeEnv(), parseNumber(), resolveCorsOrigin(), resolveFrontendUrl(), resolveJwtSecret(), setWorkerConfig(), validateEnvironment()

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (1): ExpiredItemController

### Community 49 - "Community 49"
Cohesion: 0.35
Nodes (1): StorageQuotaController

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (10): detectCrossTenantAccess(), extractOrganizationIdFromRequest(), getFromBody(), getFromParams(), getFromQuery(), handleCrossTenantViolation(), handleTenantAccessViolation(), isAccessAllowed() (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.18
Nodes (1): StoreAreaModel

### Community 52 - "Community 52"
Cohesion: 0.29
Nodes (1): LocalStorageProvider

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (9): Body(), BodyLg(), BodySm(), Caption(), Display(), H1(), H3(), H4() (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.2
Nodes (1): InventoryItemModel

### Community 55 - "Community 55"
Cohesion: 0.22
Nodes (1): R2StorageProvider

### Community 56 - "Community 56"
Cohesion: 0.56
Nodes (8): error(), exec(), info(), log(), main(), step(), success(), warn()

### Community 57 - "Community 57"
Cohesion: 0.22
Nodes (1): InMemoryStorageProvider

### Community 59 - "Community 59"
Cohesion: 0.25
Nodes (1): InMemoryStorageProvider

### Community 60 - "Community 60"
Cohesion: 0.25
Nodes (2): ErrorBoundary, renderWarning()

### Community 61 - "Community 61"
Cohesion: 0.5
Nodes (7): countInventoryItems(), createInventoryItem(), deleteInventoryItem(), getConnectionString(), getExpiringItems(), getInventoryItemById(), getInventoryItems()

### Community 62 - "Community 62"
Cohesion: 0.43
Nodes (6): checkFeatureAccess(), checkUsageLimit(), enforceUsageLimit(), formatFeatureUpgradeCTA(), formatUsageLimitCTA(), requireFeatureAccess()

### Community 63 - "Community 63"
Cohesion: 0.71
Nodes (4): goToNext(), goToPrevious(), makeCurrent(), toggleClass()

### Community 64 - "Community 64"
Cohesion: 0.43
Nodes (1): TrialEventRepository

### Community 65 - "Community 65"
Cohesion: 0.29
Nodes (3): FileNotFoundError, FileSizeLimitError, StorageProviderError

### Community 67 - "Community 67"
Cohesion: 0.29
Nodes (3): GS1ParseError, HandheldError, HardwareScanError

### Community 68 - "Community 68"
Cohesion: 0.73
Nodes (4): goToNext(), goToPrevious(), makeCurrent(), toggleClass()

### Community 69 - "Community 69"
Cohesion: 0.6
Nodes (5): analyzeMemoryGrowth(), generateTestCSV(), getMemorySnapshot(), main(), processCSVWithMemoryTracking()

### Community 70 - "Community 70"
Cohesion: 0.4
Nodes (1): DashboardController

### Community 71 - "Community 71"
Cohesion: 0.47
Nodes (1): ClerkWebhookEventRepository

### Community 72 - "Community 72"
Cohesion: 0.4
Nodes (1): OrgAuditRepository

### Community 73 - "Community 73"
Cohesion: 0.47
Nodes (1): ProcessedWebhookEventRepository

### Community 74 - "Community 74"
Cohesion: 0.33
Nodes (1): StorageQuotaRepository

### Community 75 - "Community 75"
Cohesion: 0.33
Nodes (1): UploadRepository

### Community 76 - "Community 76"
Cohesion: 0.47
Nodes (3): createInventoryRepositoryMock(), createInventoryService(), createProductRepositoryMock()

### Community 77 - "Community 77"
Cohesion: 0.33
Nodes (1): MockPointerEvent

### Community 78 - "Community 78"
Cohesion: 0.53
Nodes (4): displayResults(), ensureMemvidAvailable(), retrieveContext(), runMemvid()

### Community 79 - "Community 79"
Cohesion: 0.7
Nodes (4): main(), question(), seedTierFlags(), verifyMigration()

### Community 80 - "Community 80"
Cohesion: 0.4
Nodes (1): AuditLogModel

### Community 81 - "Community 81"
Cohesion: 0.5
Nodes (1): AuditLogRepository

### Community 82 - "Community 82"
Cohesion: 0.5
Nodes (1): JobLockRepository

### Community 83 - "Community 83"
Cohesion: 0.6
Nodes (4): escapeHtml(), escapeHtmlString(), extractCostValueEnhanced(), normalizeNumericString()

### Community 84 - "Community 84"
Cohesion: 0.5
Nodes (2): register(), registerValidSW()

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (2): getErrorMessage(), routeErrorHandler()

### Community 86 - "Community 86"
Cohesion: 0.5
Nodes (1): ClerkWebhookSignatureService

### Community 87 - "Community 87"
Cohesion: 0.5
Nodes (1): StripeWebhookSignatureService

### Community 89 - "Community 89"
Cohesion: 0.83
Nodes (3): retryWithBackoff(), withApiRetry(), withDatabaseRetry()

### Community 90 - "Community 90"
Cohesion: 0.5
Nodes (1): generateSKU()

### Community 91 - "Community 91"
Cohesion: 0.67
Nodes (2): HexIcon(), Wordmark()

### Community 92 - "Community 92"
Cohesion: 0.83
Nodes (2): generate(), htmlSnippet()

### Community 95 - "Community 95"
Cohesion: 0.83
Nodes (3): ensureMemvidAvailable(), escapeForShell(), logMemory()

### Community 97 - "Community 97"
Cohesion: 1.0
Nodes (2): auditOrganizationIds(), main()

### Community 98 - "Community 98"
Cohesion: 1.0
Nodes (2): backfillRoles(), normalizeRole()

### Community 99 - "Community 99"
Cohesion: 1.0
Nodes (2): main(), question()

### Community 100 - "Community 100"
Cohesion: 1.0
Nodes (2): main(), question()

### Community 101 - "Community 101"
Cohesion: 1.0
Nodes (2): printSummary(), runTests()

### Community 136 - "Community 136"
Cohesion: 1.0
Nodes (1): Database

## Knowledge Gaps
- **1 isolated node(s):** `Database`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (26 nodes): `subscription.repository.ts`, `SubscriptionRepository`, `.constructor()`, `.countTierFeatureFlags()`, `.create()`, `.createUsage()`, `.findByOrganizationId()`, `.findExpiredTrials()`, `.findLatestByOrganizationId()`, `.findPastDueExpired()`, `.findStripeLinkedSubscriptions()`, `.findTierFeatureFlag()`, `.findTrialingByOrganizationId()`, `.findTrialingExpiringBefore()`, `.findUsageByOrganizationId()`, `.getClient()`, `.getOrCreateUsage()`, `.groupSubscriptionCountsByTierAndStatus()`, `.seedTierFeatureFlag()`, `.update()`, `.updateByStripeSubscriptionId()`, `.updateManyByOrganizationId()`, `.updateManyByOrganizationIdAndStripeSubscriptionId()`, `.updateStripeCustomerId()`, `.updateUsage()`, `.upsertUsage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (25 nodes): `user.repository.ts`, `UserRepository`, `.constructor()`, `.countByOrganization()`, `.createBasicUser()`, `.createClerkUser()`, `.delete()`, `.existsByOrgAndEmail()`, `.findActiveByClerkUserId()`, `.findAdminByOrganizationId()`, `.findByClerkIdentity()`, `.findByClerkUserIdSelectEmail()`, `.findByClerkUserIdWithOrganizationSubscriptions()`, `.findByEmailAndOrganizationId()`, `.findById()`, `.findByOrganization()`, `.findFirstByClerkUserIdAndOrganizationId()`, `.findIdsByOrganization()`, `.findOrganizationIdByClerkUserId()`, `.findRecentTrialUserByEmail()`, `.findUniqueByClerkUserId()`, `.getClient()`, `.softDeleteById()`, `.update()`, `.updateManyByClerkUserId()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (22 nodes): `analytics.repository.ts`, `AnalyticsRepository`, `.constructor()`, `.countActiveSubscriptions()`, `.countActiveSubscriptionsCreatedSince()`, `.countCanceledSubscriptionsUpdatedSince()`, `.countPaidSubscriptionsCreatedSince()`, `.countProcessedWebhookEventsBetween()`, `.countTrialsEndingSince()`, `.createMetricsSnapshot()`, `.createWebhookMetrics()`, `.findActivePaidSubscriptionTierLevels()`, `.findLatestMetricsSnapshot()`, `.findMetricsSnapshotByDate()`, `.findMetricsSnapshotsSince()`, `.findTrialsEndedBetween()`, `.findWebhookMetricsByDateRange()`, `.findWebhookMetricsSince()`, `.groupSubscriptionTiersByTierLevel()`, `.incrementWebhookMetrics()`, `.sumActiveOrganizationUsers()`, `.upsertMetricsSnapshot()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (21 nodes): `application.monitoring.service.ts`, `ApplicationMonitoringService`, `.checkForAlerts()`, `.collectMetrics()`, `.collectMetricsInternal()`, `.collectMonitoringMetrics()`, `.constructor()`, `.emitAlert()`, `.getInstance()`, `.getMetrics()`, `.getSaasMetrics()`, `.getWebhookMetrics()`, `.initialize()`, `.isActiveMonitoringRun()`, `.recordRequest()`, `.recordWebhookEvent()`, `.requestTrackingMiddleware()`, `.startMonitoring()`, `.stopMonitoring()`, `.storeDailyMetrics()`, `.trackUserJourney()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (19 nodes): `saas-metrics.service.ts`, `SaasMetricsService`, `.calculateAvgRevenuePerUser()`, `.calculateChurnRate()`, `.calculatePaymentFailureRate()`, `.calculateTrialConversionRate()`, `.calculateWebhookFailureRate()`, `.checkAlerts()`, `.constructor()`, `.getDailyWebhookErrorCount()`, `.getProcessedWebhookEventGrowthRate()`, `.getSaasMetrics()`, `.getTierDistribution()`, `.recordWebhookMetrics()`, `.sendAlert()`, `.storeDailyMetrics()`, `subscription.js`, `subscription.ts`, `validateAlertThresholds()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (18 nodes): `report.controller.ts`, `createReportController()`, `ReportController`, `.constructor()`, `.getDailyUsageReport()`, `.getDashboardAnalytics()`, `.getDetailedExpiryReport()`, `.getItemsByDateReport()`, `.getItemsByUserReport()`, `.getLossByDepartmentReport()`, `.getLossBySkuReport()`, `.getMonthlyExpiryReport()`, `.getMonthlyMarkdownReport()`, `.getOverallExpiryReport()`, `.getService()`, `.getUsageReport()`, `.respondWithReport()`, `.updateAllMarkdownStatuses()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (17 nodes): `inventory.repository.ts`, `InventoryRepository`, `.constructor()`, `.create()`, `.delete()`, `.findAll()`, `.findById()`, `.findByLocationId()`, `.findByOrganizationIdAndId()`, `.findByProductId()`, `.findFirst()`, `.findManyByIds()`, `.findRecentByProductId()`, `.findUniqueWithProduct()`, `.getClient()`, `.update()`, `.updateManyByIds()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (17 nodes): `analytics.service.ts`, `AnalyticsService`, `.cleanOldData()`, `.constructor()`, `.endSession()`, `.exportData()`, `.generateSessionId()`, `.getEventCountByType()`, `.getInstance()`, `.getMetrics()`, `.initialize()`, `.processEventQueue()`, `.resetInstance()`, `.startBatchProcessing()`, `.startSession()`, `.stopBatchProcessing()`, `.trackEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (15 nodes): `organization-invite.service.ts`, `OrganizationInviteService`, `.acceptInvite()`, `.buildInviteToken()`, `.constructor()`, `.createInvite()`, `.ensureWithinUserLimit()`, `.findPendingInviteForToken()`, `.generateTokenSecret()`, `.isInviteExpired()`, `.listPendingInvites()`, `.markInviteAsExpired()`, `.parseInviteToken()`, `.resendInvite()`, `.revokeInvite()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (15 nodes): `product.repository.ts`, `ProductRepository`, `.constructor()`, `.countByOrganization()`, `.create()`, `.delete()`, `.findAll()`, `.findByBarcode()`, `.findById()`, `.findBySku()`, `.findBySkuOrBarcode()`, `.findExcessProductsByOrganization()`, `.findFirstBySkuOrBarcode()`, `.getClient()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (15 nodes): `report.repository.ts`, `ReportRepository`, `.constructor()`, `.getDailyUsageReport()`, `.getDashboardAnalytics()`, `.getDashboardData()`, `.getDetailedExpiryReport()`, `.getItemsByDateReport()`, `.getItemsByUserReport()`, `.getLossByDepartmentReport()`, `.getLossBySkuReport()`, `.getMonthlyExpiryReport()`, `.getMonthlyMarkdownReport()`, `.getOverallExpiryReport()`, `.getUsageReport()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (15 nodes): `report.service.ts`, `ReportService`, `.constructor()`, `.getDailyUsageReport()`, `.getDashboardAnalytics()`, `.getDetailedExpiryReport()`, `.getItemsByDateReport()`, `.getItemsByUserReport()`, `.getLossByDepartmentReport()`, `.getLossBySkuReport()`, `.getMonthlyExpiryReport()`, `.getMonthlyMarkdownReport()`, `.getOverallExpiryReport()`, `.getUsageReport()`, `.updateAllMarkdownStatuses()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (14 nodes): `organization-invite.repository.ts`, `OrganizationInviteRepository`, `.constructor()`, `.countPendingByOrg()`, `.create()`, `.findByIdAndOrg()`, `.findPendingById()`, `.findPendingByIdAndOrg()`, `.findPendingByOrgAndEmail()`, `.findRecentPending()`, `.getClient()`, `.listPendingByOrg()`, `.markExpired()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (14 nodes): `organization.repository.ts`, `OrganizationRepository`, `.constructor()`, `.create()`, `.createDefaultOrganization()`, `.deleteCascade()`, `.findByClerkOrganizationId()`, `.findById()`, `.findByIdSelect()`, `.findCreationLockById()`, `.findWithContactDetails()`, `.getClient()`, `.update()`, `.updateById()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (14 nodes): `store-area.repository.ts`, `StoreAreaRepository`, `.constructor()`, `.create()`, `.createWithTransaction()`, `.delete()`, `.findAll()`, `.findById()`, `.findByName()`, `.findByNameAndSubDepartment()`, `.findByNameAndSubDepartmentWithTransaction()`, `.getClient()`, `.getOrCreateByName()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (13 nodes): `store-area.controller.ts`, `createStoreAreaController()`, `StoreAreaController`, `.constructor()`, `.createStoreArea()`, `.deleteStoreArea()`, `.getAllStoreAreas()`, `.getService()`, `.getStoreAreaById()`, `.getStoreAreaByName()`, `.handleError()`, `.parseStoreAreaId()`, `.updateStoreArea()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (12 nodes): `user.controller.ts`, `createUserController()`, `UserController`, `.constructor()`, `.createUser()`, `.deleteUser()`, `.getService()`, `.getUserById()`, `.getUsers()`, `.parseUserId()`, `.updateUser()`, `.validateUserOwnership()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (12 nodes): `email.service.ts`, `EmailService`, `.constructor()`, `.createAuditLog()`, `.sendBulkEmail()`, `.sendDowngradeWarningEmail()`, `.sendDunningEmail()`, `.sendEmail()`, `.sendOrganizationInviteEmail()`, `.sendPaymentFailedEmail()`, `.sendTrialReminderEmail()`, `toTemplateRecord()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (11 nodes): `expired-item.controller.ts`, `createExpiredItemController()`, `ExpiredItemController`, `.constructor()`, `.getAllExpiredItems()`, `.getExpiredLossReports()`, `.getService()`, `.parseAction()`, `.parseInventoryItemId()`, `.parseUnitsDiscarded()`, `.processExpiredItem()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (11 nodes): `storage-quota.controller.ts`, `createStorageQuotaController()`, `StorageQuotaController`, `.canUpload()`, `.constructor()`, `.getService()`, `.getStorageQuota()`, `.parseFileSize()`, `.parseTier()`, `.parseUserId()`, `.validateAccess()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (11 nodes): `store-area.model.ts`, `StoreAreaModel`, `.constructor()`, `.create()`, `.createTable()`, `.delete()`, `.findAll()`, `.findById()`, `.findByName()`, `.findByNameAndSubDepartment()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (11 nodes): `local-storage.provider.ts`, `LocalStorageProvider`, `.constructor()`, `.delete()`, `.download()`, `.ensureDirectory()`, `.exists()`, `.getFullPath()`, `.getMetadata()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (10 nodes): `inventory-item.model.ts`, `InventoryItemModel`, `.constructor()`, `.create()`, `.createTable()`, `.delete()`, `.findById()`, `.findByLocationId()`, `.findByProductId()`, `.update()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (10 nodes): `r2-storage.provider.ts`, `R2StorageProvider`, `.constructor()`, `.delete()`, `.download()`, `.exists()`, `.getMetadata()`, `.getPresignedDownloadUrl()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (9 nodes): `upload-flow.test.ts`, `createTestApp()`, `getEnvConfig()`, `InMemoryStorageProvider`, `.delete()`, `.download()`, `.exists()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (8 nodes): `upload-load.test.ts`, `createTestApp()`, `InMemoryStorageProvider`, `.delete()`, `.download()`, `.exists()`, `.getPresignedUploadUrl()`, `.upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (8 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `ErrorBoundary.tsx`, `StorageQuotaWarning.test.tsx`, `renderWarning()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (7 nodes): `trial-event.repository.ts`, `TrialEventRepository`, `.constructor()`, `.create()`, `.findRecentByOrganizationAndType()`, `.findRecentByType()`, `.getClient()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (6 nodes): `dashboard.controller.ts`, `createDashboardController()`, `DashboardController`, `.constructor()`, `.getDashboardData()`, `.getService()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (6 nodes): `clerk-webhook-event.repository.ts`, `ClerkWebhookEventRepository`, `.constructor()`, `.create()`, `.findById()`, `.getClient()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (6 nodes): `org-audit.repository.ts`, `OrgAuditRepository`, `.constructor()`, `.create()`, `.findByOrganization()`, `.getClient()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (6 nodes): `processed-webhook-event.repository.ts`, `ProcessedWebhookEventRepository`, `.constructor()`, `.create()`, `.findById()`, `.getClient()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (6 nodes): `storage-quota.repository.ts`, `StorageQuotaRepository`, `.constructor()`, `.markUploadDeleted()`, `.recordUpload()`, `.sumActiveUploadBytes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (6 nodes): `upload.repository.ts`, `UploadRepository`, `.constructor()`, `.findStatusByFileKey()`, `.markCompleted()`, `.markFailed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (6 nodes): `setupTests.ts`, `disconnect()`, `MockPointerEvent`, `.constructor()`, `observe()`, `unobserve()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (5 nodes): `audit-log.model.ts`, `AuditLogModel`, `.constructor()`, `.createTable()`, `.logChange()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (5 nodes): `audit-log.repository.ts`, `AuditLogRepository`, `.constructor()`, `.create()`, `.getClient()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (5 nodes): `job-lock.repository.ts`, `JobLockRepository`, `.acquire()`, `.constructor()`, `.release()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (5 nodes): `serviceWorkerRegistration.ts`, `checkValidServiceWorker()`, `register()`, `registerValidSW()`, `unregister()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (4 nodes): `storage-quota.routes.ts`, `getErrorMessage()`, `getStorageQuotaServiceForRequest()`, `routeErrorHandler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (4 nodes): `clerk-webhook-signature.service.ts`, `ClerkWebhookSignatureService`, `.constructor()`, `.verifySignature()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (4 nodes): `stripe-webhook-signature.service.ts`, `StripeWebhookSignatureService`, `.constructor()`, `.verifySignature()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (4 nodes): `multi-tenant-concurrency-load.test.ts`, `sku-generator.test.ts`, `sku-generator.ts`, `generateSKU()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (4 nodes): `Logo.tsx`, `Logo.tsx`, `HexIcon()`, `Wordmark()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (4 nodes): `generate-favicons.ts`, `generate-favicons.ts`, `generate()`, `htmlSnippet()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (3 nodes): `audit-org-ids.ts`, `auditOrganizationIds()`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (3 nodes): `backfill-canonical-roles.js`, `backfillRoles()`, `normalizeRole()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 99`** (3 nodes): `migrate-production-doppler.js`, `main()`, `question()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (3 nodes): `migrate-production-simple.js`, `main()`, `question()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (3 nodes): `test-r2-connection.ts`, `printSummary()`, `runTests()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 136`** (2 nodes): `shims-better-sqlite3.d.ts`, `Database`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getDefaultDatabaseClient()` connect `Community 1` to `Community 32`, `Community 2`, `Community 5`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 43`, `Community 12`, `Community 11`, `Community 16`, `Community 22`, `Community 24`, `Community 27`?**
  _High betweenness centrality (0.164) - this node is a cross-community bridge._
- **Why does `Logger` connect `Community 2` to `Community 32`, `Community 1`, `Community 5`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 43`, `Community 13`, `Community 12`, `Community 16`, `Community 50`, `Community 21`, `Community 22`, `Community 24`, `Community 27`, `Community 29`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `normalizeRole()` connect `Community 8` to `Community 1`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Are the 29 inferred relationships involving `getDefaultDatabaseClient()` (e.g. with `initializeDiContainer()` and `.constructor()`) actually correct?**
  _`getDefaultDatabaseClient()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Database` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._