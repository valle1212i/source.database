// /controllers/payoutsController.js
const { listPayouts } = require('../services/stripeService');

exports.list = async (req, res, next) => {
  try {
    const tenant = req.tenant; // sätts av /middleware/requireTenant
    const { starting_after } = req.query;
    const page = await listPayouts(tenant, { starting_after, limit: 30 });
    res.json({ data: page.data, has_more: page.has_more });
  } catch (err) {
    next(err);
  }
};
