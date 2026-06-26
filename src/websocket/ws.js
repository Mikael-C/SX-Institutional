const WebSocket = require('ws');

let wss = null;
const channelSubscriptions = new Map();

const VALID_CHANNELS = ['prices', 'positions', 'rewards', 'frog', 'funding', 'orders', 'admin'];

function setupWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientId = generateClientId();
    ws.clientId = clientId;
    ws.subscribedChannels = new Set();
    ws.isAlive = true;

    console.log(`[WS] Client connected: ${clientId}`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(ws, message);
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format. Expected JSON.'
        }));
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Client disconnected: ${clientId}`);
      for (const channel of ws.subscribedChannels) {
        const subs = channelSubscriptions.get(channel);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) channelSubscriptions.delete(channel);
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client error ${clientId}:`, err.message);
    });

    ws.send(JSON.stringify({
      type: 'connected',
      clientId: clientId,
      availableChannels: VALID_CHANNELS,
      message: 'Connected to SX Omni Chain WebSocket. Subscribe to channels using { "action": "subscribe", "channel": "<channel_name>" }'
    }));
  });

  const heartbeat = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        console.log(`[WS] Terminating inactive client: ${ws.clientId}`);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  console.log('[WS] WebSocket server initialized');
  return wss;
}

function handleClientMessage(ws, message) {
  const { action, channel } = message;

  switch (action) {
    case 'subscribe':
      if (!channel || !VALID_CHANNELS.includes(channel)) {
        ws.send(JSON.stringify({
          type: 'error',
          error: `Invalid channel. Available: ${VALID_CHANNELS.join(', ')}`
        }));
        return;
      }
      if (!channelSubscriptions.has(channel)) {
        channelSubscriptions.set(channel, new Set());
      }
      channelSubscriptions.get(channel).add(ws);
      ws.subscribedChannels.add(channel);
      ws.send(JSON.stringify({
        type: 'subscribed',
        channel: channel,
        message: `Subscribed to ${channel}`
      }));
      console.log(`[WS] Client ${ws.clientId} subscribed to ${channel}`);
      break;

    case 'unsubscribe':
      if (!channel) return;
      const subs = channelSubscriptions.get(channel);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) channelSubscriptions.delete(channel);
      }
      ws.subscribedChannels.delete(channel);
      ws.send(JSON.stringify({
        type: 'unsubscribed',
        channel: channel,
        message: `Unsubscribed from ${channel}`
      }));
      console.log(`[WS] Client ${ws.clientId} unsubscribed from ${channel}`);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    default:
      ws.send(JSON.stringify({
        type: 'error',
        error: `Unknown action: ${action}. Available actions: subscribe, unsubscribe, ping`
      }));
  }
}

function broadcast(channel, data) {
  if (!wss) return;

  const message = JSON.stringify({
    type: 'update',
    channel: channel,
    data: data,
    timestamp: new Date().toISOString()
  });

  const subscribers = channelSubscriptions.get(channel);
  if (subscribers) {
    let sent = 0;
    subscribers.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        sent++;
      }
    });
    if (sent > 0) {
      console.log(`[WS] Broadcast to ${sent} clients on channel: ${channel}`);
    }
  }
}

function broadcastAll(data) {
  if (!wss) return;
  const message = JSON.stringify({
    type: 'broadcast',
    data: data,
    timestamp: new Date().toISOString()
  });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

function getConnectionCount() {
  if (!wss) return 0;
  return wss.clients.size;
}

function getChannelStats() {
  const stats = {};
  for (const channel of VALID_CHANNELS) {
    const subs = channelSubscriptions.get(channel);
    stats[channel] = subs ? subs.size : 0;
  }
  return stats;
}

function generateClientId() {
  return 'ws_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
}

module.exports = {
  setupWebSocket,
  broadcast,
  broadcastAll,
  getConnectionCount,
  getChannelStats
};
