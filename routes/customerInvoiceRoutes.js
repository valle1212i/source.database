// routes/customerInvoiceRoutes.js
// Kundens egna fakturor (till deras kunder) – Stripe Connect-redo via service-modul.
// Frontend POST: /api/customer-invoices

const express = require('express');
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');
const { createHostedInvoice } = require('../services/stripeCustomerInvoices');

const router = express.Router();

// ────────────────────────────────────────────────────────────────
// Validering
const itemSchema = z.object({
  description: z.string().min(1, 'beskrivning krävs').max(500).trim(),
  amount_minor: z.number().int().nonnegative(), // belopp i ören/”minor units”
  currency: z.string().length(3).transform(s => s.toUpperCase())
});

const createSchema = z.object({
  customer_name: z.string().min(1, 'kundnamn krävs').max(200).trim(),
  customer_email: z.string().email('ogiltig e-post'),
  items: z.array(itemSchema).min(1, 'minst en rad krävs')
});

// ────────────────────────────────────────────────────────────────
// Hjälp: hämta tenant/user + stripeAccountId utan att gissa för mycket
function getTenantId(req) {
  return req.tenant?.id || req.tenant?._id || req.tenantId || null;
}
function getUserId(req) {
  return req.user?.id || req.user?._id || req.session?.user?._id || req.session?.user?.id || null;
}
function getStripeAccountId(req) {
    return (
      req.tenantStripeAccountId ||
      req.tenantInfo?.stripeAccountId ||
      req.tenant?.stripeAccountId ||
      req.tenant?.stripe_account_id ||
      req.tenant?.stripe_account ||
      req.tenant?.stripe?.accountId ||
      null
    );
  }
  

// ────────────────────────────────────────────────────────────────
// POST /api/customer-invoices
router.post('/', requireAuth, requireTenant, express.json(), async (req, res) => {
  try {
    const parse = createSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ message: 'Felaktig body', issues: parse.error.flatten() });
    }
    const { customer_name, customer_email, items } = parse.data;

    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    if (!tenantId || !userId) {
      return res.status(401).json({ message: 'Saknar behörighet (tenant eller user saknas)' });
    }

    // Hämta Stripe-nyckel från env och tenantens Connect-konto-id
    const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
    const stripeAccountId = getStripeAccountId(req);

    // Anropa service – returnerar stub om stripeSecret/stripeAccountId saknas
    const result = await createHostedInvoice({
      stripeSecret,
      stripeAccountId,
      customer_name,
      customer_email,
      items,
      days_until_due: 14
    });

    // Om stub, ge ett tydligt men 200-svar (frontend redan förberedd att hantera)
    if (result.stub) {
      return res.status(200).json({
        invoice_id: result.invoice_id,
        hosted_invoice_url: result.hosted_invoice_url,
        stub: true,
        message: 'Stripe är inte aktiverat ännu för denna tenant. Fakturan skapades inte mot betalväxeln.'
      });
    }

    // “Riktigt” svar
    return res.status(200).json({
      invoice_id: result.invoice_id,
      hosted_invoice_url: result.hosted_invoice_url
    });
  } catch (err) {
    console.error('❌ Fel vid POST /api/customer-invoices:', err);
    return res.status(500).json({ message: 'Serverfel' });
  }
});

module.exports = router;
