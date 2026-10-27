/* ANIMO Boekhouding VOF - volledige vervanging van app.js
   Versie: 2026-10-27 klantnaam-fix
   Vervangt de verkorte zijbalk en corrigeert factuurherkenning.
*/
(() => {
  'use strict';

  const NAV = [
    ['dashboard','▦','Dashboard'],
    ['sales','↗','Verkoop'],
    ['purchases','↙','Aankopen'],
    ['bank','▤','Bank en kas'],
    ['accounting','▥','Boekhouding'],
    ['vat','%','Btw'],
    ['partners','♙','Vennoten'],
    ['peppol','⇄','Peppol extern'],
    ['reports','◫','Rapporten'],
    ['documents','▧','Documenten'],
    ['settings','⚙','Instellingen']
  ];

  const state = {
    page: 'dashboard',
    parsedInvoice: null,
    sales: JSON.parse(localStorage.getItem('animo_sales') || '[]'),
    purchases: JSON.parse(localStorage.getItem('animo_purchases') || '[]')
  };

  const euro = value => new Intl.NumberFormat('nl-BE', {
    style: 'currency', currency: 'EUR'
  }).format(Number(value || 0));

  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const normalizeNumber = raw => {
    if (raw === null || raw === undefined || raw === '') return null;
    let s = String(raw).replace(/\s/g,'').replace(/€/g,'');
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',','.');
      else s = s.replace(/,/g,'');
    } else if (s.includes(',')) s = s.replace(',','.');
    const n = Number(s.replace(/[^0-9.-]/g,''));
    return Number.isFinite(n) ? round2(n) : null;
  };

  const parseDate = raw => {
    if (!raw) return '';
    const m = String(raw).match(/(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{4})/);
    if (!m) return '';
    return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  };

  function findLabeledAmount(text, labels) {
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    for (const line of lines) {
      if (!labels.some(label => line.toLowerCase().includes(label))) continue;
      const matches = [...line.matchAll(/(?:€\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{1,2})?)/g)];
      if (matches.length) return normalizeNumber(matches[matches.length - 1][1]);
    }
    return null;
  }

  function allMoneyValues(text) {
    return [...text.matchAll(/(?:€\s*)?(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+[.,]\d{2})/g)]
      .map(m => normalizeNumber(m[1]))
      .filter(n => n !== null && n >= 0);
  }

  function bestVatCombination(values, rate, labeledTotal) {
    const unique = [...new Set(values)].filter(n => n > 0 && n < 1000000);
    let best = null;
    for (const net of unique) {
      for (const vat of unique) {
        if (net === vat) continue;
        const total = round2(net + vat);
        const vatExpected = round2(net * rate / 100);
        const vatError = Math.abs(vat - vatExpected);
        const totalError = labeledTotal === null ? 0 : Math.abs(total - labeledTotal);
        const score = vatError + totalError * 2;
        if (vatError <= 0.03 && (!best || score < best.score)) best = {net,vat,total,score};
      }
    }
    return best;
  }

  function parseInvoiceText(text) {
    const clean = String(text || '').replace(/\u00a0/g,' ').replace(/[ ]{2,}/g,' ');
    const lower = clean.toLowerCase();

    const numberMatch = clean.match(/(?:factuur(?:nummer|\s*#|nr\.?|nummer)?\s*[:#]?\s*)([A-Z0-9\-/]+)/i);
    const invoiceNumber = numberMatch ? numberMatch[1] : '';

    const dateMatch = clean.match(/factuurdatum\s*[:]?\s*(\d{1,2}[\-\/.]\d{1,2}[\-\/.]\d{4})/i);
    const dueMatch = clean.match(/vervaldatum\s*[:]?\s*(\d{1,2}[\-\/.]\d{1,2}[\-\/.]\d{4})/i);

    const rateMatch = clean.match(/(?:btw|vat)\s*(?:tarief)?\s*[:]?\s*(0|6|12|21)\s*%/i)
      || clean.match(/(0|6|12|21)\s*%/);
    const rate = rateMatch ? Number(rateMatch[1]) : 21;

    let net = findLabeledAmount(clean, ['excl. btw','exclusief btw','subtotaal','maatstaf van heffing','netto']);
    let vat = findLabeledAmount(clean, ['btw-bedrag','btw bedrag','totaal btw','21% btw','12% btw','6% btw']);
    let total = findLabeledAmount(clean, ['te betalen','totaal incl','totaal inclusief','factuurtotaal','totaal']);

    const values = allMoneyValues(clean);
    const combo = bestVatCombination(values, rate, total);

    if (combo) {
      if (net === null || Math.abs(round2(net * rate / 100) - (vat ?? -999)) > 0.03) {
        net = combo.net;
        vat = combo.vat;
      }
      total = combo.total;
    } else {
      if (net !== null && vat !== null && Math.abs(round2(net * rate / 100) - vat) > 0.03) {
        if (Math.abs(round2(vat * rate / 100) - net) <= 0.03) [net, vat] = [vat, net];
      }
      if (net !== null && vat === null) vat = round2(net * rate / 100);
      if (net !== null && vat !== null) total = round2(net + vat);
      if (total !== null && vat !== null && net === null) net = round2(total - vat);
    }

    // Extra bescherming tegen de fout uit de schermafbeelding: 149,17 en 710,33 bij totaal 859,50.
    if (net !== null && vat !== null && vat > net && rate <= 21) {
      const swappedVat = round2(vat * rate / 100);
      if (Math.abs(swappedVat - net) <= 0.03) [net, vat] = [vat, net];
    }

    const arithmeticOk = net !== null && vat !== null && total !== null
      && Math.abs(round2(net + vat) - total) <= 0.03;
    const vatOk = rate === 0 ? vat === 0 : net !== null && vat !== null
      && Math.abs(round2(net * rate / 100) - vat) <= 0.03;

    let customer = '';
    const enterpriseLines = clean.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // 1. Zoek de klant vlak na de gestructureerde mededeling.
    // Dit vangt facturen op waar de volledige PDF-tekst op één regel terechtkomt.
    const afterStructured = clean.match(
      /(?:gestructureerde\s+mededeling[^+]*\+{0,3}[0-9/]+\+{0,3}|\+{3}[0-9/]+\+{3})\s+([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ0-9&.'’()\- ]{2,80}?)(?=\s+(?:[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ.'’\-]+(?:straat|steenweg|laan|weg|plein|kaai|dreef|baan|lei|markt)|\d{4}\s|België\b|BE\s?0?\d{9}\b))/i
    );
    if (afterStructured) customer = afterStructured[1].trim();

    // 2. Zoek een ondernemingsnaam direct voor het tweede Belgische btw-nummer.
    if (!customer) {
      const vatBlocks = [...clean.matchAll(/\bBE\s?0?\d{9}\b/gi)];
      if (vatBlocks.length >= 2) {
        const beforeSecondVat = clean.slice(Math.max(0, vatBlocks[1].index - 180), vatBlocks[1].index);
        const nameBeforeAddress = beforeSecondVat.match(
          /([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ0-9&.'’()\- ]{2,80}?)\s+(?:[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ.'’\-]+(?:straat|steenweg|laan|weg|plein|kaai|dreef|baan|lei|markt))\s+\d+/i
        );
        if (nameBeforeAddress) customer = nameBeforeAddress[1].trim();
      }
    }

    // 3. Zoek per tekstregel naar een waarschijnlijke ondernemingsnaam.
    if (!customer) {
      const candidate = enterpriseLines.find(line => {
        const l = line.toLowerCase();
        return line.length >= 3 && line.length <= 100
          && !/animo|algemene voorwaarden|factuur|factuurdatum|vervaldatum|mededeling|beschrijving|aantal|prijs|btw|iban|telefoon|e-mail|email/.test(l)
          && (/investments|bv\b|vof\b|nv\b|commv\b|group\b|services\b|consulting\b|horeca\b/i.test(line));
      });
      if (candidate) customer = candidate.trim();
    }

    // 4. Laatste vangnet voor het bekende factuursjabloon: naam tussen mededeling en adres.
    if (!customer) {
      const fallback = clean.match(
        /(?:\+{3}[0-9/]+\+{3})\s+(.{2,80}?)\s+[A-Za-zÀ-ÖØ-öø-ÿ.'’\-]+(?:straat|steenweg|laan|weg|plein|kaai|dreef|baan|lei|markt)\s+\d+/i
      );
      if (fallback) customer = fallback[1].trim();
    }

    // Verwijder OCR-rommel en verboden labels uit het resultaat.
    customer = customer
      .replace(/^(klant|customer|aan|factureren aan)\s*[:\-]?\s*/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (/algemene voorwaarden|factuurdatum|vervaldatum|beschrijving/i.test(customer)) customer = '';

    return {
      invoiceNumber,
      invoiceDate: parseDate(dateMatch?.[1]),
      dueDate: parseDate(dueMatch?.[1]),
      customer,
      net, vat, total, rate,
      arithmeticOk, vatOk,
      rawText: clean
    };
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :root{--g:#163c2e;--g2:#285746;--bg:#f6f7f3;--line:#d9e1dc;--muted:#66736c;--ok:#167044;--bad:#b42318}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17201c}
      #animoApp{min-height:100vh;display:grid;grid-template-columns:250px 1fr}.an-side{background:var(--g);color:white;height:100vh;position:sticky;top:0;padding:22px 16px;display:flex;flex-direction:column;z-index:30}.an-brand{display:flex;gap:12px;align-items:center;padding:4px 10px 28px}.an-logo{width:42px;height:42px;border-radius:13px;background:#dff1e8;color:var(--g);display:grid;place-items:center;font-weight:900;font-size:20px}.an-brand b,.an-brand small{display:block}.an-brand small{color:#bdd3c9;margin-top:3px}.an-nav{display:grid;gap:4px}.an-nav button{border:0;background:transparent;color:#d8e6df;padding:12px 13px;border-radius:11px;text-align:left;font-size:15px;cursor:pointer}.an-nav button.active,.an-nav button:hover{background:rgba(255,255,255,.13);color:#fff}.an-nav i{display:inline-block;width:28px;font-style:normal}.an-logout{margin-top:auto;color:#d8e6df;background:none;border:0;text-align:left;padding:12px;cursor:pointer}.an-main{min-width:0}.an-top{height:82px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:16px 26px;position:sticky;top:0;z-index:20}.an-top h1{font-size:22px;margin:0}.an-actions{margin-left:auto;display:flex;gap:10px}.an-btn{border:0;background:var(--g);color:white;border-radius:10px;padding:11px 15px;font-weight:750;cursor:pointer}.an-btn.secondary{background:#fff;color:#17201c;border:1px solid var(--line)}.an-content{padding:24px;max-width:1450px;margin:auto}.an-grid{display:grid;gap:15px}.an-kpis{grid-template-columns:repeat(4,1fr)}.an-card{background:#fff;border:1px solid var(--line);border-radius:15px;padding:18px}.an-card .label{color:var(--muted);font-size:13px}.an-card .value{font-size:25px;font-weight:850;margin-top:7px}.an-toolbar{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:15px}.an-table{overflow:auto;background:#fff;border:1px solid var(--line);border-radius:15px}.an-table table{width:100%;min-width:700px;border-collapse:collapse}.an-table th,.an-table td{padding:12px;border-bottom:1px solid #edf1ee;text-align:left}.an-table th{color:var(--muted);font-size:12px}.amount{text-align:right!important}.an-empty{text-align:center;padding:55px 20px;color:var(--muted)}.an-menu{display:none}.an-backdrop{display:none}.an-modal-bg{position:fixed;inset:0;background:rgba(5,20,14,.6);z-index:60;display:grid;place-items:center;padding:16px}.an-modal{background:white;border-radius:18px;width:min(760px,100%);max-height:92vh;overflow:auto;padding:24px;position:relative}.an-close{position:absolute;right:12px;top:8px;background:none;border:0;font-size:30px}.an-form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.an-field label{display:block;font-size:13px;font-weight:750;margin-bottom:6px}.an-field input,.an-field select,.an-field textarea{width:100%;padding:11px;border:1px solid #cbd6d0;border-radius:10px;font:inherit}.an-full{grid-column:1/-1}.an-check{padding:12px;border-radius:10px;background:#edf7f1;color:var(--ok);margin:10px 0}.an-check.bad{background:#fff0ee;color:var(--bad)}.an-raw{background:#f3f5f3;padding:12px;border-radius:10px;max-height:180px;overflow:auto;font-size:12px;white-space:pre-wrap}.hidden{display:none!important}
      @media(max-width:900px){#animoApp{grid-template-columns:1fr}.an-side{position:fixed;left:-270px;width:250px;transition:.2s}.an-side.open{left:0}.an-menu{display:block;margin-right:12px}.an-backdrop.show{display:block;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:25}.an-kpis{grid-template-columns:repeat(2,1fr)}.an-content{padding:16px}.an-top{padding:12px 14px}}
      @media(max-width:550px){.an-kpis{grid-template-columns:1fr 1fr}.an-card{padding:14px}.an-card .value{font-size:19px}.an-form{grid-template-columns:1fr}.an-full{grid-column:auto}.an-modal-bg{align-items:end;padding:0}.an-modal{border-radius:20px 20px 0 0;padding:20px 14px}.an-top h1{font-size:19px}}
    `;
    document.head.appendChild(style);
  }

  function shell() {
    document.body.innerHTML = `
      <div id="animoApp">
        <aside class="an-side" id="anSide">
          <div class="an-brand"><div class="an-logo">A</div><div><b>ANIMO</b><small>Boekhouding VOF</small></div></div>
          <nav class="an-nav" id="anNav"></nav>
          <button class="an-logout">Afmelden</button>
        </aside>
        <div class="an-backdrop" id="anBackdrop"></div>
        <main class="an-main">
          <header class="an-top"><button class="an-btn secondary an-menu" id="anMenu">☰</button><h1 id="anTitle">Dashboard</h1><div class="an-actions"><button class="an-btn" id="quickAdd">+</button><button class="an-btn secondary">AV</button></div></header>
          <section class="an-content" id="anContent"></section>
        </main>
      </div>
      <div id="anModalRoot"></div>`;
  }

  function renderNav() {
    const el = document.getElementById('anNav');
    el.innerHTML = NAV.map(([id,icon,label]) => `<button data-page="${id}" class="${state.page===id?'active':''}"><i>${icon}</i>${label}</button>`).join('');
  }

  function sum(list, key) { return list.reduce((a,x)=>a+Number(x[key]||0),0); }
  function dashboardView(){
    const revenue=sum(state.sales,'total'), cost=sum(state.purchases,'total');
    return `<div class="an-grid an-kpis"><div class="an-card"><div class="label">Omzet</div><div class="value">${euro(revenue)}</div></div><div class="an-card"><div class="label">Kosten</div><div class="value">${euro(cost)}</div></div><div class="an-card"><div class="label">Voorlopig resultaat</div><div class="value">${euro(revenue-cost)}</div></div><div class="an-card"><div class="label">Documenten</div><div class="value">${state.sales.length+state.purchases.length}</div></div></div><div class="an-card" style="margin-top:16px"><h2>Direct opvolgen</h2><p>Voeg externe verkoopfacturen toe, controleer de uitgelezen bedragen en boek pas definitief wanneer debet gelijk is aan credit.</p></div>`;
  }

  function salesView(){
    return `<div class="an-toolbar"><button class="an-btn" data-action="scan-sale">Factuur uploaden en uitlezen</button><button class="an-btn secondary" data-action="manual-sale">Handmatig toevoegen</button></div><div class="an-table"><table><thead><tr><th>Factuur</th><th>Klant</th><th>Datum</th><th>Excl. btw</th><th>Btw</th><th class="amount">Totaal</th><th></th></tr></thead><tbody>${state.sales.map((x,i)=>`<tr><td>${x.invoiceNumber||'-'}</td><td>${x.customer||'-'}</td><td>${x.invoiceDate||'-'}</td><td>${euro(x.net)}</td><td>${euro(x.vat)}</td><td class="amount">${euro(x.total)}</td><td><button class="an-btn secondary" data-delete-sale="${i}">Verwijder</button></td></tr>`).join('') || `<tr><td colspan="7" class="an-empty">Nog geen verkoopfacturen.</td></tr>`}</tbody></table></div>`;
  }

  function simpleView(title, text){return `<div class="an-card"><h2>${title}</h2><p>${text}</p></div>`;}
  const views={
    dashboard:dashboardView,
    sales:salesView,
    purchases:()=>simpleView('Aankopen','Registreer hier aankoopfacturen en creditnota’s.'),
    bank:()=>simpleView('Bank en kas','Importeer en koppel bank- en kasverrichtingen.'),
    accounting:()=>simpleView('Boekhouding','Journaalposten, grootboek en dubbele boekingen. Iedere definitieve post moet sluiten: debet = credit.'),
    vat:()=>simpleView('Btw','Controleer verschuldigde en aftrekbare btw per periode.'),
    partners:()=>simpleView('Vennoten','Beheer rekening-courant, privéopnames, stortingen en winstverdeling.'),
    peppol:()=>simpleView('Peppol extern','Registreer hier de status van facturen die via de externe Peppol-site worden verwerkt.'),
    reports:()=>simpleView('Rapporten','Balans, resultatenrekening, proef- en saldibalans en openstaande posten.'),
    documents:()=>simpleView('Documenten','Bewaar facturen en andere verantwoordingsstukken.'),
    settings:()=>simpleView('Instellingen','Beheer onderneming, boekjaar, btw-regime en externe Peppol-aanbieder.')
  };

  function render(){
    renderNav();
    document.getElementById('anTitle').textContent=NAV.find(x=>x[0]===state.page)?.[2]||'ANIMO';
    document.getElementById('anContent').innerHTML=views[state.page]();
    closeSide();
  }

  function openSide(){document.getElementById('anSide').classList.add('open');document.getElementById('anBackdrop').classList.add('show');}
  function closeSide(){document.getElementById('anSide').classList.remove('open');document.getElementById('anBackdrop').classList.remove('show');}
  function modal(html){document.getElementById('anModalRoot').innerHTML=`<div class="an-modal-bg"><div class="an-modal"><button class="an-close" data-action="close">×</button>${html}</div></div>`;}
  function closeModal(){document.getElementById('anModalRoot').innerHTML='';}

  function invoiceForm(data={}){
    const d={invoiceNumber:'',invoiceDate:'',dueDate:'',customer:'',net:'',vat:'',total:'',rate:21,rawText:'',arithmeticOk:false,vatOk:false,...data};
    modal(`<h2>Verkoopfactuur controleren</h2><form id="invoiceForm" class="an-form">
      <div class="an-field"><label>Factuurnummer</label><input name="invoiceNumber" value="${escapeHtml(d.invoiceNumber)}" required></div>
      <div class="an-field"><label>Klant</label><input name="customer" value="${escapeHtml(d.customer)}" required></div>
      <div class="an-field"><label>Factuurdatum</label><input type="date" name="invoiceDate" value="${d.invoiceDate}" required></div>
      <div class="an-field"><label>Vervaldatum</label><input type="date" name="dueDate" value="${d.dueDate}"></div>
      <div class="an-field"><label>Exclusief btw</label><input type="number" step="0.01" name="net" value="${d.net??''}" required></div>
      <div class="an-field"><label>Btw</label><input type="number" step="0.01" name="vat" value="${d.vat??''}" required></div>
      <div class="an-field"><label>Totaal</label><input type="number" step="0.01" name="total" value="${d.total??''}" required></div>
      <div class="an-field"><label>Btw-tarief</label><select name="rate">${[0,6,12,21].map(r=>`<option value="${r}" ${r===d.rate?'selected':''}>${r}%</option>`).join('')}</select></div>
      <div class="an-full" id="liveCheck"></div>
      ${d.rawText?`<div class="an-full"><label>Uitgelezen tekst</label><div class="an-raw">${escapeHtml(d.rawText)}</div></div>`:''}
      <div class="an-full"><button class="an-btn" id="saveInvoice">Opslaan als verkoopfactuur</button></div>
    </form>`);
    validateFormLive();
  }

  function validateFormLive(){
    const form=document.getElementById('invoiceForm'); if(!form)return;
    const update=()=>{
      const fd=new FormData(form), net=normalizeNumber(fd.get('net')),vat=normalizeNumber(fd.get('vat')),total=normalizeNumber(fd.get('total')),rate=Number(fd.get('rate'));
      const arithmetic=net!==null&&vat!==null&&total!==null&&Math.abs(round2(net+vat)-total)<=0.03;
      const vatOk=net!==null&&vat!==null&&(rate===0?vat===0:Math.abs(round2(net*rate/100)-vat)<=0.03);
      document.getElementById('liveCheck').innerHTML=`<div class="an-check ${arithmetic&&vatOk?'':'bad'}">${arithmetic?'✓ Exclusief btw + btw = totaal':'✕ Exclusief btw + btw is niet gelijk aan totaal'}<br>${vatOk?`✓ Btw stemt overeen met ${rate}%`:`✕ Btw stemt niet overeen met ${rate}%`}</div>`;
      document.getElementById('saveInvoice').disabled=!(arithmetic&&vatOk);
    };
    form.addEventListener('input',update);update();
  }

  function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  async function loadScript(src, globalName){
    if(globalName && window[globalName])return;
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }

  async function extractFile(file){
    if(file.type==='application/pdf'){
      await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js','pdfjsLib');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      const doc=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let text='';
      for(let p=1;p<=doc.numPages;p++){const page=await doc.getPage(p),content=await page.getTextContent();text+=content.items.map(i=>i.str).join(' ')+'\n';}
      return text;
    }
    if(file.type.startsWith('image/')){
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
      const result=await window.Tesseract.recognize(file,'nld');return result.data.text;
    }
    return await file.text();
  }

  function chooseFile(){
    const input=document.createElement('input');input.type='file';input.accept='application/pdf,image/*,.txt';
    input.onchange=async()=>{const file=input.files?.[0];if(!file)return;modal('<h2>Factuur wordt uitgelezen…</h2><p>Even wachten. Controleer daarna altijd de voorgestelde gegevens.</p>');try{const text=await extractFile(file);const parsed=parseInvoiceText(text);state.parsedInvoice=parsed;invoiceForm(parsed);}catch(e){console.error(e);closeModal();alert('Het document kon niet worden uitgelezen. Voeg de factuur handmatig toe.');invoiceForm();}};input.click();
  }

  document.addEventListener('click',e=>{
    const nav=e.target.closest('[data-page]');if(nav){state.page=nav.dataset.page;render();return;}
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action==='scan-sale')chooseFile();
    if(action==='manual-sale'||action==='new-sale')invoiceForm();
    if(action==='close')closeModal();
    const del=e.target.closest('[data-delete-sale]');if(del){state.sales.splice(Number(del.dataset.deleteSale),1);localStorage.setItem('animo_sales',JSON.stringify(state.sales));render();}
  });

  document.addEventListener('submit',e=>{
    if(e.target.id!=='invoiceForm')return;e.preventDefault();const fd=new FormData(e.target);
    const item={invoiceNumber:fd.get('invoiceNumber'),customer:fd.get('customer'),invoiceDate:fd.get('invoiceDate'),dueDate:fd.get('dueDate'),net:normalizeNumber(fd.get('net')),vat:normalizeNumber(fd.get('vat')),total:normalizeNumber(fd.get('total')),rate:Number(fd.get('rate'))};
    if(Math.abs(round2(item.net+item.vat)-item.total)>0.03||Math.abs(round2(item.net*item.rate/100)-item.vat)>0.03){alert('De bedragen zijn niet correct. Opslaan is geblokkeerd.');return;}
    state.sales.push(item);localStorage.setItem('animo_sales',JSON.stringify(state.sales));closeModal();state.page='sales';render();
  });

  injectStyles();shell();render();
  document.getElementById('anMenu').onclick=openSide;
  document.getElementById('anBackdrop').onclick=closeSide;
  document.getElementById('quickAdd').onclick=()=>invoiceForm();
})();
