// routes/payouts.js (Kundportalen)
const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');
const payouts = require('../controllers/payoutsProxyController'); // { list, detail, transactions }

router.get('/', requireAuth, requireTenant, payouts.list);
router.get('/:id', requireAuth, requireTenant, payouts.detail);
router.get('/:id/transactions', requireAuth, requireTenant, payouts.transactions);

module.exports = router;
