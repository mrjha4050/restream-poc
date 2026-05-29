const express = require('express');
const healthRoutes = require('./health.route');
const platformsRoutes = require('./platforms.route');
const streamsRoutes = require('./streams.route');
const logsRoutes = require('./logs.route');
const authRoutes = require('./auth.route');
const streamsController = require('../controllers/streams.controller');
const logsController = require('../controllers/logs.controller');

const router = express.Router();

router.use(healthRoutes);
router.use('/platforms', platformsRoutes);
router.use('/platforms', streamsRoutes);

router.get('/status', streamsController.getStatus);
router.post('/stop', streamsController.stopAll);

router.get('/logs', logsController.getHistoricalLogs);
router.get('/stream-logs', logsController.streamLogs);
router.use('/logs', logsRoutes);

router.use('/auth', authRoutes);

module.exports = router;
