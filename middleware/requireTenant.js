// middleware/requireTenant.js
module.exports = function requireTenant(req, res, next) {
    const user = req.user || req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Inte inloggad.' });
    }
  
    const fromHeader = req.get('X-Tenant');
    const fromQuery  = req.query.tenant;
    const fromBody   = req.body?.tenant;
    const resolved   = fromHeader || fromQuery || fromBody || user.tenant || null;
  
    // Icke-admin måste alltid ha en tenant
    if (!resolved && user.role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Tenant saknas.' });
    }
  
    // Icke-admin får inte låtsas tillhöra en annan tenant
    if (user.role !== 'admin' && user.tenant && resolved && resolved !== user.tenant) {
      return res.status(403).json({ success: false, message: 'Åtkomst nekad' });
    }
  
    req.tenant = resolved || null; // admin kan ha null => alla tenants
    next();
  };
  