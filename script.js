/*******************************
 * CONFIG GOOGLE
 *******************************/
const GOOGLE_CLIENT_ID = "409680992898-1o6olqkdfg6id16sl6tlbilmmjv2hp3e.apps.googleusercontent.com";
const GOOGLE_API_KEY = "AIzaSyDcTlCFm8tb86AKDneF1aJvy4Kl3BfOceI";

// pastas definidas por você
const DRIVE_FOLDER_PDFS = "ORÇAMENTOS DOS CLIENTES";
const DRIVE_FOLDER_JSON = "DADOS CLIENTES";

// escopos necessários
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
].join(" ");

/*******************************
 * ESTADO DO APP
 *******************************/
let orcamento = {
  cliente: {},
  materiais: [],
  maoDeObra: {},
  observacoes: "",
  dataCriacaoISO: null // ISO string
};

// quando um orçamento é carregado do Drive:
let driveContext = {
  loadedFromDrive: false,
  jsonFileId: null,
  jsonFileName: null
};

// auth
let tokenClient = null;
let accessToken = null;

// cache de pasta -> id
let driveFoldersCache = {
  pdfFolderId: null,
  jsonFolderId: null
};

/*******************************
 * UTIL: Datas BR
 *******************************/
function dataBR(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function dataBRArquivo(date = new Date()) {
  return dataBR(date).replaceAll("/", "-"); // DD-MM-AAAA
}
function parseDataBRToDate(strDDMMYYYY) {
  const [dd, mm, yyyy] = strDDMMYYYY.split("/");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

/*******************************
 * UTIL: Loader Premium (logo flutuando)
 *******************************/
function mostrarLoader(msg = "Carregando...", sub = "Aguarde") {
  const el = document.getElementById("overlayLoader");
  if (!el) return;
  el.querySelector(".float-title").textContent = msg;
  el.querySelector(".float-sub").textContent = sub;
  el.style.display = "flex";
}
function ocultarLoader() {
  const el = document.getElementById("overlayLoader");
  if (!el) return;
  el.style.display = "none";
}

/*******************************
 * UTIL: LocalStorage (temporário)
 *******************************/
function salvarLocalStorage() {
  localStorage.setItem("orcamentoJSM", JSON.stringify({ orcamento, driveContext }));
}
function carregarLocalStorage() {
  const raw = localStorage.getItem("orcamentoJSM");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.orcamento) orcamento = parsed.orcamento;
    if (parsed.driveContext) driveContext = parsed.driveContext;
  } catch {}
}
function limparLocalStorage() {
  localStorage.removeItem("orcamentoJSM");
  // se você usa também:
  localStorage.removeItem("jsm_google_logged"); // opcional (se não quiser deslogar, apague essa linha)

  // reseta objetos em memória também (importante)
  orcamento = {
    cliente: {},
    materiais: [],
    maoDeObra: {},
    observacoes: "",
    dataCriacaoISO: null
  };

  driveContext = { loadedFromDrive: false, jsonFileId: null, jsonFileName: null };
}

/*******************************
 * MENU MOBILE
 *******************************/
function initMenuMobile() {
    const btn = document.getElementById("btnMenu");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    
    if (!btn || !sidebar || !overlay) return;
    
    const toggleMenu = () => {
        sidebar.classList.toggle("open");
        overlay.classList.toggle("active");
        
        // Bloqueia o scroll do corpo quando o menu está aberto
        if (sidebar.classList.contains("open")) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "auto";
        }
    };
    
    // Abre/Fecha no botão ☰
    btn.addEventListener("click", toggleMenu);
    
    // Fecha ao clicar no fundo escuro (fora do menu)
    overlay.addEventListener("click", toggleMenu);
    
    // Fecha ao clicar em qualquer link do menu
    sidebar.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", () => {
            sidebar.classList.remove("open");
            overlay.classList.remove("active");
            document.body.style.overflow = "auto";
        });
    });
}

/*******************************
 * GOOGLE: Carregar SDKs (GIS + GAPI)
 *******************************/
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initGoogleIfNeeded() {
  // carrega GIS e GAPI apenas uma vez
  if (!window.google || !window.gapi) {
    await loadScript("https://accounts.google.com/gsi/client");
    await loadScript("https://apis.google.com/js/api.js");
  }

  await new Promise((resolve) => {
    window.gapi.load("client", resolve);
  });

  await window.gapi.client.init({
    apiKey: GOOGLE_API_KEY,
    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
  });

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPES,
    prompt: "select_account", // ✅ força escolher a conta
    callback: (resp) => {
      accessToken = resp.access_token;
      window.gapi.client.setToken({ access_token: accessToken });
    }
    });
}

async function ensureSignedIn() {
  await initGoogleIfNeeded();
  
  // Se já temos o token nesta sessão, não precisa pedir de novo
  if (accessToken) return true;

  // Vamos pedir o acesso garantindo que o seletor de contas apareça
  return await new Promise((resolve) => {
    tokenClient.callback = (resp) => {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        window.gapi.client.setToken({ access_token: accessToken });
        localStorage.setItem("jsm_google_logged", "1"); // Marca que logou com sucesso
        resolve(true);
      } else {
        console.log("Usuário cancelou ou houve erro no login.");
        resolve(false);
      }
    };

    // ✅ O SEGREDO: "select_account" força o Google a mostrar a lista de e-mails
    // Mesmo que você já tenha logado antes, ele vai perguntar qual conta quer usar.
    tokenClient.requestAccessToken({ prompt: "select_account" });
  });
}

/*******************************
 * GOOGLE DRIVE: Helpers
 *******************************/
function escapeQueryValue(v) {
  return v.replace(/'/g, "\'");
}

async function findFolderIdByName(folderName) {
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `name='${escapeQueryValue(folderName)}'`
  ].join(" and ");

  const res = await window.gapi.client.drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 10
  });

  const folder = (res.result.files || [])[0];
  return folder ? folder.id : null;
}

async function ensureFolders() {
  if (!driveFoldersCache.pdfFolderId) {
    driveFoldersCache.pdfFolderId = await findFolderIdByName(DRIVE_FOLDER_PDFS);
    if (!driveFoldersCache.pdfFolderId) throw new Error(`Pasta não encontrada no Drive: ${DRIVE_FOLDER_PDFS}`);
  }
  if (!driveFoldersCache.jsonFolderId) {
    driveFoldersCache.jsonFolderId = await findFolderIdByName(DRIVE_FOLDER_JSON);
    if (!driveFoldersCache.jsonFolderId) throw new Error(`Pasta não encontrada no Drive: ${DRIVE_FOLDER_JSON}`);
  }
}

async function driveListJsonSuggestions(searchText) {
  const folderId = driveFoldersCache.jsonFolderId;
  const text = searchText.trim();
  if (!text) return [];

  // buscamos por nome contendo o texto e apenas JSON
  const q = [
    `'${folderId}' in parents`,
    "trashed=false",
    "mimeType='application/json'",
    `name contains '${escapeQueryValue(text)}'`
  ].join(" and ");

  const res = await window.gapi.client.drive.files.list({
    q,
    fields: "files(id,name,createdTime,modifiedTime)",
    orderBy: "createdTime desc",
    pageSize: 10
  });

  // queremos até 5 sugestões
  const files = (res.result.files || []).slice(0, 5);

  // nosso padrão é: "NOME — DD-MM-AAAA.json"
  // vamos exibir no autocomplete: "NOME — DD/MM/AAAA"
  return files.map(f => {
    const display = fileNameToDisplay(f.name);
    return { id: f.id, name: f.name, display };
  });
}

function fileNameToDisplay(fileName) {
  // ex: "Maria da Silva — 05-02-2026.json" => "Maria da Silva — 05/02/2026"
  const clean = fileName.replace(/\.json$/i, "");
  const parts = clean.split("—").map(p => p.trim());
  if (parts.length < 2) return clean;
  const nome = parts[0];
  const data = parts[1].replaceAll("-", "/");
  return `${nome} — ${data}`;
}

function buildJsonFileName(clienteNome, dateObj) {
  // JSON no Drive: "Nome — DD-MM-AAAA.json"
  const data = dataBRArquivo(dateObj);
  return `${clienteNome} — ${data}.json`;
}

function buildPdfFileName(clienteNome, dateObj) {
  // PDF no Drive: "JSM_Orçamento_NomeCliente_DD-MM-AAAA.pdf"
  const safe = (clienteNome || "Cliente").replace(/[^a-zA-Z0-9]/g, "_");
  const data = dataBRArquivo(dateObj);
  return `JSM_Orçamento_${safe}_${data}.pdf`;
}

async function driveDownloadFileText(fileId) {
  const res = await window.gapi.client.drive.files.get({
    fileId,
    alt: "media"
  });
  // gapi retorna já como string/obj dependendo; aqui forçamos string
  return typeof res.body === "string" ? res.body : JSON.stringify(res.body);
}

async function driveUploadMultipart({ folderId, fileName, mimeType, blob }) {
  // multipart/related
  const metadata = {
    name: fileName,
    parents: [folderId]
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const metaPart =
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata);

  const filePart =
    `Content-Type: ${mimeType}\r\n\r\n`;

  const multipartBody = new Blob(
    [
      delimiter,
      metaPart,
      delimiter,
      filePart,
      blob,
      closeDelim
    ],
    { type: `multipart/related; boundary="${boundary}"` }
  );

  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary="${boundary}"`
    },
    body: multipartBody
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Falha upload Drive: ${resp.status} ${txt}`);
  }
  return await resp.json();
}

async function driveUpdateFileMedia({ fileId, mimeType, blob }) {
  const resp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType
    },
    body: blob
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Falha update Drive: ${resp.status} ${txt}`);
  }
  return await resp.json();
}

/*******************************
 * PDF: Logo DataURL
 *******************************/
async function carregarImagemComoDataURL(url) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/*******************************
 * Compartilhar PDF (WhatsApp no mobile via Share)
 *******************************/
async function compartilharOuBaixarPDF(doc, nomeArquivo) {
  const blob = doc.output("blob");
  const file = new File([blob], nomeArquivo, { type: "application/pdf" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: "Orçamento JSM",
        text: "Segue o orçamento solicitado.",
        files: [file]
      });
    } catch (error) {
      console.log("Compartilhamento cancelado ou erro:", error);
      doc.save(nomeArquivo);
    }
  } else {
    doc.save(nomeArquivo);
    alert("Seu navegador não permite compartilhar arquivo. O PDF foi baixado.");
  }

  return { blob, file };
}

/*******************************
 * UI: preencher campos por página
 *******************************/
function preencherCampos() {
  // cliente
  const elNome = document.getElementById("cliente-nome");
  if (elNome) elNome.value = orcamento.cliente?.nome || "";

  const ids = ["cliente-endereco","cliente-bairro","cliente-cidade","cliente-telefone","cliente-email","cliente-cnpj"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const key = id.replace("cliente-","");
    el.value = orcamento.cliente?.[key] || "";
  }

  // mao de obra
  const elDesc = document.getElementById("mao-obra-descricao");
  if (elDesc) elDesc.value = orcamento.maoDeObra?.descricao || "";
  const elVal = document.getElementById("mao-obra-valor");
  if (elVal) elVal.value = orcamento.maoDeObra?.valor ?? "";

  // observacoes
  const elObs = document.getElementById("observacoes-text");
  if (elObs) elObs.value = orcamento.observacoes || "";
}

/*******************************
 * Materiais
 *******************************/
function adicionarMaterial() {
  orcamento.materiais.push({ descricao: "", quantidade: 1, valorUnitario: 0 });
  salvarLocalStorage();
  atualizarMateriais();
}
function removerMaterial(index) {
  orcamento.materiais.splice(index, 1);
  salvarLocalStorage();
  atualizarMateriais();
}
function atualizarMateriais() {
  const list = document.getElementById("materiais-list");
  if (!list) return;

  list.innerHTML = "";

  orcamento.materiais.forEach((m, idx) => {
    const row = document.createElement("div");
    row.className = "material-item";

    row.innerHTML = `
      <div class="material-field">
        <label class="material-label" for="mat-desc-${idx}">Descrição</label>
        <input id="mat-desc-${idx}" type="text" placeholder="Ex: Cabo de rede" value="${m.descricao ?? ""}" data-k="descricao" data-i="${idx}">
      </div>

      <div class="material-field">
        <label class="material-label" for="mat-qtd-${idx}">Quantidade</label>
        <input id="mat-qtd-${idx}" type="number" placeholder="Ex: 10" value="${m.quantidade ?? 1}" data-k="quantidade" data-i="${idx}">
      </div>

      <div class="material-field">
        <label class="material-label" for="mat-val-${idx}">Valor unitário</label>
        <input id="mat-val-${idx}" type="number" step="0.01" placeholder="Ex: 12,50" value="${m.valorUnitario ?? 0}" data-k="valorUnitario" data-i="${idx}">
      </div>

      <button class="remove-material" type="button" data-remove="${idx}">Remover</button>
    `;

    list.appendChild(row);
  });

  // listeners
  list.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      const k = e.target.dataset.k;

      let v = e.target.value;
      if (e.target.type === "number") v = Number(v);

      orcamento.materiais[i][k] = v;
      salvarLocalStorage();
    });
  });

  list.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removerMaterial(Number(btn.dataset.remove)));
  });
}

/*******************************
 * Resumo
 *******************************/
function atualizarResumo() {
  const el = document.getElementById("resumo-content");
  if (!el) return;

  const totalMateriais = orcamento.materiais.reduce((s, m) => s + (Number(m.quantidade)||0)*(Number(m.valorUnitario)||0), 0);
  const totalMao = Number(orcamento.maoDeObra?.valor) || 0;
  const total = totalMateriais + totalMao;

  el.innerHTML = `
    <h3>Cliente</h3>
    <p><strong>Nome:</strong> ${orcamento.cliente?.nome || "-"}</p>

    <h3>Materiais</h3>
    <p><strong>Itens:</strong> ${orcamento.materiais.length}</p>
    <p><strong>Total Materiais:</strong> R$ ${totalMateriais.toFixed(2)}</p>

    <h3>Mão de Obra</h3>
    <p><strong>Descrição:</strong> ${orcamento.maoDeObra?.descricao || "-"}</p>
    <p><strong>Valor:</strong> R$ ${totalMao.toFixed(2)}</p>

    <h3>Total Geral</h3>
    <p><strong>R$ ${total.toFixed(2)}</strong></p>
  `;
}

/*******************************
 * Geração PDF + Upload Drive + Share
 *******************************/
async function gerarPDF() {
  const ok = await ensureSignedIn();
  if (!ok) {
    alert("Login Google não autorizado. Não foi possível salvar no Drive.");
    return;
  }

  await ensureFolders();

  mostrarLoader("Gerando PDF...", "Preparando arquivo para salvar e compartilhar");

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");

    // Carregar logo proporcional
    const logoDataUrl = await carregarImagemComoDataURL("./logo.png");

    // Cores
    const azul = [10, 26, 61];
    const laranja = [244, 122, 32];
    const branco = [255, 255, 255];
    const cinza = [80, 80, 80];
    const cinzaClaro = [245, 245, 245];

    // =====================
    // BARRA LATERAL AZUL
    // =====================
    doc.setFillColor(...azul);
    doc.rect(0, 0, 22, 297, "F");

    // =====================
    // LOGO SOBREPOSTA (SEM BORDA BRANCA)
    // metade na barra azul / metade no branco
    // =====================
    if (logoDataUrl) {
      const props = doc.getImageProperties(logoDataUrl);
      const logoW = 40; // grande
      const logoH = (props.height * logoW) / props.width;

      const logoX = 6;  // começa dentro da barra azul (sobreposição)
      const logoY = 8;

      doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoW, logoH);
    }

    // =====================
    // CABEÇALHO MODERNO
    // =====================
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(...azul);
    doc.text("ORÇAMENTO", 65, 22);

    doc.setDrawColor(...laranja);
    doc.setLineWidth(2);
    doc.line(65, 27, 200, 27);

    // Dados empresa
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...cinza);
    doc.text("JSM Comunicações e Instalação em Geral", 65, 35);
    doc.text("CNPJ: 29.399.090/0001-17 | IE: 10866739483", 65, 41);
    doc.text("Fone: (81) 9.9989-6528 / 9.8653-1802", 65, 47);
    doc.text("Rua Itaquicé, 384a - Ipsep - Recife/PE", 65, 53);

    // =====================
    // BLOCO CLIENTE (LARANJA)
    // =====================
    doc.setFillColor(...laranja);
    doc.rect(22, 62, 188, 10, "F");
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...branco);
    doc.text("DADOS DO CLIENTE", 27, 69);

    // Placeholders para campos vazios
    const nomeCliente = toUpperSafe(orcamento.cliente?.nome || "-");

    const cnpjRaw = (orcamento.cliente?.cnpj || "").trim();
    const cnpjCliente = cnpjRaw ? toUpperSafe(cnpjRaw) : "NÃO FOI COLOCADO";

    const endRaw = [
      (orcamento.cliente?.endereco || "").trim(),
      (orcamento.cliente?.bairro || "").trim(),
      (orcamento.cliente?.cidade || "").trim()
    ].filter(Boolean).join(" - ").trim();
    const enderecoCliente = endRaw ? toUpperSafe(endRaw) : "NÃO FOI COLOCADO";

    const telRaw = (orcamento.cliente?.telefone || "").trim();
    const emailRaw = (orcamento.cliente?.email || "").trim();
    const contatoMontado = [telRaw, emailRaw].filter(Boolean).join(" | ").trim();
    const contatoCliente = contatoMontado ? contatoMontado : "NÃO FOI COLOCADO";

    // Nome do cliente maior e em negrito
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`${nomeCliente}`, 27, 82);

    // Demais dados menores
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`CNPJ: ${cnpjCliente}`, 27, 90);
    doc.text(`Endereço: ${enderecoCliente}`, 27, 96);
    doc.text(`Contato: ${contatoCliente}`, 27, 102);

    // =====================
    // ITENS DO SERVIÇO (BARRA AZUL)
    // =====================
    doc.setFillColor(...azul);
    doc.rect(22, 110, 188, 10, "F");
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...branco);
    doc.text("ITENS DO SERVIÇO", 27, 117);

    // Preparar dados da tabela (materiais + mão de obra como linha extra)
    const tableData = [];
    let refNum = 1;

    (orcamento.materiais || []).forEach((m) => {
      const total = (Number(m.quantidade) || 0) * (Number(m.valorUnitario) || 0);
      tableData.push([
        String(refNum++),
        toUpperSafe(m.descricao || ""),
        String(m.quantidade || ""),
        `R$ ${(Number(m.valorUnitario) || 0).toFixed(2)}`,
        `R$ ${total.toFixed(2)}`
      ]);
    });

    const maoDesc = toUpperSafe(orcamento.maoDeObra?.descricao || "MÃO DE OBRA");
    const maoValor = Number(orcamento.maoDeObra?.valor || 0);
    tableData.push([
      String(refNum++),
      maoDesc,
      "-",
      "-",
      `R$ ${maoValor.toFixed(2)}`
    ]);

    // Tabela até o fim do lado direito (igual à barra azul)
    const pageW = doc.internal.pageSize.getWidth(); // 210
    const leftX = 22;
    const rightM = 0;
    const tableW = pageW - leftX - rightM; // 188

    doc.autoTable({
      startY: 121, // ✅ MAIS COLADO NA BARRA "ITENS DO SERVIÇO"
      head: [["Ref", "Descrição dos Materiais", "Qtd", "Val. Unitário", "Total"]],
      body: tableData,
      theme: "grid",
      tableWidth: tableW,
      margin: { left: leftX, right: rightM },
      headStyles: {
        fillColor: azul,
        textColor: branco,
        fontStyle: "bold",
        fontSize: 10,
        cellPadding: 4,
      },
      bodyStyles: {
        fontSize: 9,
        cellPadding: 3,
        textColor: [0, 0, 0],
        overflow: "linebreak"
      },
      alternateRowStyles: {
        fillColor: cinzaClaro,
      },
      columnStyles: {
        0: { cellWidth: 14, halign: "center" },
        1: { cellWidth: tableW - (14 + 16 + 28 + 28) },
        2: { cellWidth: 16, halign: "center" },
        3: { cellWidth: 28, halign: "right" },
        4: { cellWidth: 28, halign: "right" }
      },
    });

    const afterTable = doc.lastAutoTable.finalY + 12;

    // Observações (cinza claro à esquerda)
    doc.setFillColor(...cinzaClaro);
    doc.rect(22, afterTable, 100, 35, "F");

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...azul);
    doc.text("OBSERVAÇÕES:", 27, afterTable + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const obsText = toUpperSafe(orcamento.observacoes || "NENHUMA OBSERVAÇÃO.");
    const obsLines = doc.splitTextToSize(obsText, 90);
    doc.text(obsLines, 27, afterTable + 14);

    // Data de geração abaixo das observações
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...azul);
    doc.text(`DOCUMENTO GERADO EM: ${dataBR(new Date())}`, 27, afterTable + 32);

    // Totais (laranja à direita)
    doc.setFillColor(...laranja);
    doc.rect(125, afterTable, 85, 35, "F");

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...branco);

    const totalMateriais = (orcamento.materiais || []).reduce(
      (s, m) => s + (Number(m.quantidade) || 0) * (Number(m.valorUnitario) || 0),
      0
    );

    doc.text("SUBTOTAL:", 130, afterTable + 8);
    doc.text(`R$ ${totalMateriais.toFixed(2)}`, 205, afterTable + 8, { align: "right" });

    doc.text("MÃO DE OBRA:", 130, afterTable + 16);
    doc.text(`R$ ${maoValor.toFixed(2)}`, 205, afterTable + 16, { align: "right" });

    doc.setFontSize(14);
    doc.text("TOTAL GERAL:", 130, afterTable + 27);
    doc.text(`R$ ${(totalMateriais + maoValor).toFixed(2)}`, 205, afterTable + 27, { align: "right" });

    // Rodapé (corrigido para JSM)
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Documento gerado pelo Sistema de Orçamentos JSM", 105, 290, { align: "center" });

    // Compartilhar/baixar
    ocultarLoader();
    await compartilharOuBaixarPDF(
      doc,
      buildPdfFileName(toUpperSafe(orcamento.cliente?.nome || "Cliente"), new Date())
    );

    // Upload Drive
    mostrarLoader("Salvando no Google Drive...", "Enviando PDF e dados do orçamento");

    const pdfBlob = doc.output("blob");
    await driveUploadMultipart({
      folderId: driveFoldersCache.pdfFolderId,
      fileName: buildPdfFileName(toUpperSafe(orcamento.cliente?.nome || "Cliente"), new Date()),
      mimeType: "application/pdf",
      blob: pdfBlob
    });

    const jsonObj = {
      cliente: orcamento.cliente,
      materiais: orcamento.materiais,
      maoDeObra: orcamento.maoDeObra,
      observacoes: orcamento.observacoes,
      dataCriacao: dataBR(new Date()),
      dataCriacaoISO: new Date().toISOString()
    };
    const jsonBlob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: "application/json" });

    if (driveContext.loadedFromDrive && driveContext.jsonFileId) {
      const substituir = confirm("Este orçamento foi carregado do Drive.\n\nOK = Substituir o JSON existente\nCancelar = Salvar como novo JSON");
      if (substituir) {
        await driveUpdateFileMedia({
          fileId: driveContext.jsonFileId,
          mimeType: "application/json",
          blob: jsonBlob
        });
      } else {
        const now = new Date();
        const novoNome = `${toUpperSafe(orcamento.cliente?.nome || "Cliente")} — ${dataBRArquivo(new Date())} ${String(now.getHours()).padStart(2,"0")}-${String(now.getMinutes()).padStart(2,"0")}.json`;
        await driveUploadMultipart({
          folderId: driveFoldersCache.jsonFolderId,
          fileName: novoNome,
          mimeType: "application/json",
          blob: jsonBlob
        });
      }
    } else {
      await driveUploadMultipart({
        folderId: driveFoldersCache.jsonFolderId,
        fileName: buildJsonFileName(toUpperSafe(orcamento.cliente?.nome || "Cliente"), new Date()),
        mimeType: "application/json",
        blob: jsonBlob
      });
    }

    limparLocalStorage();
    ocultarLoader();
    alert("Orçamento gerado, compartilhado e salvo no Google Drive com sucesso.");
    // Volta para o início com tudo zerado
    window.location.replace("index.html");

  } catch (e) {
    ocultarLoader();
    console.error(e);
    alert("Erro ao gerar/salvar no Drive. Veja o console (F12).");
  }
}
/*******************************
 * BUSCA no Drive (autocomplete 5 sugestões)
 *******************************/
let searchDebounce = null;

async function buscarOrcamentos() {
  const input = document.getElementById("search-input");
  const resultsDiv = document.getElementById("search-results");
  if (!input || !resultsDiv) return;

  const text = input.value;

  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    resultsDiv.innerHTML = "";

    if (!text.trim()) return;

    const ok = await ensureSignedIn();
    if (!ok) {
      resultsDiv.innerHTML = "<div>Login no Google não autorizado.</div>";
      return;
    }

    await ensureFolders();

    const suggestions = await driveListJsonSuggestions(text);

    if (!suggestions.length) {
      resultsDiv.innerHTML = "<div>Nenhum resultado.</div>";
      return;
    }

    suggestions.forEach(s => {
      const div = document.createElement("div");
      div.textContent = s.display;
      div.addEventListener("click", () => carregarOrcamentoDoDrive(s));
      resultsDiv.appendChild(div);
    });

  }, 200); // debounce 200ms
}

async function carregarOrcamentoDoDrive(sugestao) {
  mostrarLoader("Carregando orçamento...", "Baixando dados do Google Drive");

  try {
    const txt = await driveDownloadFileText(sugestao.id);
    const json = JSON.parse(txt);

    // restaura orçamento
    orcamento = {
      cliente: json.cliente || {},
      materiais: json.materiais || [],
      maoDeObra: json.maoDeObra || {},
      observacoes: json.observacoes || "",
      dataCriacaoISO: json.dataCriacaoISO || null
    };

    // marca contexto
    driveContext = {
      loadedFromDrive: true,
      jsonFileId: sugestao.id,
      jsonFileName: sugestao.name
    };

    salvarLocalStorage();

    // fecha modal se existir
    const modal = document.getElementById("search-modal");
    if (modal) modal.style.display = "none";

    ocultarLoader();
    window.location.href = "cliente.html";
  } catch (e) {
    ocultarLoader();
    console.error(e);
    alert("Falha ao carregar orçamento do Drive.");
  }
}

/*******************************
 * INICIALIZAÇÃO POR PÁGINA
 *******************************/
document.addEventListener("DOMContentLoaded", () => {
  carregarLocalStorage();
  preencherCampos();
  initMenuMobile();

  // cliente
  const clienteForm = document.getElementById("cliente-form");
  if (clienteForm) {
    clienteForm.addEventListener("submit", (e) => {
      e.preventDefault();
      orcamento.cliente = {
        nome: document.getElementById("cliente-nome")?.value?.trim() || "",
        endereco: document.getElementById("cliente-endereco")?.value || "",
        bairro: document.getElementById("cliente-bairro")?.value || "",
        cidade: document.getElementById("cliente-cidade")?.value || "",
        telefone: document.getElementById("cliente-telefone")?.value || "",
        email: document.getElementById("cliente-email")?.value || "",
        cnpj: document.getElementById("cliente-cnpj")?.value || ""
      };
      if (!orcamento.dataCriacaoISO) orcamento.dataCriacaoISO = new Date().toISOString();
      salvarLocalStorage();
      window.location.href = "materiais.html";
    });
  }

  // materiais
  const materiaisList = document.getElementById("materiais-list");
  if (materiaisList) {
    atualizarMateriais();
    const btnAdd = document.getElementById("add-material");
    if (btnAdd) btnAdd.addEventListener("click", adicionarMaterial);
  }

  // mao de obra
  const maoForm = document.getElementById("mao-obra-form");
  if (maoForm) {
    maoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      orcamento.maoDeObra = {
        descricao: document.getElementById("mao-obra-descricao")?.value || "",
        valor: Number(document.getElementById("mao-obra-valor")?.value || 0)
      };
      salvarLocalStorage();
      window.location.href = "observacoes.html";
    });
  }

  // observacoes
  const obs = document.getElementById("observacoes-text");
  if (obs) {
    obs.addEventListener("input", () => {
      orcamento.observacoes = obs.value;
      salvarLocalStorage();
    });
  }

  // resumo
  const resumo = document.getElementById("resumo-content");
  if (resumo) {
    atualizarResumo();
    const btnPdf = document.getElementById("btn-gerar-pdf");
    if (btnPdf) btnPdf.addEventListener("click", gerarPDF);
  }

  // modal busca
  const btnCarregar = document.getElementById("btn-carregar");
  if (btnCarregar) {
    btnCarregar.addEventListener("click", () => {
      const modal = document.getElementById("search-modal");
      if (modal) modal.style.display = "block";
    });
  }
  const closeBtn = document.querySelector(".close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      const modal = document.getElementById("search-modal");
      if (modal) modal.style.display = "none";
    });
  }

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", buscarOrcamentos);
  }
});
function toUpperSafe(v) {
  return (v ?? "").toString().toUpperCase();
}
