const SB_URL = "https://ttmfrmnaiqlceqkeidym.supabase.co";
const SB_KEY = "sb_publishable_iE0-RWlfo00PNUfj9N8FrA_PzQA74U_";
const client = supabase.createClient(SB_URL, SB_KEY);

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let state = {
  session: null,
  business: null,
  invoices: [],
  entries: [],
  documents: [],
  page: "dashboard"
};

const $ = selector => document.querySelector(selector);

const euro = value =>
  new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR"
  }).format(Number(value || 0));

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3000);
}

function show(id) {
  ["#authScreen", "#setupScreen", "#app"].forEach(selector => {
    $(selector).classList.add("hidden");
  });
  $(id).classList.remove("hidden");
}

async function boot() {
  const { data, error } = await client.auth.getSession();

  if (error) {
    toast(error.message);
    show("#authScreen");
    return;
  }

  state.session = data.session;

  if (!state.session) {
    show("#authScreen");
    return;
  }

  await loadBusiness();
}

async function loadBusiness() {
  const { data, error } = await client
    .from("business_users")
    .select("business_id,role,businesses(*)")
    .eq("user_id", state.session.user.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    toast(error.message);
    return;
  }

  if (!data) {
    show("#setupScreen");
    return;
  }

  state.business = data.businesses;
  show("#app");
  await refresh();
}

async function refresh() {
  const businessId = state.business.id;

  const [invoicesResult, entriesResult, documentsResult] = await Promise.all([
    client
      .from("invoices")
      .select("*,contacts(name)")
      .eq("business_id", businessId)
      .order("invoice_date", { ascending: false }),

    client
      .from("journal_entries")
      .select("*")
      .eq("business_id", businessId)
      .order("booked_on", { ascending: false }),

    client
      .from("documents")
      .select("*")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
  ]);

  const error =
    invoicesResult.error || entriesResult.error || documentsResult.error;

  if (error) {
    toast(error.message);
    return;
  }

  state.invoices = invoicesResult.data || [];
  state.entries = entriesResult.data || [];
  state.documents = documentsResult.data || [];
  render();
}

function render() {
  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === state.page);
  });

  const titles = {
    dashboard: "Dashboard",
    sales: "Verkoop",
    accounting: "Boekhouding",
    documents: "Documenten",
    settings: "Instellingen"
  };

  $("#title").textContent = titles[state.page];
  $("#content").innerHTML = views[state.page]();
  $(".sidebar").classList.remove("open");
}

function viewsDashboard() {
  const sales = state.invoices.filter(invoice => invoice.direction === "sale");
  const total = sales.reduce(
    (sum, invoice) => sum + Number(invoice.total_amount || 0),
    0
  );
  const vat = sales.reduce(
    (sum, invoice) => sum + Number(invoice.vat_amount || 0),
    0
  );

  return `
    <div class="note">
      <b>Live verbonden met Supabase</b><br>
      Upload een bestaande verkoopfactuur als PDF. De app leest de beschikbare
      gegevens uit en jij controleert ze voor de definitieve boeking.
    </div>

    <div class="grid kpis">
      <div class="card kpi">
        <small>Verkoop</small>
        <b>${euro(total)}</b>
        <span>${sales.length} facturen</span>
      </div>

      <div class="card kpi">
        <small>Btw verkoop</small>
        <b>${euro(vat)}</b>
        <span>volgens de geboekte facturen</span>
      </div>

      <div class="card kpi">
        <small>Journaalposten</small>
        <b>${state.entries.length}</b>
        <span>dubbele boekingen</span>
      </div>

      <div class="card kpi">
        <small>Documenten</small>
        <b>${state.documents.length}</b>
        <span>veilig opgeslagen</span>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="section-head">
        <h2>Recente facturen</h2>
        <button class="btn" data-upload>PDF uploaden</button>
      </div>
      ${invoiceTable(sales.slice(0, 6))}
    </div>
  `;
}

function invoiceTable(rows) {
  if (!rows.length) {
    return `<div class="empty">Nog geen facturen.</div>`;
  }

  return `
    <div style="overflow:auto">
      <table>
        <thead>
          <tr>
            <th>Nummer</th>
            <th>Klant</th>
            <th>Datum</th>
            <th>Status</th>
            <th class="amount">Totaal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              invoice => `
                <tr>
                  <td><b>${escapeHtml(invoice.invoice_number || "-")}</b></td>
                  <td>${escapeHtml(invoice.contacts?.name || "Onbekend")}</td>
                  <td>${escapeHtml(invoice.invoice_date || "-")}</td>
                  <td>
                    <span class="badge ${invoice.status}">
                      ${invoice.status === "finalized" ? "Definitief" : "Concept"}
                    </span>
                  </td>
                  <td class="amount">${euro(invoice.total_amount)}</td>
                  <td>
                    ${
                      invoice.status === "draft"
                        ? `<button class="btn danger" data-delete-invoice="${invoice.id}">Verwijder</button>`
                        : ""
                    }
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function viewsSales() {
  return `
    <div class="toolbar">
      <h2>Verkoopfacturen</h2>
      <button class="btn" data-upload>PDF-factuur uploaden</button>
    </div>

    <div class="card">
      ${invoiceTable(
        state.invoices.filter(invoice => invoice.direction === "sale")
      )}
    </div>
  `;
}

function viewsAccounting() {
  return `
    <div class="card">
      <div class="section-head">
        <h2>Journaalposten</h2>
        <span class="badge finalized">debet = credit</span>
      </div>

      ${
        state.entries.length
          ? `
            <div style="overflow:auto">
              <table>
                <thead>
                  <tr>
                    <th>Nr.</th>
                    <th>Datum</th>
                    <th>Omschrijving</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.entries
                    .map(
                      entry => `
                        <tr>
                          <td>${entry.entry_number}</td>
                          <td>${escapeHtml(entry.booked_on || "-")}</td>
                          <td>${escapeHtml(entry.description || "-")}</td>
                          <td>
                            <span class="badge ${entry.status}">
                              ${escapeHtml(entry.status)}
                            </span>
                          </td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : `<div class="empty">Nog geen journaalposten.</div>`
      }
    </div>
  `;
}

function viewsDocuments() {
  return `
    <div class="toolbar">
      <h2>Documenten</h2>
      <button class="btn" data-upload>PDF toevoegen</button>
    </div>

    <div class="card">
      ${
        state.documents.length
          ? state.documents
              .map(
                document => `
                  <div class="section-head">
                    <div>
                      <b>${escapeHtml(document.file_name)}</b><br>
                      <small>${escapeHtml(document.document_date || "")}</small>
                    </div>
                    <button class="btn secondary" data-open-doc="${escapeHtml(
                      document.storage_path
                    )}">Open</button>
                  </div>
                `
              )
              .join("")
          : `<div class="empty">Nog geen documenten.</div>`
      }
    </div>
  `;
}

function viewsSettings() {
  return `
    <div class="card">
      <h2>${escapeHtml(state.business.name)}</h2>
      <p>Ondernemingsnummer: ${escapeHtml(
        state.business.enterprise_number || "-"
      )}</p>
      <p>Btw-nummer: ${escapeHtml(state.business.vat_number || "-")}</p>
      <p><b>Database:</b> verbonden</p>
    </div>
  `;
}

const views = {
  dashboard: viewsDashboard,
  sales: viewsSales,
  accounting: viewsAccounting,
  documents: viewsDocuments,
  settings: viewsSettings
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function extractPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const lines = [];
    let currentLine = [];
    let previousY = null;

    for (const item of content.items) {
      const y = Math.round(item.transform?.[5] || 0);

      if (previousY !== null && Math.abs(y - previousY) > 3) {
        if (currentLine.length) lines.push(currentLine.join(" "));
        currentLine = [];
      }

      currentLine.push(item.str);
      previousY = y;
    }

    if (currentLine.length) lines.push(currentLine.join(" "));
    pages.push(lines.join("\n"));
  }

  return pages.join("\n");
}

function normalizePdfText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanCandidate(value) {
  return String(value || "")
    .replace(/^\s*(naam|name|nom)\s*[:\-]?\s*/i, "")
    .replace(/\s{2,}.*/, "")
    .replace(/[|;].*/, "")
    .trim();
}

function isValidCustomerCandidate(candidate) {
  if (!candidate || candidate.length < 2 || candidate.length > 100) {
    return false;
  }

  const lower = candidate.toLowerCase();

  const forbidden = [
    "algemene voorwaarden",
    "voorwaarden",
    "betalingsvoorwaarden",
    "terms and conditions",
    "payment conditions",
    "factuurnummer",
    "invoice number",
    "factuurdatum",
    "vervaldatum",
    "omschrijving",
    "description",
    "totaal",
    "total",
    "btw",
    "vat",
    "tva",
    "iban",
    "mededeling",
    "rekeningnummer",
    "bankrekening"
  ];

  if (forbidden.some(word => lower.includes(word))) return false;
  if (/€|\b\d+[,.]\d{2}\b/.test(candidate)) return false;
  if (/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/.test(candidate)) {
    return false;
  }

  return true;
}

function extractCustomerName(text) {
  const lines = normalizePdfText(text)
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const inlinePatterns = [
    /^(?:klant|klantnaam|gefactureerd aan|factuur aan|facturatie aan)\s*[:\-]\s*(.+)$/i,
    /^(?:customer|customer name|invoice to|bill to|billed to)\s*[:\-]\s*(.+)$/i,
    /^(?:client|nom du client|facturé à|facture à)\s*[:\-]\s*(.+)$/i
  ];

  const labelPatterns = [
    /^(?:klant|klantnaam|gefactureerd aan|factuur aan|facturatie aan)\s*[:\-]?$/i,
    /^(?:customer|customer name|invoice to|bill to|billed to)\s*[:\-]?$/i,
    /^(?:client|nom du client|facturé à|facture à)\s*[:\-]?$/i
  ];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    for (const pattern of inlinePatterns) {
      const match = line.match(pattern);
      const candidate = cleanCandidate(match?.[1]);
      if (isValidCustomerCandidate(candidate)) return candidate;
    }

    if (labelPatterns.some(pattern => pattern.test(line))) {
      for (let offset = 1; offset <= 3; offset++) {
        const candidate = cleanCandidate(lines[index + offset]);
        if (isValidCustomerCandidate(candidate)) return candidate;
      }
    }
  }

  return "";
}

function parseMoney(value) {
  if (!value) return 0;

  let result = String(value)
    .replace(/\s/g, "")
    .replace(/€/g, "");

  if (result.includes(",") && result.includes(".")) {
    const lastComma = result.lastIndexOf(",");
    const lastDot = result.lastIndexOf(".");

    if (lastComma > lastDot) {
      result = result.replace(/\./g, "").replace(",", ".");
    } else {
      result = result.replace(/,/g, "");
    }
  } else if (result.includes(",")) {
    result = result.replace(",", ".");
  }

  return Number(result) || 0;
}

function toISO(dateText) {
  if (!dateText) return "";

  const months = {
    jan: 1,
    januari: 1,
    feb: 2,
    februari: 2,
    mrt: 3,
    maart: 3,
    apr: 4,
    april: 4,
    mei: 5,
    jun: 6,
    juni: 6,
    jul: 7,
    juli: 7,
    aug: 8,
    augustus: 8,
    sep: 9,
    sept: 9,
    september: 9,
    okt: 10,
    oktober: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
    janvier: 1,
    février: 2,
    fevrier: 2,
    mars: 3,
    avril: 4,
    juin: 6,
    juillet: 7,
    août: 8,
    aout: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    décembre: 12,
    decembre: 12
  };

  const normalized = String(dateText)
    .toLowerCase()
    .replace(/,/g, "")
    .trim();

  const writtenDate = normalized.match(
    /\b(\d{1,2})\s+([a-zéèêûôîï.]+)\s+(\d{4})\b/i
  );

  if (writtenDate) {
    const day = Number(writtenDate[1]);
    const monthName = writtenDate[2].replace(".", "");
    const month = months[monthName];
    const year = Number(writtenDate[3]);

    if (month) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
        2,
        "0"
      )}`;
    }
  }

  const numericDate = normalized.match(
    /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/
  );

  if (numericDate) {
    const day = Number(numericDate[1]);
    const month = Number(numericDate[2]);
    let year = Number(numericDate[3]);

    if (year < 100) year += 2000;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0"
    )}`;
  }

  return "";
}

function findLabeledValue(text, patterns) {
  const lines = normalizePdfText(text).split("\n");

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }

  return "";
}

function findData(text, file) {
  const clean = normalizePdfText(text);

  const customer = extractCustomerName(clean);

  const number =
    findLabeledValue(clean, [
      /(?:factuurnummer|factuur\s*nr\.?|factuurnr\.?)\s*[:#\-]?\s*([A-Z0-9/_\-]{2,})/i,
      /(?:invoice\s*(?:number|no\.?))\s*[:#\-]?\s*([A-Z0-9/_\-]{2,})/i,
      /(?:facture\s*n[°o]?)\s*[:#\-]?\s*([A-Z0-9/_\-]{2,})/i
    ]) || file.name.replace(/\.pdf$/i, "");

  const invoiceDateText = findLabeledValue(clean, [
    /(?:factuurdatum|datum factuur)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[a-zéèêûôîï.]+\s+\d{4})/i,
    /(?:invoice date|date de facture)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[a-zéèêûôîï.]+\s+\d{4})/i
  ]);

  const dueDateText = findLabeledValue(clean, [
    /(?:vervaldatum|vervaldag|te betalen voor)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[a-zéèêûôîï.]+\s+\d{4})/i,
    /(?:due date|date d'échéance)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[a-zéèêûôîï.]+\s+\d{4})/i
  ]);

  const totalText = findLabeledValue(clean, [
    /(?:totaal te betalen|factuurtotaal|totaal incl\.?\s*btw|te betalen)\s*[:€\s]*([0-9.\s]+[,\.]\d{2})/i,
    /(?:grand total|total à payer|total ttc)\s*[:€\s]*([0-9.\s]+[,\.]\d{2})/i
  ]);

  const vatText = findLabeledValue(clean, [
    /(?:btw(?:\s*bedrag)?|vat|tva)\s*[:€\s]*([0-9.\s]+[,\.]\d{2})/i
  ]);

  const netText = findLabeledValue(clean, [
    /(?:exclusief btw|excl\.?\s*btw|subtotaal)\s*[:€\s]*([0-9.\s]+[,\.]\d{2})/i,
    /(?:subtotal|hors tva|total ht)\s*[:€\s]*([0-9.\s]+[,\.]\d{2})/i
  ]);

  let total = parseMoney(totalText);
  let vat = parseMoney(vatText);
  let net = parseMoney(netText);

  if (!net && total && vat) {
    net = Math.round((total - vat) * 100) / 100;
  }

  if (!vat && total && net) {
    vat = Math.round((total - net) * 100) / 100;
  }

  if (!total && net) {
    total = Math.round((net + vat) * 100) / 100;
  }

  return {
    customer,
    number,
    date: toISO(invoiceDateText) || new Date().toISOString().slice(0, 10),
    due: toISO(dueDateText),
    net,
    vat,
    total,
    text: clean.slice(0, 4000)
  };
}

function uploadModal() {
  modal(`
    <h2>Verkoopfactuur uploaden</h2>

    <form id="pdfForm" class="form">
      <label class="drop full">
        Kies een PDF-factuur
        <input id="pdfFile" type="file" accept="application/pdf" required>
      </label>

      <div id="pdfStatus" class="note full">
        Na selectie probeert de app de factuurgegevens automatisch te lezen.
      </div>

      <label>
        Klant
        <input name="customer" autocomplete="organization" required>
      </label>

      <label>
        Factuurnummer
        <input name="number" required>
      </label>

      <label>
        Factuurdatum
        <input name="date" type="date" required>
      </label>

      <label>
        Vervaldatum
        <input name="due" type="date">
      </label>

      <label>
        Exclusief btw
        <input name="net" type="number" min="0" step="0.01" inputmode="decimal" required>
      </label>

      <label>
        Btw
        <input name="vat" type="number" min="0" step="0.01" inputmode="decimal" required>
      </label>

      <label>
        Totaal
        <input name="total" type="number" min="0" step="0.01" inputmode="decimal" required>
      </label>

      <label>
        Btw-tarief
        <select name="rate">
          <option value="21">21%</option>
          <option value="12">12%</option>
          <option value="6">6%</option>
          <option value="0">0%</option>
        </select>
      </label>

      <div class="preview full" id="pdfText">
        Nog geen tekst uitgelezen.
      </div>

      <label class="full">
        <input name="confirmed" type="checkbox" required style="width:auto">
        Ik heb klant, factuurnummer, datums en bedragen gecontroleerd.
      </label>

      <button class="btn full" type="submit">
        PDF opslaan en definitief boeken
      </button>
    </form>
  `);
}

function modal(html) {
  $("#modalBody").innerHTML = html;
  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

async function handleFile(file) {
  if (!file || file.type !== "application/pdf") {
    toast("Kies een geldig PDF-bestand");
    return;
  }

  const statusElement = $("#pdfStatus");
  const textElement = $("#pdfText");
  const form = $("#pdfForm");

  statusElement.textContent = "PDF wordt gelezen...";

  try {
    const text = await extractPdf(file);
    const invoiceData = findData(text, file);

    form.customer.value = invoiceData.customer || "";
    form.number.value = invoiceData.number || "";
    form.date.value = invoiceData.date || "";
    form.due.value = invoiceData.due || "";
    form.net.value = invoiceData.net || "";
    form.vat.value = invoiceData.vat || "";
    form.total.value = invoiceData.total || "";

    textElement.textContent =
      invoiceData.text ||
      "Geen tekstlaag gevonden. Vul de gegevens handmatig in.";

    if (!invoiceData.customer) {
      statusElement.textContent =
        "De klantnaam kon niet betrouwbaar worden gevonden. Vul de klant zelf in en controleer alle andere gegevens.";
      form.customer.focus();
    } else {
      statusElement.textContent =
        "Gegevens gevonden. Controleer klant, factuurnummer, datums en bedragen voor je boekt.";
    }
  } catch (error) {
    statusElement.textContent =
      "Automatisch lezen is niet gelukt. Vul de gegevens handmatig in.";
    textElement.textContent = error.message || "Onbekende PDF-fout.";
  }
}

async function savePdfInvoice(form) {
  const file = $("#pdfFile").files[0];
  const formData = new FormData(form);

  if (!file) {
    toast("Kies eerst een PDF");
    return;
  }

  const net = Number(formData.get("net"));
  const vat = Number(formData.get("vat"));
  const total = Number(formData.get("total"));

  if (Math.abs(net + vat - total) > 0.02) {
    toast("Exclusief btw + btw is niet gelijk aan het totaal");
    return;
  }

  form.classList.add("loading");

  try {
    const userId = state.session.user.id;
    const businessId = state.business.id;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

    const path = `${userId}/${businessId}/sales/${new Date().getFullYear()}/${Date.now()}-${safeName}`;

    const uploadResult = await client.storage
      .from("accounting-documents")
      .upload(path, file, {
        contentType: "application/pdf",
        upsert: false
      });

    if (uploadResult.error) throw uploadResult.error;

    const { error } = await client.rpc("book_sales_pdf", {
      p_business_id: businessId,
      p_customer_name: String(formData.get("customer")).trim(),
      p_invoice_number: String(formData.get("number")).trim(),
      p_invoice_date: formData.get("date"),
      p_due_date: formData.get("due") || null,
      p_net: net,
      p_vat: vat,
      p_total: total,
      p_vat_rate: Number(formData.get("rate")),
      p_storage_path: path,
      p_file_name: file.name,
      p_file_size: file.size
    });

    if (error) {
      await client.storage.from("accounting-documents").remove([path]);
      throw error;
    }

    closeModal();
    toast("Factuur en dubbele boeking opgeslagen");
    await refresh();
  } catch (error) {
    toast(error.message || "Opslaan mislukt");
  } finally {
    form.classList.remove("loading");
  }
}

async function deleteInvoice(id) {
  if (!confirm("Conceptfactuur verwijderen?")) return;

  const invoice = state.invoices.find(item => item.id === id);

  if (invoice?.status !== "draft") {
    toast("Alleen concepten kunnen worden verwijderd");
    return;
  }

  const { error } = await client.from("invoices").delete().eq("id", id);

  if (error) {
    toast(error.message);
    return;
  }

  toast("Concept verwijderd");
  await refresh();
}

async function openDoc(path) {
  const { data, error } = await client.storage
    .from("accounting-documents")
    .createSignedUrl(path, 60);

  if (error) {
    toast(error.message);
    return;
  }

  window.open(data.signedUrl, "_blank");
}

$("#authForm").onsubmit = async event => {
  event.preventDefault();

  const formData = new FormData(event.target);
  const { error } = await client.auth.signInWithPassword({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (error) {
    toast(error.message);
    return;
  }

  location.reload();
};

$("#signupBtn").onclick = async () => {
  const formData = new FormData($("#authForm"));

  const { error } = await client.auth.signUp({
    email: formData.get("email"),
    password: formData.get("password")
  });

  toast(
    error
      ? error.message
      : "Account gemaakt. Controleer eventueel je e-mail en log daarna in."
  );
};

$("#setupForm").onsubmit = async event => {
  event.preventDefault();

  const formData = new FormData(event.target);
  const year = Number(formData.get("year"));
  event.target.classList.add("loading");

  try {
    const { data: businessId, error: businessError } = await client.rpc(
      "create_my_business",
      {
        business_name: formData.get("name"),
        business_enterprise_number: formData.get("enterprise") || null,
        business_vat_number: formData.get("vat") || null
      }
    );

    if (businessError) throw businessError;

    const { error: initializationError } = await client.rpc(
      "initialize_business_accounting",
      {
        target_business: businessId,
        fiscal_year_name: String(year),
        fiscal_year_start: `${year}-01-01`,
        fiscal_year_end: `${year}-12-31`
      }
    );

    if (initializationError) throw initializationError;

    location.reload();
  } catch (error) {
    toast(error.message || "Inrichting mislukt");
  } finally {
    event.target.classList.remove("loading");
  }
};

document.addEventListener("click", event => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    state.page = pageButton.dataset.page;
    render();
  }

  if (event.target.closest("[data-upload]") || event.target.id === "quickUpload") {
    uploadModal();
  }

  if (event.target.closest("[data-close]")) {
    closeModal();
  }

  const deleteButton = event.target.closest("[data-delete-invoice]");
  if (deleteButton) {
    deleteInvoice(deleteButton.dataset.deleteInvoice);
  }

  const openButton = event.target.closest("[data-open-doc]");
  if (openButton) {
    openDoc(openButton.dataset.openDoc);
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "pdfFile") {
    handleFile(event.target.files[0]);
  }
});

document.addEventListener("submit", event => {
  if (event.target.id === "pdfForm") {
    event.preventDefault();
    savePdfInvoice(event.target);
  }
});

$("#logoutBtn").onclick = async () => {
  await client.auth.signOut();
  location.reload();
};

$("#menuBtn").onclick = () => {
  $(".sidebar").classList.toggle("open");
};

boot();
