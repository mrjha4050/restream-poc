const express = require('express');
const authController = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/youtube', authController.redirectToYouTube);
router.get('/youtube/callback', asyncHandler(authController.handleYouTubeCallback));
router.get('/youtube/status', asyncHandler(authController.getYouTubeStatus));
router.post('/youtube/fetch-key', asyncHandler(authController.fetchYouTubeKey));
router.get('/youtube/pipeline', asyncHandler(authController.getYouTubePipelineStatus));
router.post('/youtube/disconnect', authController.disconnectYouTube);

router.get('/facebook', authController.redirectToFacebook);
router.get('/facebook/callback', asyncHandler(authController.handleFacebookCallback));
router.get('/facebook/status', asyncHandler(authController.getFacebookStatus));
router.get('/facebook/pages', asyncHandler(authController.getFacebookPages));
router.post('/facebook/select-page', asyncHandler(authController.selectFacebookPage));
router.post('/facebook/start-live', asyncHandler(authController.startFacebookLive));
router.post('/facebook/disconnect', authController.disconnectFacebook);

module.exports = router;
