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

const $ = (selector) => document.querySelector(selector);
const euro = (value) =>
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

function show(selector) {
  ["#authScreen", "#setupScreen", "#app"].forEach((item) =>
    $(item).classList.add("hidden")
  );
  $(selector).classList.remove("hidden");
}

async function boot() {
  const { data, error } = await client.auth.getSession();
  if (error) return toast(error.message);
  state.session = data.session;
  if (!state.session) return show("#authScreen");
  await loadBusiness();
}

async function loadBusiness() {
  const { data, error } = await client
    .from("business_users")
    .select("business_id, role, businesses(*)")
    .eq("user_id", state.session.user.id)
    .limit(1)
    .maybeSingle();

  if (error) return toast(error.message);
  if (!data) return show("#setupScreen");

  state.business = data.businesses;
  show("#app");
  await refresh();
}

async function refresh() {
  const businessId = state.business.id;
  const [invoiceResult, entryResult, documentResult] = await Promise.all([
    client
      .from("invoices")
      .select("*, contacts(name)")
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

  const error = invoiceResult.error || entryResult.error || documentResult.error;
  if (error) return toast(error.message);

  state.invoices = invoiceResult.data || [];
  state.entries = entryResult.data || [];
  state.documents = documentResult.data || [];
  render();
}

function render() {
  document.querySelectorAll("[data-page]").forEach((button) =>
    button.classList.toggle("active", button.dataset.page === state.page)
  );

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
  const sales = state.invoices.filter((item) => item.direction === "sale");
  const total = sales.reduce((sum, item) => sum + Number(item.total_amount), 0);
  const vat = sales.reduce((sum, item) => sum + Number(item.vat_amount), 0);

  return `
    <div class="note">
      <b>Live verbonden met Supabase</b><br>
      Upload een verkoopfactuur als PDF. Controleer daarna klant, datum en bedragen.
    </div>
    <div class="grid kpis">
      <div class="card kpi"><small>Verkoop</small><b>${euro(total)}</b><span>${sales.length} facturen</span></div>
      <div class="card kpi"><small>Btw verkoop</small><b>${euro(vat)}</b><span>uit geboekte facturen</span></div>
      <div class="card kpi"><small>Journaalposten</small><b>${state.entries.length}</b><span>dubbele boekingen</span></div>
      <div class="card kpi"><small>Documenten</small><b>${state.documents.length}</b><span>veilig opgeslagen</span></div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="section-head"><h2>Recente facturen</h2><button class="btn" data-upload>PDF uploaden</button></div>
      ${invoiceTable(sales.slice(0, 6))}
    </div>`;
}

function invoiceTable(rows) {
  if (!rows.length) return `<div class="empty">Nog geen facturen.</div>`;

  return `<div style="overflow:auto"><table>
    <thead><tr><th>Nummer</th><th>Klant</th><th>Datum</th><th>Status</th><th class="amount">Totaal</th><th></th></tr></thead>
    <tbody>${rows.map((item) => `
      <tr>
        <td><b>${escapeHtml(item.invoice_number)}</b></td>
        <td>${escapeHtml(item.contacts?.name || "Onbekend")}</td>
        <td>${escapeHtml(item.invoice_date)}</td>
        <td><span class="badge ${item.status}">${item.status === "finalized" ? "Definitief" : "Concept"}</span></td>
        <td class="amount">${euro(item.total_amount)}</td>
        <td>${item.status === "draft" ? `<button class="btn danger" data-delete-invoice="${item.id}">Verwijder</button>` : ""}</td>
      </tr>`).join("")}</tbody>
  </table></div>`;
}

function viewsSales() {
  return `<div class="toolbar"><h2>Verkoopfacturen</h2><button class="btn" data-upload>PDF-factuur uploaden</button></div>
    <div class="card">${invoiceTable(state.invoices.filter((item) => item.direction === "sale"))}</div>`;
}

function viewsAccounting() {
  if (!state.entries.length) return `<div class="card"><div class="empty">Nog geen journaalposten.</div></div>`;
  return `<div class="card"><div class="section-head"><h2>Journaalposten</h2><span class="badge finalized">debet = credit</span></div>
    <div style="overflow:auto"><table><thead><tr><th>Nr.</th><th>Datum</th><th>Omschrijving</th><th>Status</th></tr></thead>
    <tbody>${state.entries.map((item) => `<tr><td>${item.entry_number}</td><td>${escapeHtml(item.booked_on)}</td><td>${escapeHtml(item.description)}</td><td><span class="badge ${item.status}">${escapeHtml(item.status)}</span></td></tr>`).join("")}</tbody></table></div></div>`;
}

function viewsDocuments() {
  return `<div class="toolbar"><h2>Documenten</h2><button class="btn" data-upload>PDF toevoegen</button></div>
    <div class="card">${state.documents.length ? state.documents.map((document) => `
      <div class="section-head"><div><b>${escapeHtml(document.file_name)}</b><br><small>${escapeHtml(document.document_date || "")}</small></div>
      <button class="btn secondary" data-open-doc="${escapeHtml(document.storage_path)}">Open</button></div>`).join("") : `<div class="empty">Nog geen documenten.</div>`}</div>`;
}

function viewsSettings() {
  return `<div class="card"><h2>${escapeHtml(state.business.name)}</h2>
    <p>Ondernemingsnummer: ${escapeHtml(state.business.enterprise_number || "-")}</p>
    <p>Btw-nummer: ${escapeHtml(state.business.vat_number || "-")}</p>
    <p><b>Database:</b> verbonden</p></div>`;
}

const views = {
  dashboard: viewsDashboard,
  sales: viewsSales,
  accounting: viewsAccounting,
  documents: viewsDocuments,
  settings: viewsSettings
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

async function extractPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }

  return pages.join("\n");
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function parseMoney(value) {
  if (!value) return 0;
  let normalized = String(value).replace(/[^0-9,.-]/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  return Number(normalized) || 0;
}

function extractValueAfterLabel(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`(?:^|\\n|\\s)${label}\\s*[:#-]?\\s*([^\\n]{2,120})`, "i");
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function cleanCustomerCandidate(value) {
  let candidate = String(value || "")
    .split(/\s{2,}|\||;/)[0]
    .replace(/^(naam|name|client)\s*[:#-]?\s*/i, "")
    .trim();

  const forbidden = [
    "algemene voorwaarden", "voorwaarden", "terms and conditions",
    "betalingsvoorwaarden", "factuurnummer", "factuurdatum", "vervaldatum",
    "invoice number", "invoice date", "due date", "omschrijving", "description",
    "totaal", "total", "btw", "vat", "tva", "iban", "mededeling"
  ];

  const lower = candidate.toLowerCase();
  if (!candidate || candidate.length < 2 || candidate.length > 100) return "";
  if (forbidden.some((word) => lower.includes(word))) return "";
  if (/€|\b\d+[,.]\d{2}\b/.test(candidate)) return "";
  if (/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(candidate)) return "";
  return candidate;
}

function extractCustomerName(text) {
  const labelled = extractValueAfterLabel(text, [
    "klantnaam", "klant", "factuur aan", "gefactureerd aan", "facturatie aan",
    "customer name", "customer", "bill to", "invoice to",
    "nom du client", "client", "facturé à", "facture à"
  ]);
  return cleanCustomerCandidate(labelled);
}

function toISO(value) {
  if (!value) return "";
  const months = {
    jan:1,januari:1,feb:2,februari:2,mrt:3,maart:3,apr:4,april:4,mei:5,
    jun:6,juni:6,jul:7,juli:7,aug:8,augustus:8,sep:9,sept:9,september:9,
    okt:10,oktober:10,nov:11,november:11,dec:12,december:12
  };
  const text = String(value).toLowerCase().replace(/,/g, "").trim();
  let match = text.match(/\b(\d{1,2})\s+([a-zéû.]+)\s+(\d{4})\b/i);
  if (match) {
    const month = months[match[2].replace(".", "")];
    if (month) return `${match[3]}-${String(month).padStart(2,"0")}-${String(match[1]).padStart(2,"0")}`;
  }
  match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (!match) return "";
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  return `${year}-${String(match[2]).padStart(2,"0")}-${String(match[1]).padStart(2,"0")}`;
}

function amountAfterLabel(text, labels) {
  const label = labels.join("|");
  const match = text.match(new RegExp(`(?:${label})[^0-9]{0,30}([0-9][0-9 .]*[,.][0-9]{2})`, "i"));
  return parseMoney(match?.[1]);
}

function findData(text, file) {
  const clean = normalizeText(text);
  const numberText = extractValueAfterLabel(clean, [
    "factuurnummer", "factuur nr\\.?", "factuurnr\\.?", "invoice number", "invoice no\\.?", "facture n[°o]?"
  ]);
  const numberMatch = numberText.match(/[A-Z0-9/_-]{2,}/i);

  const dateText = extractValueAfterLabel(clean, ["factuurdatum", "datum factuur", "invoice date", "date de facture"]);
  const dueText = extractValueAfterLabel(clean, ["vervaldatum", "vervaldag", "due date", "date d'échéance"]);

  let net = amountAfterLabel(clean, ["exclusief btw", "excl\\.? btw", "subtotaal", "subtotal", "hors tva"]);
  let vat = amountAfterLabel(clean, ["btw bedrag", "btw", "vat", "tva"]);
  let total = amountAfterLabel(clean, ["totaal te betalen", "factuurtotaal", "totaal incl\\.? btw", "grand total", "total à payer", "te betalen"]);

  if (!net && total && vat) net = Math.round((total - vat) * 100) / 100;
  if (!vat && total && net) vat = Math.round((total - net) * 100) / 100;
  if (!total && net) total = Math.round((net + vat) * 100) / 100;

  return {
    customer: extractCustomerName(clean),
    number: numberMatch?.[0] || file.name.replace(/\.pdf$/i, ""),
    date: toISO(dateText) || new Date().toISOString().slice(0, 10),
    due: toISO(dueText),
    net, vat, total,
    text: clean.slice(0, 4000)
  };
}

function uploadModal() {
  modal(`<h2>Verkoopfactuur uploaden</h2>
    <form id="pdfForm" class="form">
      <label class="drop full">Kies een PDF-factuur<input id="pdfFile" type="file" accept="application/pdf" required></label>
      <div id="pdfStatus" class="note full">Na selectie leest de app de factuurgegevens. Controleer alles voor je boekt.</div>
      <label>Klantnaam<input name="customer" required autocomplete="organization"></label>
      <label>Factuurnummer<input name="number" required></label>
      <label>Factuurdatum<input name="date" type="date" required></label>
      <label>Vervaldatum<input name="due" type="date"></label>
      <label>Exclusief btw<input name="net" type="number" min="0" step="0.01" required></label>
      <label>Btw<input name="vat" type="number" min="0" step="0.01" required></label>
      <label>Totaal<input name="total" type="number" min="0" step="0.01" required></label>
      <label>Btw-tarief<select name="rate"><option value="21">21%</option><option value="12">12%</option><option value="6">6%</option><option value="0">0%</option></select></label>
      <div class="preview full" id="pdfText">Nog geen tekst uitgelezen.</div>
      <label class="full"><input name="confirmed" type="checkbox" required style="width:auto"> Ik heb klant, datum en bedragen gecontroleerd.</label>
      <button class="btn full" type="submit">PDF opslaan en definitief boeken</button>
    </form>`);
}

function modal(html) {
  $("#modalBody").innerHTML = html;
  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

async function handleFile(file) {
  if (!file || file.type !== "application/pdf") return toast("Kies een geldig PDF-bestand");
  if (file.size > 10 * 1024 * 1024) return toast("De PDF mag maximaal 10 MB zijn");

  $("#pdfStatus").textContent = "PDF wordt gelezen…";
  try {
    const text = await extractPdf(file);
    const data = findData(text, file);
    const form = $("#pdfForm");

    form.customer.value = data.customer;
    form.number.value = data.number;
    form.date.value = data.date;
    form.due.value = data.due;
    form.net.value = data.net || "";
    form.vat.value = data.vat || "";
    form.total.value = data.total || "";
    $("#pdfText").textContent = data.text || "Geen tekstlaag gevonden. Vul de gegevens handmatig in.";
    $("#pdfStatus").textContent = data.customer
      ? "Gegevens gevonden. Controleer klant, datums en bedragen."
      : "Geen betrouwbare klantnaam gevonden. Vul de klantnaam zelf in en controleer de bedragen.";
  } catch (error) {
    $("#pdfStatus").textContent = "Automatisch lezen is niet gelukt. Vul de velden handmatig in.";
    $("#pdfText").textContent = error.message || "Onbekende PDF-fout.";
  }
}

async function savePdfInvoice(form) {
  const file = $("#pdfFile").files[0];
  const values = new FormData(form);
  if (!file) return toast("Kies eerst een PDF");

  const net = Number(values.get("net"));
  const vat = Number(values.get("vat"));
  const total = Number(values.get("total"));
  if (Math.abs(net + vat - total) > 0.02) return toast("Exclusief btw + btw moet gelijk zijn aan totaal");

  form.classList.add("loading");
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const userId = state.session.user.id;
    const path = `${userId}/${state.business.id}/sales/${new Date().getFullYear()}/${Date.now()}-${safeName}`;

    const upload = await client.storage
      .from("accounting-documents")
      .upload(path, file, { contentType: "application/pdf", upsert: false });
    if (upload.error) throw upload.error;

    const result = await client.rpc("book_sales_pdf", {
      p_business_id: state.business.id,
      p_customer_name: values.get("customer").trim(),
      p_invoice_number: values.get("number").trim(),
      p_invoice_date: values.get("date"),
      p_due_date: values.get("due") || null,
      p_net: net,
      p_vat: vat,
      p_total: total,
      p_vat_rate: Number(values.get("rate")),
      p_storage_path: path,
      p_file_name: file.name,
      p_file_size: file.size
    });

    if (result.error) {
      await client.storage.from("accounting-documents").remove([path]);
      throw result.error;
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
  const invoice = state.invoices.find((item) => item.id === id);
  if (invoice?.status !== "draft") return toast("Alleen concepten kunnen worden verwijderd");
  const { error } = await client.from("invoices").delete().eq("id", id);
  if (error) return toast(error.message);
  toast("Concept verwijderd");
  await refresh();
}

async function openDoc(path) {
  const { data, error } = await client.storage
    .from("accounting-documents")
    .createSignedUrl(path, 60);
  if (error) return toast(error.message);
  window.open(data.signedUrl, "_blank");
}

$("#authForm").onsubmit = async (event) => {
  event.preventDefault();
  const values = new FormData(event.target);
  const { error } = await client.auth.signInWithPassword({
    email: values.get("email"),
    password: values.get("password")
  });
  if (error) return toast(error.message);
  location.reload();
};

$("#signupBtn").onclick = async () => {
  const values = new FormData($("#authForm"));
  const { error } = await client.auth.signUp({
    email: values.get("email"),
    password: values.get("password")
  });
  toast(error ? error.message : "Account gemaakt. Controleer eventueel je e-mail en log daarna in.");
};

$("#setupForm").onsubmit = async (event) => {
  event.preventDefault();
  const values = new FormData(event.target);
  const year = Number(values.get("year"));
  event.target.classList.add("loading");

  const business = await client.rpc("create_my_business", {
    business_name: values.get("name"),
    business_enterprise_number: values.get("enterprise") || null,
    business_vat_number: values.get("vat") || null
  });
  if (business.error) {
    event.target.classList.remove("loading");
    return toast(business.error.message);
  }

  const init = await client.rpc("initialize_business_accounting", {
    target_business: business.data,
    fiscal_year_name: String(year),
    fiscal_year_start: `${year}-01-01`,
    fiscal_year_end: `${year}-12-31`
  });
  if (init.error) return toast(init.error.message);
  location.reload();
};

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    state.page = pageButton.dataset.page;
    render();
  }
  if (event.target.closest("[data-upload]") || event.target.id === "quickUpload") uploadModal();
  if (event.target.closest("[data-close]")) closeModal();

  const deleteButton = event.target.closest("[data-delete-invoice]");
  if (deleteButton) deleteInvoice(deleteButton.dataset.deleteInvoice);

  const documentButton = event.target.closest("[data-open-doc]");
  if (documentButton) openDoc(documentButton.dataset.openDoc);
});

document.addEventListener("change", (event) => {
  if (event.target.id === "pdfFile") handleFile(event.target.files[0]);
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "pdfForm") {
    event.preventDefault();
    savePdfInvoice(event.target);
  }
});

$("#logoutBtn").onclick = async () => {
  await client.auth.signOut();
  location.reload();
};

$("#menuBtn").onclick = () => $(".sidebar").classList.toggle("open");
boot();
