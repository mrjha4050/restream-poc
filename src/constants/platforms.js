const PLATFORMS = {
  youtube: { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2/' },
  twitch: { name: 'Twitch', url: 'rtmp://live.twitch.tv/live/' },
  facebook: { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
  custom: { name: 'Custom', url: '' },
};

function isValidPlatform(platformId) {
  return Object.prototype.hasOwnProperty.call(PLATFORMS, platformId);
}

function platformLabel(platformId) {
  return PLATFORMS[platformId]?.name || platformId;
}

function buildOutputUrl(platformId, key, customUrl = '') {
  if (platformId === 'custom') {
    return (customUrl || '') + key;
  }
  const base = PLATFORMS[platformId]?.url || '';
  return base + key;
}

function listPlatforms() {
  return Object.keys(PLATFORMS).map((key) => ({
    id: key,
    name: PLATFORMS[key].name,
    url: PLATFORMS[key].url,
  }));
}

module.exports = {
  PLATFORMS,
  isValidPlatform,
  platformLabel,
  buildOutputUrl,
  listPlatforms,
};
