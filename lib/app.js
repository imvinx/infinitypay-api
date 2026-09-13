/**
 * InfinityPay API - Express Application Factory
 * Configures security headers, CORS, rate limiting, request validation,
 * and mounts all modular REST API routers under /api/.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { createRateLimiter } = require('./rate-limiter');
const { sendError, ErrorCodes } = require('./responses');

// Route modules
const healthRoutes = require('./routes/health');
const developerRoutes = require('./routes/developer');
const accountRoutes = require('./routes/accounts');
const checkoutRoutes = require('./routes/checkout');
const cronRoutes = require('./routes/cron');

function createApp() {
  const app = express();

  // Trust proxy for secure headers and client IP behind Vercel edge reverse proxy
  app.set('trust proxy', 1);

  // Normalize request URL for Vercel serverless rewrites
  app.use((req, res, next) => {
    if (req.query && req.query.slug) {
      const slug = req.query.slug;
      delete req.query.slug;
      const cleanSlug = String(slug).replace(/^\/+/, '');
      req.url = `/api/${cleanSlug}`;
    } else if (req.url === '/api/index.js' || req.url.startsWith('/api/index.js')) {
      req.url = '/api';
    }
    next();
  });

  // 1. Security Headers (Helmet)
  app.use(
    helmet({
      contentSecurityPolicy: false, // API only
      crossOriginEmbedderPolicy: false,
    })
  );

  // 2. Cross-Origin Resource Sharing (CORS)
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by InfinityPay CORS policy'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-InfinityPay-Key'],
      exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
      credentials: true,
      maxAge: 86400,
    })
  );

  // 3. Request Size Limit & Body Parser
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // 4. Rate Limiting Middleware
  app.use(createRateLimiter());

  // 5. API Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/developer', developerRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/checkout', checkoutRoutes);
  app.use('/api/cron', cronRoutes);

  // Base API Info Route
  app.get('/api', (req, res) => {
    return res.status(200).json({
      success: true,
      service: 'InfinityPay API',
      version: '1.0.0',
      documentation: '/api/health',
    });
  });

  // 6. Handle 404 Route Not Found
  app.use((req, res) => {
    return sendError(
      res,
      `Endpoint not found: ${req.method} ${req.originalUrl}`,
      ErrorCodes.VALIDATION_ERROR,
      404
    );
  });

  // 7. Global Safe Error Handler (Never leak stack traces in production)
  app.use((err, req, res, next) => {
    const isProd = config.isProduction;
    const message = err.message || 'Internal server error';

    // Log internally without leaking secrets
    if (!config.isTest) {
      console.error(`[API_ERROR] ${err.name}: ${message}`);
    }

    return sendError(
      res,
      isProd ? 'An unexpected internal error occurred.' : message,
      ErrorCodes.INTERNAL_ERROR,
      err.status || 500
    );
  });

  return app;
}

module.exports = createApp;
