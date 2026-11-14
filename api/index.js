const server = require('../server');

module.exports = (req, res) => {
  try {
    // 1. Restore original requested URL from Vercel rewrite or headers
    const parsed = new URL(req.url, 'http://localhost');
    const origUrl = parsed.searchParams.get('__url') || req.headers['x-matched-path'] || req.headers['x-forwarded-uri'];
    if (origUrl) {
      parsed.searchParams.delete('__url');
      const extraQuery = parsed.searchParams.toString();
      req.url = origUrl + (extraQuery ? (origUrl.includes('?') ? '&' : '?') + extraQuery : '');
    }

    // 2. Replay body stream if Vercel already consumed it (for endpoints that read req.on('data'))
    if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
      const bodyStr = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || '');
      const origOn = req.on.bind(req);
      const dataListeners = [];
      const endListeners = [];

      req.on = req.addListener = function (event, listener) {
        if (event === 'data') {
          dataListeners.push(listener);
          return req;
        }
        if (event === 'end') {
          endListeners.push(listener);
          return req;
        }
        return origOn(event, listener);
      };

      server.emit('request', req, res);

      process.nextTick(() => {
        if (res.headersSent || res.writableEnded) return;
        if (bodyStr.length > 0) {
          dataListeners.forEach(fn => {
            if (!res.headersSent && !res.writableEnded) fn(bodyStr);
          });
        }
        if (!res.headersSent && !res.writableEnded) {
          endListeners.forEach(fn => fn());
        }
      });
      return;
    }

    // 3. Forward request to HTTP server instance
    server.emit('request', req, res);
  } catch (err) {
    console.error('[Vercel API Handler Error]:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }));
    }
  }
};
