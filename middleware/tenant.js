// middleware/tenant.js
module.exports = function tenantMiddleware(req, res, next) {
  const token   = req.headers['x-auth-token'];
  const session = req.app.get('activeSessions')?.get(token);

  if (!session?.tenantId) {
    return res.status(401).json({ error: 'Oturum bulunamadı' });
  }

  req.tenantId = session.tenantId;
  req.userId   = session.userId;
  req.userRole = session.role;
  next();
};