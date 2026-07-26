'use strict';

var fs = require('fs');
var http = require('http');
var path = require('path');
var root = path.resolve(__dirname, '..');
var host = '127.0.0.1';
var port = Number(process.env.UI_PREVIEW_PORT || 4173);
var mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml; charset=utf-8' };

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
var server = http.createServer(function(req, res) {
  var rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rawPath === '/' || rawPath === '/ui-prototype/' || rawPath === '/ui-prototype') rawPath = '/ui-prototype/index.html';
  var target = path.resolve(root, '.' + rawPath);
  if (target !== root && target.indexOf(root + path.sep) !== 0) { send(res, 403, 'Forbidden'); return; }
  fs.stat(target, function(statErr, stat) {
    if (statErr || !stat.isFile()) { send(res, 404, 'Not found'); return; }
    fs.readFile(target, function(readErr, data) {
      if (readErr) { send(res, 500, 'Cannot read file'); return; }
      send(res, 200, data, mime[path.extname(target).toLowerCase()] || 'application/octet-stream');
    });
  });
});
server.listen(port, host, function() {
  console.log('UI prototype: http://' + host + ':' + port + '/ui-prototype/');
  console.log('Press Ctrl+C to stop.');
});
