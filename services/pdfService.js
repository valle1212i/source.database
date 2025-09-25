const puppeteer = require('puppeteer');

async function renderPdfFromHtml(html) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: 'new', // funkar i Puppeteer 20+
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', right: '16mm', bottom: '20mm', left: '16mm' }
  });
  await browser.close();
  return pdf;
}

module.exports = { renderPdfFromHtml };
