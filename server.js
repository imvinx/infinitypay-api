/**
 * InfinityPay API - Local Development Server
 * Starts HTTP listener on configured PORT.
 */

const createApp = require('./lib/app');
const config = require('./lib/config');

const app = createApp();
const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`
==================================================================
  INFINITYPAY API - Server Running
==================================================================
  Environment : ${config.env}
  Base URL    : http://localhost:${PORT}
  Health      : http://localhost:${PORT}/api/health
  Developer   : http://localhost:${PORT}/api/developer
  Accounts    : http://localhost:${PORT}/api/accounts
  Checkout    : http://localhost:${PORT}/api/checkout/:orderId
  Cron Sync   : http://localhost:${PORT}/api/cron/sync
==================================================================
`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing HTTP server gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
