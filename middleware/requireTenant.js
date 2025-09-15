// middleware/requireTenant.js
module.exports = function requireTenant(req, res, next) {
    // Kräver att auth-mw redan har satt req.user (via requireAuth)
    const user = req.user || req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Inte inloggad.' });
    }
  
    const fromHeader = req.get('X-Tenant');
    const fromQuery  = req.query.tenant;
    const resolved   = fromHeader || fromQuery || user.tenant || null;
  
    if (!resolved && user.role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Tenant saknas.' });
    }
  
    // Icke-admin måste hålla sig till sin egen tenant
    if (user.role !== 'admin' && user.tenant && resolved && resolved !== user.tenant) {
      return res.status(403).json({ error: 'Åtkomst nekad' });
    }
  
    req.tenant = resolved || null; // admin kan ha null => alla tenants
    next();
  };
  