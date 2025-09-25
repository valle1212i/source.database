// services/pdfService.js
const puppeteer = require('puppeteer');
const payoutReportHtml = require('../templates/payoutReportHtml');

async function renderPayoutReport(data) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Rendera HTML-mall
  const html = payoutReportHtml(data);
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const buffer = await page.pdf({
    format: 'A4',
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
  });

  await browser.close();
  return buffer;
}

module.exports = { renderPayoutReport };
