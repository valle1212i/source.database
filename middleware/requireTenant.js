// middleware/requireTenant.js
module.exports = function requireTenant(req, res, next) {
    const user = req.user || req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Inte inloggad.' });
    }
  
    // Läs från user -> header -> query -> body -> subdomän
    let t =
      (user.tenant ? String(user.tenant).trim() : '') ||
      (req.get('X-Tenant') || '').trim() ||
      (req.query?.tenant || '').trim() ||
      (req.body?.tenant || '').trim();
  
    if (!t) {
      const host = (req.headers.host || '').toLowerCase().split(':')[0]; // ta bort ev. port
      const m = host.match(/^([a-z0-9-]+)\./i);
      if (m && m[1] && m[1] !== 'www') t = m[1];
    }
  
    if (!t) {
      return res.status(400).json({ success: false, message: 'Tenant saknas' });
    }
  
    // Icke-admin får inte hoppa mellan tenants
    if (user.role !== 'admin' && user.tenant && String(t).toLowerCase() !== String(user.tenant).toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Åtkomst nekad' });
    }
  
    req.tenant = String(t).trim().toLowerCase();
    next();
  };
  