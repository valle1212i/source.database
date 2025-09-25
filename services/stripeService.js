// /server/services/stripeService.js
// Ansvar: Multitenant Stripe-klient + utilities för payouts och balance transactions.
// OBS: Exponerar aldrig nycklar i frontend. Allt sker server-side.

const Stripe = require('stripe');

/**
 * Hämtar Stripe Secret Key för given tenant.
 * Primärt: process.env["STRIPE_SECRET__" + TENANT_UPPER]
 * Alternativ: koppla mot DB Settings om/ när ni inför det (lämnat som TODO).
 */
function getStripeSecretForTenant(tenant) {
  if (!tenant) throw new Error('Tenant saknas (X-Tenant-header).');

  const envKey = `STRIPE_SECRET__${String(tenant).toUpperCase()}`;
  const key = process.env[envKey];

  // TODO: Hämta från DB Settings om key saknas i env (frivilligt steg).
  if (!key) {
    throw new Error(`Stripe key saknas för tenant=${tenant} (förväntad env: ${envKey}).`);
  }
  return key;
}

/**
 * Returnerar en Stripe-klient låst till tenantens nyckel.
 */
function getStripeClient(tenant) {
  const key = getStripeSecretForTenant(tenant);
  // Viktigt: sätt explicita API-versioner för stabilitet.
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

/**
 * Lista utbetalningar (payouts) med enkel cursor (starting_after).
 * @param {string} tenant
 * @param {{ starting_after?: string, limit?: number }} opts
 */
async function listPayouts(tenant, { starting_after, limit = 30 } = {}) {
  const stripe = getStripeClient(tenant);
  const params = { limit };
  if (starting_after) params.starting_after = starting_after;
  const res = await stripe.payouts.list(params);
  return res; // {data, has_more}
}

/**
 * Hämta en specifik payout.
 * @param {string} tenant
 * @param {string} payoutId
 */
async function retrievePayout(tenant, payoutId) {
  const stripe = getStripeClient(tenant);
  return stripe.payouts.retrieve(payoutId);
}

/**
 * Hämta balance transactions som hör till en specifik payout.
 * OBS: Stripe paginerar — här hämtar vi första sidan med limit (servern kan loopa/autoPage vid behov).
 * @param {string} tenant
 * @param {string} payoutId
 * @param {{ limit?: number, starting_after?: string }} opts
 */
async function listBalanceTransactionsForPayout(tenant, payoutId, { limit = 100, starting_after } = {}) {
  const stripe = getStripeClient(tenant);
  const params = { payout: payoutId, limit };
  if (starting_after) params.starting_after = starting_after;
  return stripe.balanceTransactions.list(params);
}

/**
 * Hämta balance transactions för ett datumintervall (Unix sekunder).
 * Används för periodrapporter (översikt, revisor, årsvis).
 * @param {string} tenant
 * @param {{ from: number, to: number, limit?: number, starting_after?: string }} opts
 */
async function listBalanceTransactionsByDate(tenant, { from, to, limit = 100, starting_after } = {}) {
  if (typeof from !== 'number' || typeof to !== 'number') {
    throw new Error('from/to måste vara Unix-sekunder (Number).');
  }
  const stripe = getStripeClient(tenant);
  const params = {
    created: { gte: from, lte: to },
    limit,
  };
  if (starting_after) params.starting_after = starting_after;
  return stripe.balanceTransactions.list(params);
}

/**
 * Hjälpmetod: summera brutto/avgifter/netto från en lista balance transactions.
 * Returnerar även enkla counts per typ/reporting_category.
 * @param {Array} txns
 */
function summarizeTransactions(txns) {
  let gross = 0;
  let fees = 0;
  let net = 0;

  const counts = {
    charges: 0,
    refunds: 0,
    adjustments: 0,
    transfers: 0,
    other: 0,
  };

  for (const t of txns) {
    // Stripe belopp är i minor units (öre/cent). Summering sker i samma units.
    gross += (t.amount || 0);
    fees += (t.fee || 0);
    net += (t.net || 0);

    // Klassning via reporting_category (fallback: type).
    const rc = t.reporting_category || t.type || 'other';
    if (rc.includes('charge')) counts.charges += 1;
    else if (rc.includes('refund')) counts.refunds += 1;
    else if (rc.includes('adjustment')) counts.adjustments += 1;
    else if (rc.includes('transfer')) counts.transfers += 1;
    else counts.other += 1;
  }

  return { gross, fees, net, counts };
}

/**
 * Hjälpmetod: konvertera Date/ISO-string till Unix sekunder.
 * Returnerar Number (floor).
 */
function toUnixSeconds(d) {
  if (typeof d === 'number') return Math.floor(d);
  const ts = new Date(d).getTime();
  if (Number.isNaN(ts)) throw new Error('Ogiltigt datumvärde.');
  return Math.floor(ts / 1000);
}

module.exports = {
  getStripeClient,
  listPayouts,
  retrievePayout,
  listBalanceTransactionsForPayout,
  listBalanceTransactionsByDate,
  summarizeTransactions,
  toUnixSeconds,
};
