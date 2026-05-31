const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const rootDir = path.join(__dirname, '..', '..');
const envPath = path.join(rootDir, '.env');
const envLocalPath = path.join(rootDir, '.env.local');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  serviceApiKey: process.env.SERVICE_API_KEY || '',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      `http://localhost:${process.env.PORT || 3000}/auth/youtube/callback`,
  },
  facebook: {
    appId: process.env.FACEBOOK_APP_ID || '',
    appSecret: process.env.FACEBOOK_APP_SECRET || '',
    redirectUri:
      process.env.FACEBOOK_REDIRECT_URI ||
      `http://localhost:${process.env.PORT || 3000}/auth/facebook/callback`,
    graphVersion: process.env.FACEBOOK_GRAPH_VERSION || 'v25.0',
  },
  logBufferSize: parseInt(process.env.LOG_BUFFER_SIZE || '200', 10),
};

function reloadConfig() {
  config.port = parseInt(process.env.PORT || '3000', 10);
  config.nodeEnv = process.env.NODE_ENV || 'development';
  config.serviceApiKey = process.env.SERVICE_API_KEY || '';
  config.sessionSecret = process.env.SESSION_SECRET || 'change-me-in-production';
  config.google.clientId = process.env.GOOGLE_CLIENT_ID || '';
  config.google.clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  config.google.redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 3000}/auth/youtube/callback`;
  config.facebook.appId = process.env.FACEBOOK_APP_ID || '';
  config.facebook.appSecret = process.env.FACEBOOK_APP_SECRET || '';
  config.facebook.redirectUri =
    process.env.FACEBOOK_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 3000}/auth/facebook/callback`;
  config.facebook.graphVersion = process.env.FACEBOOK_GRAPH_VERSION || 'v25.0';
  config.logBufferSize = parseInt(process.env.LOG_BUFFER_SIZE || '200', 10);
}

function validateEnv() {
  reloadConfig();
  const errors = [];

  if (config.nodeEnv === 'production') {
    if (!config.serviceApiKey) {
      errors.push('SERVICE_API_KEY is required in production');
    }
    if (config.sessionSecret === 'change-me-in-production') {
      errors.push('SESSION_SECRET must be set in production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }
}

module.exports = { config, validateEnv, reloadConfig };
