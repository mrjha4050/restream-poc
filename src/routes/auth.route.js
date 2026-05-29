const express = require('express');
const authController = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/youtube', authController.redirectToYouTube);
router.get('/youtube/callback', asyncHandler(authController.handleYouTubeCallback));
router.get('/youtube/status', asyncHandler(authController.getYouTubeStatus));
router.post('/youtube/fetch-key', asyncHandler(authController.fetchYouTubeKey));
router.post('/youtube/disconnect', authController.disconnectYouTube);

module.exports = router;
