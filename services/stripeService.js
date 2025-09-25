// /services/stripeService.js
// Multitenant Stripe-klient + utilities. Faller tillbaka till STRIPE_SECRET om
// STRIPE_SECRET__TENANT saknas (för kompatibilitet med din befintliga setup).

const Stripe = require('stripe');

function getStripeSecretForTenant(tenant) {
  if (!tenant) throw new Error('Tenant saknas (X-Tenant-header).');

  const envKeyTenant = `STRIPE_SECRET__${String(tenant).toUpperCase()}`;
  const keyTenant = process.env[envKeyTenant];

  if (keyTenant) return keyTenant;

  // Fallback till global nyckel (som dina betalningar sannolikt använder)
  const keyGlobal = process.env.STRIPE_SECRET || process.env.STRIPE_API_KEY;
  if (keyGlobal) {
    console.warn(`[stripeService] Fallback till STRIPE_SECRET för tenant=${tenant} (saknar ${envKeyTenant}).`);
    return keyGlobal;
  }

  // Sista utvägen: tydligt fel
  throw new Error(`Stripe key saknas för tenant=${tenant} (förväntad ${envKeyTenant} eller STRIPE_SECRET).`);
}

function getStripeClient(tenant) {
  const key = getStripeSecretForTenant(tenant);
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

// ——— Payouts ————————————————————————————————————————————————
async function listPayouts(tenant, { starting_after, limit = 30 } = {}) {
  const stripe = getStripeClient(tenant);
  const params = { limit };
  if (starting_after) params.starting_after = starting_after;
  return stripe.payouts.list(params);
}

async function retrievePayout(tenant, payoutId) {
  const stripe = getStripeClient(tenant);
  return stripe.payouts.retrieve(payoutId);
}

// ——— Balance Transactions ————————————————————————————————
async function listBalanceTransactionsForPayout(tenant, payoutId, { limit = 100, starting_after } = {}) {
  const stripe = getStripeClient(tenant);
  const params = { payout: payoutId, limit };
  if (starting_after) params.starting_after = starting_after;
  return stripe.balanceTransactions.list(params);
}

async function listBalanceTransactionsByDate(tenant, { from, to, limit = 100, starting_after } = {}) {
  if (typeof from !== 'number' || typeof to !== 'number') {
    throw new Error('from/to måste vara Unix-sekunder (Number).');
  }
  const stripe = getStripeClient(tenant);
  const params = { created: { gte: from, lte: to }, limit };
  if (starting_after) params.starting_after = starting_after;
  return stripe.balanceTransactions.list(params);
}

// ——— Hjälpmetoder ————————————————————————————————————————————
function summarizeTransactions(txns = []) {
  let gross = 0, fees = 0, net = 0;
  const counts = { charges: 0, refunds: 0, adjustments: 0, transfers: 0, other: 0 };
  for (const t of txns) {
    gross += t.amount || 0;
    fees  += t.fee || 0;
    net   += t.net || 0;
    const rc = t.reporting_category || t.type || 'other';
    if (rc.includes('charge')) counts.charges++;
    else if (rc.includes('refund')) counts.refunds++;
    else if (rc.includes('adjustment')) counts.adjustments++;
    else if (rc.includes('transfer')) counts.transfers++;
    else counts.other++;
  }
  return { gross, fees, net, counts };
}

function toUnixSeconds(v) {
  if (typeof v === 'number') return Math.floor(v);
  const ts = new Date(v).getTime();
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
