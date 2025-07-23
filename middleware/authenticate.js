function authenticate(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.status(401).json({ success: false, message: "Inte inloggad." });
  }
}

module.exports = authenticate;
