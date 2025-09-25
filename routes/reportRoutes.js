// routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const pdfService = require('../services/pdfService');

// Hämta en PDF för en payout
router.get('/payout/:id.pdf', async (req, res) => {
  try {
    const payoutId = req.params.id;
    const tenant = req.user?.tenant || 'default';

    // 1) Hämta payout-data från kundens payment-service
    const [payoutRes, txnRes] = await Promise.all([
      fetch(`${process.env.PAYMENTS_URL}/api/payouts/${encodeURIComponent(payoutId)}`, {
        headers: { 'X-Internal-Auth': process.env.INTERNAL_KEY, 'X-Tenant': tenant }
      }),
      fetch(`${process.env.PAYMENTS_URL}/api/payouts/${encodeURIComponent(payoutId)}/transactions`, {
        headers: { 'X-Internal-Auth': process.env.INTERNAL_KEY, 'X-Tenant': tenant }
      })
    ]);

    const payoutData = await payoutRes.json();
    const txnData = await txnRes.json();

    // 2) Slå ihop
    const data = {
      payout: payoutData.payout,
      transactions: txnData.data || [],
      tenant
    };

    // 3) Rendera PDF
    const pdfBuffer = await pdfService.renderPayoutReport(data);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Payout_${payoutId}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Report PDF error', err);
    res.status(500).json({ success: false, error: 'Kunde inte skapa rapport' });
  }
});

module.exports = router;
