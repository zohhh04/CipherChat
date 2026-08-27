const router = require('express').Router();
const ctrl = require('../controllers/admin.controller');
const { validate } = require('../middleware/error.middleware');
const { z } = require('zod');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

router.use(requireAuth, requireAdmin);

router.get('/stats', ctrl.stats);

router.get(
  '/users',
  validate({ query: z.object({ q: z.string().max(64).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }) }),
  ctrl.listUsers
);
router.patch('/users/:id/status', validate({ params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }), body: z.object({ banned: z.boolean() }).strict() }), ctrl.setUserStatus);
router.patch('/users/:id/role', validate({ params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }), body: z.object({ role: z.enum(['user', 'admin']) }).strict() }), ctrl.setUserRole);

router.get('/logs', ctrl.listAuditLogs);
router.get('/sessions', ctrl.listSessions);
router.delete('/sessions/:id', ctrl.revokeAnySession);

module.exports = router;
