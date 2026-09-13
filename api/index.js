/**
 * InfinityPay API - Vercel Serverless Function Entrypoint
 * Handles incoming serverless HTTP requests by exporting the configured Express app.
 */

const createApp = require('../lib/app');

const app = createApp();

module.exports = app;
