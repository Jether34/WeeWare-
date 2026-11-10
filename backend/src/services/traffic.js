const flows = new Map();
const recent = [];
const MAX_RECENT = 1000;
let totalEvents = 0;
let io = null;

function attachSocket(socketServer) { io = socketServer; }

function recordFlow({ source, destination, type, label, status = 'ok', durationMs = 0 }) {
  const key = `${source}->${destination}`;
  const flow = flows.get(key) || { source, destination, count: 0, failures: 0, totalDurationMs: 0, lastAt: null };
  flow.count += 1;
  if (status !== 'ok') flow.failures += 1;
  flow.totalDurationMs += Math.max(0, Number(durationMs) || 0);
  flow.lastAt = new Date().toISOString();
  flows.set(key, flow);
  totalEvents += 1;
  const event = { id: `${Date.now()}-${totalEvents}`, at: flow.lastAt, source, destination, type, label: String(label || '').slice(0, 100), status, durationMs: Math.round(Number(durationMs) || 0) };
  recent.unshift(event);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  io?.to('role:admin').emit('admin:traffic', { event, flow: summarizeFlows()[key], totalEvents });
}

function summarizeFlows() {
  return Object.fromEntries([...flows.entries()].map(([key, flow]) => [key, { ...flow, averageDurationMs: flow.count ? Math.round(flow.totalDurationMs / flow.count) : 0 }]));
}

function snapshot() { return { totalEvents, flows: summarizeFlows(), recent: [...recent] }; }

function trafficMiddleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path.replace(/[a-f\d]{24}/gi, ':id').replace(/\d{4,}/g, ':n');
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    recordFlow({ source: 'Web client', destination: 'WeeWare API', type: 'http', label: `${req.method} ${route}`, status: res.statusCode < 400 ? 'ok' : 'error', durationMs });
  });
  next();
}

async function trackedFetch(url, options = {}) {
  const started = process.hrtime.bigint();
  const target = new URL(url);
  const label = `${options.method || 'GET'} ${target.pathname}`;
  try {
    const response = await fetch(url, options);
    recordFlow({ source: 'WeeWare API', destination: target.port === '27017' ? 'MongoDB' : 'Climate / LASSO service', type: 'service', label, status: response.ok ? 'ok' : 'error', durationMs: Number(process.hrtime.bigint() - started) / 1e6 });
    return response;
  } catch (error) {
    recordFlow({ source: 'WeeWare API', destination: 'Climate / LASSO service', type: 'service', label, status: 'error', durationMs: Number(process.hrtime.bigint() - started) / 1e6 });
    throw error;
  }
}

module.exports = { attachSocket, recordFlow, snapshot, trafficMiddleware, trackedFetch };
