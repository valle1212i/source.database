// /controllers/payoutsController.js
const { listPayouts } = require('../services/stripeService');

exports.list = async (req, res, next) => {
  try {
        const tenant = req.tenant;   // sätts av requireTenant
    if (!tenant) {
      return res.status(400).json({ success:false, message:'Tenant saknas. Skicka X-Tenant header.' });
    }
    const { starting_after } = req.query;
    const page = await listPayouts(tenant, { starting_after, limit: 30 });
    res.json({ data: page.data, has_more: page.has_more });
  } catch (err) {
          console.error('GET /api/payouts failed', {
                  tenant: req.tenant,
                  msg: err?.message, code: err?.code, type: err?.type, statusCode: err?.statusCode
                });
                next(err);
  }
};
