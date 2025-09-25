// templates/payoutReportHtml.js
module.exports = function payoutReportHtml({ payout, transactions, tenant }) {
    const logo = `/assets/logos/${tenant}.png`; // central logga
    const fmt = (n) => (n/100).toFixed(2) + ' SEK';
  
    const gross = transactions.reduce((s,t)=>s+(t.amount||0),0);
    const fees  = transactions.reduce((s,t)=>s+(t.fee||0),0);
    const net   = transactions.reduce((s,t)=>s+(t.net||0),0);
  
    return `
    <!DOCTYPE html>
    <html lang="sv">
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: Arial, sans-serif; color:#111; }
        h1 { font-size:20px; margin-bottom:10px; }
        .header { display:flex; justify-content:space-between; align-items:center; }
        .kpi { display:inline-block; margin:10px; padding:10px 20px; border-radius:8px; background:#f4f4f4; }
        .kpi h3 { margin:0; font-size:14px; color:#666; }
        .kpi p { margin:0; font-size:16px; font-weight:bold; }
        table { width:100%; border-collapse:collapse; margin-top:20px; }
        th, td { padding:8px; border-bottom:1px solid #ddd; font-size:12px; }
        th { background:#fafafa; text-align:left; }
      </style>
    </head>
    <body>
      <div class="header">
        <img src="${logo}" alt="Logo" height="40"/>
        <h1>Utbetalningsrapport</h1>
      </div>
  
      <div class="kpis">
        <div class="kpi"><h3>Brutto</h3><p>${fmt(gross)}</p></div>
        <div class="kpi"><h3>Avgifter</h3><p>${fmt(fees)}</p></div>
        <div class="kpi"><h3>Netto</h3><p>${fmt(net)}</p></div>
      </div>
  
      <h2>Utbetalning ${payout.id}</h2>
      <p>Status: ${payout.status}</p>
      <p>Skapad: ${new Date(payout.created*1000).toLocaleString('sv-SE')}</p>
      <p>Belopp: ${fmt(payout.amount)}</p>
  
      <h3>Transaktioner</h3>
      <table>
        <thead>
          <tr>
            <th>Typ</th><th>Kategori</th><th>Datum</th><th>Belopp</th><th>Avgift</th><th>Netto</th>
          </tr>
        </thead>
        <tbody>
          ${transactions.map(t=>`
            <tr>
              <td>${t.type||'-'}</td>
              <td>${t.reporting_category||'-'}</td>
              <td>${new Date(t.created*1000).toLocaleString('sv-SE')}</td>
              <td>${fmt(t.amount)}</td>
              <td>${fmt(t.fee)}</td>
              <td>${fmt(t.net)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </body>
    </html>`;
  };
  