// routes/invoiceRoutes.js
// Endpoints för Source → kundens fakturor mot Source.
// Frontend anropar: GET /api/invoices?status=paid|unpaid|overdue
//                   GET /api/invoices/:id/pdf
// Inga testdata. Tom lista tills DB/Stripe kopplas.

const express = require('express');
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');

const router = express.Router();

// ────────────────────────────────────────────────────────────────
// Validering
const listQuerySchema = z.object({
  status: z.enum(['paid', 'unpaid', 'overdue'], {
    invalid_type_error: 'status måste vara paid, unpaid eller overdue',
    required_error: 'status är obligatoriskt'
  })
});

const idParamSchema = z.object({
  id: z.string().min(1, 'id saknas')
});

// ────────────────────────────────────────────────────────────────
// Hjälp: hämta tenant-id (utan att gissa fältnamn)
function getTenantId(req) {
  // Anpassa här om requireTenant sätter annan egenskap
  return req.tenant?.id || req.tenant?._id || req.tenantId || null;
}
function getUserId(req) {
  return req.user?.id || req.user?._id || req.session?.user?._id || req.session?.user?.id || null;
}

// ────────────────────────────────────────────────────────────────
// GET /api/invoices?status=paid|unpaid|overdue
router.get('/', requireAuth, requireTenant, async (req, res) => {
  try {
    const parse = listQuerySchema.safeParse(req.query);
    if (!parse.success) {
      return res.status(400).json({ message: 'Felaktiga parametrar', issues: parse.error.flatten() });
    }
    const { status } = parse.data;

    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    if (!tenantId || !userId) {
      return res.status(401).json({ message: 'Saknar behörighet (tenant eller user saknas)' });
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
    const stripeAccountId = getStripeAccountId(req);
    const stripeCustomerId = getStripeCustomerId(req);

    // Utan Stripe-koppling eller utan kundens stripeCustomerId → returnera tom lista
    if (!stripeSecret || !stripeAccountId || !stripeCustomerId) {
      return res.json({ data: [] });
    }

    const stripe = initStripe(stripeSecret);

    // Vi behöver sannolikt lista per status:
    // - paid: Stripe status 'paid'
    // - unpaid: Stripe 'open' och inte förfallen
    // - overdue: Stripe 'open' men förfallen + 'uncollectible'
    //
    // Vi hämtar open + paid + uncollectible (begränsat) och filtrerar i appen,
    // för att korrekt särskilja "overdue" (baserat på due_date).
    const wanted = ['paid', 'open', 'uncollectible'];
    const results = [];

    for (const stripeStatus of wanted) {
      // Begränsa listan – anpassa limit efter behov
      const resp = await stripe.invoices.list(
        { customer: stripeCustomerId, status: stripeStatus, limit: 50 },
        { stripeAccount: stripeAccountId }
      );
      if (Array.isArray(resp?.data)) {
        results.push(...resp.data);
      }
    }

    // Filtrera till den kategori som frontend begärde
    const filtered = results.filter(inv => {
      const uiStatus = mapStripeStatusToUi(inv); // 'paid'|'unpaid'|'overdue'
      return uiStatus === status;
    });

    const data = filtered.map(mapStripeInvoiceToDTO);
    return res.json({ data });
  } catch (err) {
    console.error('❌ Fel vid GET /api/invoices:', err);
    return res.status(500).json({ message: 'Serverfel' });
  }
});


// ────────────────────────────────────────────────────────────────
// GET /api/invoices/:id/pdf → redirect till Stripe invoice_pdf om möjligt
router.get('/:id/pdf', requireAuth, requireTenant, async (req, res) => {
  try {
    const parse = idParamSchema.safeParse(req.params);
    if (!parse.success) {
      return res.status(400).json({ message: 'Felaktiga parametrar', issues: parse.error.flatten() });
    }
    const { id } = parse.data;

    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    if (!tenantId || !userId) {
      return res.status(401).json({ message: 'Saknar behörighet (tenant eller user saknas)' });
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
    const stripeAccountId = getStripeAccountId(req);
    const stripeCustomerId = getStripeCustomerId(req);

    // Utan Stripe eller utan kundkoppling → 404 (ingen PDF)
    if (!stripeSecret || !stripeAccountId || !stripeCustomerId) {
      return res.status(404).json({ message: 'PDF ej tillgänglig ännu' });
    }

    const stripe = initStripe(stripeSecret);
    const inv = await stripe.invoices.retrieve(id, { stripeAccount: stripeAccountId });

    // Säkerställ att fakturan faktiskt tillhör denna kund (försvar-in-depth)
    if (inv.customer !== stripeCustomerId) {
      return res.status(403).json({ message: 'Åtkomst nekad för denna faktura' });
    }

    // Stripe ger en signerad invoice_pdf-URL. Vi kan 302-redirecta dit.
    if (inv?.invoice_pdf) {
      return res.redirect(302, inv.invoice_pdf);
    }

    // Fallback: ingen PDF
    return res.status(404).json({ message: 'PDF saknas för denna faktura' });
  } catch (err) {
    console.error('❌ Fel vid GET /api/invoices/:id/pdf:', err);
    return res.status(500).json({ message: 'Serverfel' });
  }
});


// ────────────────────────────────────────────────────────────────
// Stripe-hjälpare och mapping

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

function getStripeCustomerId(req) {
  // Källa för kundens Stripe Customer-id (gissar inte – stöd flera namn)
  return (
    req.user?.stripeCustomerId ||
    req.user?.stripe_customer_id ||
    req.session?.user?.stripeCustomerId ||
    req.session?.user?.stripe_customer_id ||
    null
  );
}
function initStripe(secret) {
  const stripe = require('stripe')(secret, {
    httpClient: require('stripe/lib/net/HttpClient.js').createNodeHttpClient(30_000),
    maxNetworkRetries: 2
  });
  return stripe;
}
function mapStripeStatusToUi(inv) {
  // Stripe status: 'draft'|'open'|'paid'|'uncollectible'|'void'
  // "Overdue" i UI: obetald och förfallodatum har passerat (open + due_date < nu) eller 'uncollectible'
  const s = (inv.status || '').toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);
  const due = inv.due_date || null;

  if (s === 'paid') return 'paid';
  if (s === 'uncollectible') return 'overdue';
  if (s === 'open') {
    if (typeof due === 'number' && due > 0 && due < nowSec) return 'overdue';
    return 'unpaid';
  }
  // 'draft' och 'void' räknas inte som kundens betalbara fakturor – markera som unpaid för säkerhets skull
  return 'unpaid';
}
function mapStripeInvoiceToDTO(inv) {
  // amount_total till UI: välj ett robust värde
  // - för paid: amount_paid (faktiskt betalt)
  // - annars: amount_due om finns, fall back till amount_remaining eller total
  let amountMinor = 0;
  if ((inv.status || '').toLowerCase() === 'paid' && typeof inv.amount_paid === 'number') {
    amountMinor = inv.amount_paid;
  } else if (typeof inv.amount_due === 'number') {
    amountMinor = inv.amount_due;
  } else if (typeof inv.amount_remaining === 'number') {
    amountMinor = inv.amount_remaining;
  } else if (typeof inv.total === 'number') {
    amountMinor = inv.total;
  }

  return {
    id: inv.id,
    number: inv.number || `#${String(inv.id || '').slice(-6)}`,
    date: inv.created ? new Date(inv.created * 1000).toISOString() : null,
    currency: (inv.currency || 'sek').toUpperCase(),
    amount_total: amountMinor,
    status: mapStripeStatusToUi(inv), // 'paid' | 'unpaid' | 'overdue'
    hosted_invoice_url: inv.hosted_invoice_url || null
  };
}


module.exports = router;
