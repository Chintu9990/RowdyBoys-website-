function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function logAction(adminId, action, details) {
  const db = require('../database/db');
  try {
    db.prepare('INSERT INTO audit_logs (admin_id, action, details) VALUES (?,?,?)')
      .run(adminId || null, action, details || '');
  } catch (e) { /* ignore */ }
}

module.exports = { requireAdmin, logAction };