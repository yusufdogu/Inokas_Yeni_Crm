// middleware/tenant.js
'use strict';

module.exports = function tenantMiddleware(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/auth')) return next();

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token eksik.' });

  const supabase = req.app.get('supabase');

  supabase
    .from('sessions')
    .select('user_id, tenant_id, role, expires_at')
    .eq('token', token)
    .single()
    .then(({ data: session, error }) => {
      if (error || !session)
        return res.status(401).json({ error: 'Oturum bulunamadı veya süresi doldu.' });

      if (new Date(session.expires_at) < new Date())
        return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.' });

      req.tenantId = session.tenant_id;
      req.userId   = session.user_id;
      req.userRole = session.role;
      next();
    })
    .catch(err => {
      console.error('[tenant] DB hatası:', err.message);
      res.status(500).json({ error: 'Sunucu hatası.' });
    });
};