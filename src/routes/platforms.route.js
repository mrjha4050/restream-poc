const express = require('express');
const platformsController = require('../controllers/platforms.controller');

const router = express.Router();

router.get('/', platformsController.getPlatforms);

module.exports = router;
