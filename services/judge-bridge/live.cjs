const { WebSocketServer, WebSocket } = require('ws');
const { Readable } = require('node:stream');

function attachLive(server, api) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const send = (ws, value) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 65536) return ws.terminate();
    ws.send(JSON.stringify(value));
  };
  function broadcast() {
    for (const ws of wss.clients) {
      if (!ws.identity) continue;
      const data = api.snapshot(ws.identity);
      if (!data) {
        ws.close(1008, 'Pair with the current match');
        continue;
      }
      const json = JSON.stringify(data);
      if (ws.snapshot !== json) {
        ws.snapshot = json;
        send(ws, { type: 'state', data });
      }
    }
  }
  server.on('upgrade', (req, socket, head) => {
    const role =
      req.url === '/live/desktop' ? 'desktop' : req.url === '/live/judge' ? 'judge' : null;
    const allowed =
      role === 'desktop' ? api.isDesktop(req) : req.headers.origin === 'http://' + req.headers.host;
    if (!role || !allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const authentication = setTimeout(() => ws.close(1008, 'Authentication required'), 3000);
      ws.on('error', () => {});
      ws.on('close', () => {
        clearTimeout(authentication);
        api.disconnected(ws.identity);
        broadcast();
      });
      ws.on('message', async (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          if (!ws.identity) {
            if (message.type !== 'auth') return ws.close(1008, 'Authentication required');
            ws.identity = api.authenticate(role, message);
            if (!ws.identity) return ws.close(1008, 'Invalid pairing');
            clearTimeout(authentication);
            broadcast();
            return;
          }
          if (!api.snapshot(ws.identity)) return ws.close(1008, 'Pair with the current match');
          if (message.type === 'heartbeat' && role === 'judge') {
            api.heartbeat(ws.identity);
            send(ws, { type: 'alive' });
            broadcast();
            return;
          }
          if (message.type !== 'request' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.id || ''))
            return ws.close(1008, 'Invalid request');
          const paths =
            role === 'desktop' ? ['/api/desktop/sync'] : ['/api/judge/punch', '/api/judge/state'];
          if (!paths.includes(message.path)) return ws.close(1008, 'Invalid request');
          const request = Readable.from(
            message.data === null ? [] : [JSON.stringify(message.data || {})]
          );
          request.url = message.path;
          request.method = message.data === null ? 'GET' : 'POST';
          request.headers = { ...req.headers, authorization: 'Bearer ' + ws.identity.token };
          request.socket = req.socket;
          const response = {
            status: 200,
            headersSent: false,
            setHeader() {},
            writeHead(status) {
              this.status = status;
              this.headersSent = true;
            },
            end(body) {
              send(ws, {
                type: 'response',
                id: message.id,
                status: this.status,
                data: JSON.parse(body || '{}')
              });
            }
          };
          await api.handle(request, response);
        } catch {
          ws.close(1008, 'Invalid message');
        }
      });
    });
  });
  const maintenance = setInterval(broadcast, 250);
  maintenance.unref();
  return {
    broadcast,
    close() {
      clearInterval(maintenance);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    }
  };
}
module.exports = { attachLive };
