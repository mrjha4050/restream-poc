const { listPlatforms } = require('../constants/platforms');

function getPlatforms(req, res) {
  res.json(listPlatforms());
}

module.exports = {
  getPlatforms,
};
