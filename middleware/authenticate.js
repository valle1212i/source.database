function requireAuth(req, res, next) {
  const u = req.session?.user;
  if (!u?._id) {
    return res.status(401).json({ success: false, message: "Inte inloggad." });
  }

  // Minimera PII i req.user (håll e-post i sessionen, inte här)
  const minimal = { _id: u._id, role: u.role || 'user', name: u.name || '' };
  Object.freeze(minimal);
  req.user = minimal;
  res.locals.userRole = minimal.role;

  return next();
}

module.exports = requireAuth;
