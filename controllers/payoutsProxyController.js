const fetch = require('node-fetch'); // npm i node-fetch@2 om du saknar den

const PAYMENTS_BASE = 'https://stripe-payment-oversvamningsskydd-kund1.onrender.com';  
const SHARED_SECRET = '6820e7bbda77c3b03c2e00fc5ea23f745f02906cc8cb87bfd2a64b011bfbc0cc'; 

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
        'X-Internal-Auth': SHARED_SECRET,     // intern auth till betalningstjänsten
        'Accept': 'application/json'
      }
    });

    const body = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(body);
  } catch (err) { next(err); }
};
