/**
 * InfinityPay API - Standalone Health Check Function
 * Route: GET /api/health
 */

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    success: true,
    service: 'InfinityPay API',
    status: 'online',
  });
};
