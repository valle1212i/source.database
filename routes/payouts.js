// /routes/payouts.js
const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');
const payouts = require('../controllers/payoutsController');

router.get('/', requireAuth, requireTenant, payouts.list); // ?starting_after=po_xxx

module.exports = router;
