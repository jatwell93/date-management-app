"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireManager = exports.generateToken = exports.authenticateToken = exports.TEST_AUTH_BYPASS_ORG_ID = exports.invalidateSubscriptionCache = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const backend_1 = require("@clerk/backend");
const analytics_service_1 = require("../services/analytics.service");
const subscription_1 = require("../types/subscription");
const database_factory_1 = require("../database/database-factory");
const environment_1 = require("../config/environment");
const subscription_service_1 = require("../services/subscription.service");
const CLERK_DEV_ORIGINS = ['http://localhost:3002', 'http://127.0.0.1:3002'];
const TIER_VERSION_HEADER = 'X-Org-Tier-Version';
function getAuthorizedParties() {
    const partySet = new Set(CLERK_DEV_ORIGINS);
    if (environment_1.envConfig.FRONTEND_URL) {
        partySet.add(environment_1.envConfig.FRONTEND_URL);
    }
    if (environment_1.envConfig.CORS_ORIGIN) {
        partySet.add(environment_1.envConfig.CORS_ORIGIN);
    }
    const parties = Array.from(partySet);
    if (parties.length === CLERK_DEV_ORIGINS.length && process.env.NODE_ENV === 'production') {
        console.warn('WARNING: No production origins configured for Clerk token verification. Please set FRONTEND_URL or CORS_ORIGIN.');
    }
    return parties;
}
const isTierLevel = (value) => ['starter', 'professional', 'premium', 'concierge'].includes(value);
const isBillingCycle = (value) => Object.values(subscription_1.BillingCycle).includes(value);
const hasRequiredTokenFields = (token) => {
    return 'userId' in token && 'role' in token && 'organizationId' in token;
};
function getTierVersion(subscription) {
    return `${subscription.id}:${subscription.tierLevel}:${subscription.updatedAt.getTime()}`;
}
// Export cache invalidation to allow webhooks to instantly apply tier changes
const invalidateSubscriptionCache = (organizationId) => {
    subscriptionCache.delete(organizationId);
};
exports.invalidateSubscriptionCache = invalidateSubscriptionCache;
// Simple memory cache for subscription status
const subscriptionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
exports.TEST_AUTH_BYPASS_ORG_ID = 'default-org';
const authenticateToken = async (req, res, next) => {
    // Test environment bypass
    if (process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true') {
        return setTestAuthContext(req, next);
    }
    const token = extractTokenFromRequest(req);
    if (!token) {
        return handleAuthError(res, 'Access denied: No token provided', 'unauthorized_access_attempt', req);
    }
    const decodedToken = await verifyToken(token);
    if (!decodedToken) {
        return handleAuthError(res, 'Access denied: Invalid token', 'invalid_token_attempt', req, 403);
    }
    if (!isValidTokenStructure(decodedToken)) {
        return handleAuthError(res, 'Access denied: Invalid token payload', 'invalid_token_payload', req, 403);
    }
    if (!hasRequiredTokenFields(decodedToken)) {
        return handleAuthError(res, 'Access denied: Malformed token payload', 'missing_token_fields', req, 403);
    }
    if (isTokenExpired(decodedToken)) {
        return handleAuthError(res, 'Access denied: Token has expired', 'expired_token_attempt', req, 403);
    }
    if (!decodedToken.organizationId) {
        return handleAuthError(res, 'Access denied: Missing tenant context in token', 'missing_tenant_context', req, 403);
    }
    try {
        const { dbTierLevel, tierVersion } = await validateOrganizationSubscription(decodedToken, req);
        res.setHeader(TIER_VERSION_HEADER, tierVersion);
        setRequestContext(req, decodedToken, dbTierLevel);
        trackSuccessfulAuth(decodedToken, req);
        next();
    }
    catch (error) {
        // Check if it's a subscription validation error
        if (error instanceof Error &&
            (error.message.includes('Organization subscription not configured') ||
                error.message.includes('Organization subscription is invalid') ||
                error.message.includes('Organization subscription has been canceled'))) {
            return handleAuthError(res, error.message, 'organization_subscription_invalid', req, 403);
        }
        trackAuthError(decodedToken, 'organization_validation_error', error, req);
        return res.status(500).json({ message: 'Error validating organization access' });
    }
};
exports.authenticateToken = authenticateToken;
/**
 * Helper functions for authentication middleware
 */
function setTestAuthContext(req, next) {
    req.user = {
        id: 1,
        role: 'Manager',
        organizationId: exports.TEST_AUTH_BYPASS_ORG_ID,
        tierLevel: 'professional',
    };
    req.userId = 1;
    req.userRole = 'Manager';
    req.organizationId = exports.TEST_AUTH_BYPASS_ORG_ID;
    req.tierLevel = 'professional';
    next();
}
function extractTokenFromRequest(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader)
        return null;
    // Handle both string and array headers
    const headers = Array.isArray(authHeader) ? authHeader : [authHeader];
    // Extract the first valid bearer token
    for (const header of headers) {
        const token = header.split(' ')[1];
        if (token)
            return token;
    }
    return null;
}
async function verifyToken(token) {
    // First try with the current JWT secret
    try {
        return jsonwebtoken_1.default.verify(token, environment_1.envConfig.JWT_SECRET);
    }
    catch (_err) {
        // If current secret fails, try with old secret (for rotation period)
        if (process.env.JWT_SECRET_OLD) {
            try {
                return jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET_OLD);
            }
            catch (_rotationErr) {
                // Fall through to Clerk verification
            }
        }
        // Try Clerk JWT verification as fallback
        return await resolveFromClerkToken(token);
    }
}
async function resolveFromClerkToken(token) {
    if (!environment_1.envConfig.CLERK_SECRET_KEY) {
        return null;
    }
    try {
        const clerkDecoded = (await (0, backend_1.verifyToken)(token, {
            secretKey: environment_1.envConfig.CLERK_SECRET_KEY,
            authorizedParties: getAuthorizedParties(),
        }));
        const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
        const user = await prisma.user.findUnique({
            where: { clerkUserId: clerkDecoded.sub, deletedAt: null },
            select: {
                id: true,
                role: true,
                organizationId: true,
            },
        });
        // Exclude soft-deleted users
        if (!user || user.organizationId === null) {
            return null;
        }
        return {
            userId: user.id,
            role: user.role,
            organizationId: user.organizationId,
            exp: clerkDecoded.exp,
        };
    }
    catch {
        return null;
    }
}
function isValidTokenStructure(decodedToken) {
    return decodedToken && typeof decodedToken === 'object';
}
function isTokenExpired(decodedToken) {
    return decodedToken.exp ? decodedToken.exp * 1000 < Date.now() : false;
}
function handleAuthError(res, message, action, req, statusCode = 401) {
    const analyticsService = analytics_service_1.AnalyticsService.getInstance();
    analyticsService.trackEvent({
        eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
        eventCategory: 'Auth',
        eventAction: action,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: { path: req.path, method: req.method },
    });
    return res.status(statusCode).json({ message });
}
async function validateOrganizationSubscription(decodedToken, req) {
    const orgId = decodedToken.organizationId;
    let subscription = null;
    let hasActiveAccess = true;
    // Check cache first
    const cached = subscriptionCache.get(orgId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        subscription = cached.subscription.data;
        hasActiveAccess = cached.subscription.hasActiveAccess;
    }
    else {
        const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
        subscription = await prisma.subscriptionTier.findFirst({
            where: { organizationId: orgId },
            orderBy: { createdAt: 'desc' },
        });
        if (subscription && subscription.status === subscription_1.SubscriptionStatus.CANCELED) {
            const tierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
            const billingCycle = isBillingCycle(subscription.billingCycle)
                ? subscription.billingCycle
                : null;
            if (tierLevel && billingCycle) {
                const subscriptionService = new subscription_service_1.SubscriptionService(prisma);
                hasActiveAccess = await subscriptionService.isAccessActive({
                    id: subscription.id,
                    organizationId: subscription.organizationId,
                    tierLevel,
                    stripeSubscriptionId: subscription.stripeSubscriptionId ?? undefined,
                    trialEndDate: subscription.trialEndDate ?? undefined,
                    trialStartedAt: subscription.trialStartedAt ?? undefined,
                    trialConvertedAt: subscription.trialConvertedAt ?? undefined,
                    status: subscription.status,
                    billingCycle,
                    createdAt: subscription.createdAt,
                    updatedAt: subscription.updatedAt,
                });
            }
            else {
                hasActiveAccess = false;
            }
        }
        // Update cache
        subscriptionCache.set(orgId, {
            subscription: { data: subscription, hasActiveAccess },
            timestamp: Date.now(),
        });
    }
    if (!subscription) {
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            userId: decodedToken.userId,
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'organization_subscription_not_found',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: {
                organizationId: decodedToken.organizationId,
                path: req.path,
                method: req.method,
            },
        });
        throw new Error('Organization subscription not configured');
    }
    // Check if subscription is canceled (allow access until Stripe period end if applicable)
    if (subscription.status === subscription_1.SubscriptionStatus.CANCELED) {
        const tierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
        const billingCycle = isBillingCycle(subscription.billingCycle)
            ? subscription.billingCycle
            : null;
        if (!tierLevel || !billingCycle) {
            const analyticsService = analytics_service_1.AnalyticsService.getInstance();
            analyticsService.trackEvent({
                userId: decodedToken.userId,
                eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
                eventCategory: 'Auth',
                eventAction: 'organization_subscription_invalid',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent') || undefined,
                metadata: {
                    organizationId: decodedToken.organizationId,
                    path: req.path,
                    method: req.method,
                    subscriptionTierLevel: subscription.tierLevel,
                    subscriptionBillingCycle: subscription.billingCycle,
                },
            });
            throw new Error('Organization subscription is invalid. Please contact support.');
        }
        if (!hasActiveAccess) {
            const analyticsService = analytics_service_1.AnalyticsService.getInstance();
            analyticsService.trackEvent({
                userId: decodedToken.userId,
                eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
                eventCategory: 'Auth',
                eventAction: 'organization_subscription_canceled',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent') || undefined,
                metadata: {
                    organizationId: decodedToken.organizationId,
                    path: req.path,
                    method: req.method,
                },
            });
            throw new Error('Organization subscription has been canceled. Please contact support.');
        }
    }
    // Override tierLevel from database (Source of Truth)
    const dbTierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
    const tierVersion = getTierVersion(subscription);
    if (dbTierLevel && decodedToken.tierLevel && decodedToken.tierLevel !== dbTierLevel) {
        console.warn('[AUTH] Stale token tier detected; using latest DB tier', {
            userId: decodedToken.userId,
            organizationId: decodedToken.organizationId,
            tokenTierLevel: decodedToken.tierLevel,
            dbTierLevel,
            tierVersion: getTierVersion(subscription),
        });
    }
    return { dbTierLevel, tierVersion };
}
function setRequestContext(req, decodedToken, dbTierLevel) {
    req.userId = decodedToken.userId;
    req.userRole = decodedToken.role;
    req.organizationId = decodedToken.organizationId;
    req.tierLevel = dbTierLevel ?? undefined;
    req.user = {
        id: decodedToken.userId,
        role: decodedToken.role,
        organizationId: decodedToken.organizationId,
        tierLevel: dbTierLevel ?? 'starter', // Default to starter if validation failed
    };
}
function trackSuccessfulAuth(decodedToken, req) {
    const analyticsService = analytics_service_1.AnalyticsService.getInstance();
    analyticsService.trackEvent({
        userId: decodedToken.userId,
        eventType: analytics_service_1.AnalyticsEventType.VIEW_DASHBOARD, // General action for accessing protected routes
        eventCategory: 'Auth',
        eventAction: 'protected_route_access',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: {
            path: req.path,
            method: req.method,
            role: decodedToken.role,
            organizationId: decodedToken.organizationId,
        },
    });
}
function trackAuthError(decodedToken, action, error, req) {
    const analyticsService = analytics_service_1.AnalyticsService.getInstance();
    analyticsService.trackEvent({
        userId: decodedToken.userId,
        eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
        eventCategory: 'Auth',
        eventAction: action,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: {
            organizationId: decodedToken.organizationId,
            path: req.path,
            method: req.method,
            error: error instanceof Error ? error.message : 'Unknown error',
        },
    });
}
// Function to generate a JWT token with configurable expiration
const generateToken = (userId, role, organizationId, tierLevel, expiresIn = '24h') => {
    return jsonwebtoken_1.default.sign({ userId, role, organizationId, tierLevel }, environment_1.envConfig.JWT_SECRET, {
        expiresIn: expiresIn,
    });
};
exports.generateToken = generateToken;
const requireManager = (req, res, next) => {
    if (req.userRole !== 'Manager' && req.userRole !== 'admin') {
        // Track unauthorized manager access attempt
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            userId: req.userId,
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'manager_access_denied',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: { path: req.path, method: req.method, role: req.userRole },
        });
        return res.status(403).json({ message: 'Access denied: Manager role required' });
    }
    next();
};
exports.requireManager = requireManager;
