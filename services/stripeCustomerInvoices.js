// services/stripeCustomerInvoices.js
// Samlad Stripe-Connect-logik för att skapa Hosted Invoice Page åt en tenant-säljare.
// Denna modul gör inga antaganden om var stripeAccountId kommer från – skicka in det från routern.
// Säkert stubbläge: om stripeSecret eller stripeAccountId saknas returneras ett neutralt 200-svar.

const crypto = require('crypto');

/**
 * Skapa Hosted Invoice (Stripe) eller stub om nycklar saknas.
 *
 * @param {Object} args
 * @param {string} args.stripeSecret            - Platformens STRIPE_SECRET_KEY (skickas från env i routern).
 * @param {string} args.stripeAccountId         - Tenantens Stripe Connect account id (ex: acct_123).
 * @param {string} args.customer_name
 * @param {string} args.customer_email
 * @param {Array<{description:string, amount_minor:number, currency:string}>} args.items
 * @param {number} [args.days_until_due=14]
 * @returns {Promise<{ invoice_id: string|null, hosted_invoice_url: string|null, stub: boolean }>}
 */
async function createHostedInvoice(args) {
  const {
    stripeSecret,
    stripeAccountId,
    customer_name,
    customer_email,
    items,
    days_until_due = 14
  } = args || {};

  // Stubbläge: ingen Stripe-koppling ännu
  if (!stripeSecret || !stripeAccountId) {
    return {
      invoice_id: null,
      hosted_invoice_url: null,
      stub: true
    };
  }

  // Initiera Stripe SDK först här (undvik global init så testning blir enklare)
  const stripe = require('stripe')(stripeSecret, {
    // Rekommenderade timeouts för nätproblem
    httpClient: require('stripe/lib/net/HttpClient.js').createNodeHttpClient(30_000),
    maxNetworkRetries: 2
  });

  // Skapa en idempotency key för hela flödet (enkelt sätt: pr request)
  const idemKey = `ci_${crypto.randomUUID()}`;

  // 1) Skapa/eller återanvänd en Customer
  //    En enkel approach: försök hitta med e-post, annars skapa.
  //    OBS: e-post är inte garanterat unik – produktion kan behöva mer robust lookup.
  let customer;
  const searchQuery = `email:'${escapeStripeSearch(customer_email)}'`;
  const searchRes = await safeStripeCall(
    () => stripe.customers.search({ query: searchQuery }, { stripeAccount: stripeAccountId }),
    'customers.search'
  );

  if (searchRes?.data?.length) {
    customer = searchRes.data[0];
  } else {
    customer = await safeStripeCall(
      () => stripe.customers.create(
        { name: customer_name, email: customer_email },
        {
          stripeAccount: stripeAccountId,
          idempotencyKey: idemKey + ':customer'
        }
      ),
      'customers.create'
    );
  }

  // 2) Skapa invoice items (en per rad)
  //    Stripe tar belopp i "minor units" (öre) för SEK.
  for (const [i, it] of items.entries()) {
    if (!it || typeof it.amount_minor !== 'number' || it.amount_minor < 0) continue;
    await safeStripeCall(
      () => stripe.invoiceItems.create(
        {
          customer: customer.id,
          currency: (it.currency || 'SEK').toLowerCase(),
          unit_amount: it.amount_minor,
          description: it.description || undefined
        },
        {
          stripeAccount: stripeAccountId,
          idempotencyKey: `${idemKey}:ii:${i}`
        }
      ),
      'invoiceItems.create'
    );
  }

  // 3) Skapa fakturan (utkast) och sätt att den ska skickas
  const invoice = await safeStripeCall(
    () => stripe.invoices.create(
      {
        customer: customer.id,
        collection_method: 'send_invoice',
        days_until_due: Math.max(0, Number.isFinite(days_until_due) ? days_until_due : 14)
      },
      {
        stripeAccount: stripeAccountId,
        idempotencyKey: idemKey + ':invoice'
      }
    ),
    'invoices.create'
  );

  // 4) Finalisera och plocka Hosted Invoice URL
  const finalized = await safeStripeCall(
    () => stripe.invoices.finalizeInvoice(invoice.id, { stripeAccount: stripeAccountId }),
    'invoices.finalize'
  );

  return {
    invoice_id: finalized?.id || invoice?.id || null,
    hosted_invoice_url: finalized?.hosted_invoice_url || null,
    stub: false
  };
}

/**
 * Hjälpfunktion: säker Stripe-anropare som fångar fel och kastar med prefix
 */
async function safeStripeCall(fn, label) {
  try {
    return await fn();
  } catch (err) {
    // Logga lätt men utan hemligheter
    console.error(`Stripe error in ${label}:`, redactStripeError(err));
    throw new Error('Ett fel uppstod vid kommunikation med betalväxeln.');
  }
}

/**
 * Enkel felredaktör – läcker inte hemligheter
 */
function redactStripeError(err) {
  if (!err || typeof err !== 'object') return err;
  const out = {
    type: err.type,
    message: err.message,
    code: err.code,
    param: err.param,
    statusCode: err.statusCode
  };
  return out;
}

/**
 * Hjälp: Escapa apostrof för Stripe search query
 */
function escapeStripeSearch(s) {
  return String(s || '').replaceAll("'", "\\'");
}

module.exports = {
  createHostedInvoice
};
