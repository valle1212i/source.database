// middleware/requireTenant.js
module.exports = function requireTenant(req, _res, next) {
    const user = req.user || req.session?.user || null;
  
    // 1) Plocka ut möjliga källor
    const header  = (req.get('X-Tenant') || '').trim().toLowerCase();
    const query   = (req.query?.tenant || '').trim().toLowerCase();
    const body    = (req.body?.tenant || '').trim().toLowerCase();
    const session = (req.session?.tenant || '').trim().toLowerCase();
    const userTen = (user?.tenant || '').trim().toLowerCase();
  
    // subdomän: acme.domain.tld -> "acme"
    let sub = '';
    const host = (req.headers.host || '').toLowerCase().split(':')[0];
    const m = host.match(/^([a-z0-9-]+)\./i);
    if (m && m[1] && m[1] !== 'www') sub = m[1].toLowerCase();
  
    // 2) Prioritetsordning
    let t = header || query || body || session || userTen || sub || null;
  
    // 3) Om användaren inte är admin men HAR tenant → forcera den
    if (user && user.role !== 'admin' && userTen) {
      t = userTen;
    }
  
    // 4) Sätt på req + spegla in i session för senare rutter
    req.tenant = t || null;
    if (t && req.session) req.session.tenant = t;
  
    // Viktigt: kasta INTE 400 här. Låt rutter avgöra hur null hanteras.
    return next();
  };
  