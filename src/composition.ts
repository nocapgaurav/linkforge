import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redisClient } from './config/redis.js';
import {
  PrismaAnalyticsRepository,
  type AnalyticsRepository,
} from './modules/analytics/analytics.repository.js';
import { createAnalyticsController } from './modules/analytics/analytics.controller.js';
import {
  DefaultAnalyticsService,
  type AnalyticsService,
} from './modules/analytics/analytics.service.js';
import { PrismaClickRepository, type ClickRepository } from './modules/analytics/click.repository.js';
import {
  DatabaseClickSink,
  NullClickSink,
  type ClickSink,
} from './modules/analytics/click.sink.js';
import { createAuthController } from './modules/auth/auth.controller.js';
import { DefaultAuthService, type AuthService } from './modules/auth/auth.service.js';
import {
  PrismaSessionRepository,
  type SessionRepository,
} from './modules/auth/session.repository.js';
import { createUrlController } from './modules/url/url.controller.js';
import {
  NullRedirectCache,
  RedisRedirectCache,
  type RedirectCache,
} from './modules/url/url.cache.js';
import { PrismaUrlRepository, type UrlRepository } from './modules/url/url.repository.js';
import { DefaultUrlService, type UrlService } from './modules/url/url.service.js';
import { PrismaUserRepository, type UserRepository } from './modules/user/user.repository.js';
import { createRateLimiter } from './shared/http/rate-limit.js';

/**
 * Composition root — the single place the object graph is assembled:
 * repositories bind to infrastructure, services bind to repositories (and
 * to each other's ports), controllers bind to services. Modules export
 * classes and interfaces only; nothing outside this file news up a wired
 * instance, so swapping an implementation (Null vs Redis cache, Database
 * vs queue sink, a test double) is always a one-line, one-place change.
 * Deliberately plain code — no IoC container.
 */

// Repositories (infrastructure bindings)
export const urlRepository: UrlRepository = new PrismaUrlRepository(prisma);
export const clickRepository: ClickRepository = new PrismaClickRepository(prisma);
export const analyticsRepository: AnalyticsRepository = new PrismaAnalyticsRepository(prisma);
export const userRepository: UserRepository = new PrismaUserRepository(prisma);
export const sessionRepository: SessionRepository = new PrismaSessionRepository(prisma);

// Infrastructure-backed ports (env decides the implementation)
export const redirectCache: RedirectCache = redisClient
  ? new RedisRedirectCache(redisClient)
  : new NullRedirectCache();
export const clickSink: ClickSink = env.analyticsEnabled
  ? new DatabaseClickSink(clickRepository)
  : new NullClickSink();
// null redisClient (REDIS_URL unset) makes every rate limiter a pass-through.
export const rateLimit = createRateLimiter(redisClient);

// Services
export const urlService: UrlService = new DefaultUrlService(
  urlRepository,
  redirectCache,
  clickSink,
);
export const analyticsService: AnalyticsService = new DefaultAnalyticsService(
  urlRepository,
  analyticsRepository,
);
export const authService: AuthService = new DefaultAuthService(userRepository, sessionRepository, {
  bcryptCost: env.bcryptCost,
});

// Controllers
export const urlController = createUrlController(urlService);
export const analyticsController = createAnalyticsController(analyticsService);
export const authController = createAuthController(authService);
