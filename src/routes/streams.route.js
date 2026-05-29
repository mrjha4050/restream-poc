const express = require('express');
const streamsController = require('../controllers/streams.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/:id/start', asyncHandler(streamsController.startPlatform));
router.post('/:id/stop', streamsController.stopPlatform);

module.exports = router;
