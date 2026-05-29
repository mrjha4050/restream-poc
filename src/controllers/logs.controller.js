const { getLogs, subscribe } = require('../services/log.service');

function getHistoricalLogs(req, res) {
  res.json(getLogs());
}

function streamLogs(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(':ping\n\n');

  const unsubscribe = subscribe(res);

  req.on('close', () => {
    unsubscribe();
  });
}

module.exports = {
  getHistoricalLogs,
  streamLogs,
};
