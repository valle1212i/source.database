// controllers/payoutsProxyController.js (CommonJS)
const PAYMENTS_BASE = process.env.PAYMENTS_BASE_URL;
const SHARED_SECRET = process.env.X_PAYMENTS_SECRET;

exports.list = async (req, res, next) => {
  try {
    if (!PAYMENTS_BASE) throw new Error('PAYMENTS_BASE_URL saknas');
    if (!SHARED_SECRET) throw new Error('X_PAYMENTS_SECRET saknas');

    const tenant = req.tenant || req.get('X-Tenant');
    if (!tenant) return res.status(400).json({ success:false, message:'Tenant saknas' });

    const qs = req.query.starting_after ? `?starting_after=${encodeURIComponent(req.query.starting_after)}` : '';
    const url = `${PAYMENTS_BASE}/api/payouts${qs}`;

    const r = await fetch(url, {
      headers: {
        'X-Tenant': tenant,
        'X-Internal-Auth': SHARED_SECRET,
        'Accept': 'application/json'
      }
    });

    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (err) { next(err); }
};

exports.detail = async (req, res, next) => {
  try {
    const tenant = req.tenant || req.get('X-Tenant');
    if (!tenant) return res.status(400).json({ success:false, message:'Tenant saknas' });

    const url = `${PAYMENTS_BASE}/api/payouts/${encodeURIComponent(req.params.id)}`;
    const r = await fetch(url, {
      headers: {
        'X-Internal-Auth': SHARED_SECRET,
        'X-Tenant': tenant,
        'Accept': 'application/json',
      }
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (err) { next(err); }
};

exports.transactions = async (req, res, next) => {
  try {
    const tenant = req.tenant || req.get('X-Tenant');
    if (!tenant) return res.status(400).json({ success:false, message:'Tenant saknas' });

    const qs = new URLSearchParams();
    if (req.query.starting_after) qs.set('starting_after', req.query.starting_after);
    if (req.query.limit) qs.set('limit', req.query.limit);

    const url = `${PAYMENTS_BASE}/api/payouts/${encodeURIComponent(req.params.id)}/transactions${qs.toString() ? `?${qs}` : ''}`;
    const r = await fetch(url, {
      headers: {
        'X-Internal-Auth': SHARED_SECRET,
        'X-Tenant': tenant,
        'Accept': 'application/json',
      }
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (err) { next(err); }
};
