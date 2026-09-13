/**
 * InfinityPay API - Health Check Route
 * GET /api/health
 */
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  return res.status(200).json({
    success: true,
    service: 'InfinityPay API',
    status: 'online',
  });
});

module.exports = router;
