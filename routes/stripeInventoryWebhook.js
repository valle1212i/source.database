// routes/stripeInventoryWebhook.js
const express = require('express');
const Stripe = require('stripe');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');

const router = express.Router();

// Rå body krävs för signering; montera denna route med raw body i server.js.
const rawBody = express.raw({ type: 'application/json' });

// Lägg in dina keys innan aktivering
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET_INVENTORY || null;

// Minimal tolkningsfunktion (du kan bygga ut med expand senare)
function parseAdjustments(event) {
  const arr = [];
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const tenant = s?.metadata?.tenant || s?.metadata?.TENANT || null;
    const sku = s?.metadata?.sku || null;
    if (sku) arr.push({ tenant, sku, quantity: 1, reason: 'purchase' });
  }
  if (event.type === 'refund.succeeded' || event.type === 'charge.refunded') {
    const c = event.data.object;
    const tenant = c?.metadata?.tenant || c?.metadata?.TENANT || null;
    const sku = c?.metadata?.sku || null;
    if (sku) arr.push({ tenant, sku, quantity: 1, reason: 'return' });
  }
  return arr;
}

router.post('/webhooks/stripe-inventory', rawBody, async (req, res) => {
  // Om Stripe inte är konfigurerat ännu, acceptera tyst
  if (!stripe || !endpointSecret) return res.json({ received: true, disabled: true });

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const adjustments = parseAdjustments(event);
  if (!adjustments.length) return res.json({ received: true, skipped: true });

  const stripeEventId = event.id;
  const results = [];
  for (const adj of adjustments) {
    const tenant = adj.tenant || 'default';
    const sku = adj.sku;
    const qty = Math.max(1, Number(adj.quantity) || 1);
    const delta = adj.reason === 'purchase' ? -qty : +qty;

    const existing = await InventoryMovement.findOne({ tenant, stripeEventId });
    if (existing) { results.push({ tenant, sku, idempotent: true }); continue; }

    const item = await InventoryItem.findOne({ tenant, $or: [{ sku }, { 'variants.sku': sku }] });
    if (!item) { results.push({ tenant, sku, error: 'SKU ej hittad' }); continue; }

    if (item.variants && item.variants.length > 0) {
      const idx = item.variants.findIndex(v => v.sku === sku);
      if (idx >= 0) item.variants[idx].stock = Math.max(0, (item.variants[idx].stock || 0) + delta);
    } else {
      item.stock = Math.max(0, (item.stock || 0) + delta);
    }
    await item.save();

    await InventoryMovement.create({
      tenant, itemId: item._id, variantSku: sku,
      delta: delta > 0 ? 1 : -1, reason: adj.reason,
      stripeEventId, meta: { eventType: event.type }
    });

    results.push({ tenant, sku, ok: true });
  }

  res.json({ received: true, results });
});

module.exports = { router, rawBody };
