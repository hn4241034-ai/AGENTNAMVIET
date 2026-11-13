// app.js - Main UI Controller, Upload/Google Sheets Loader, Validation Editor, Manager Actions & Self-Tests

(() => {
  const validator = window.NamVietValidator;
  const skills = window.NamVietSkills;
  const agent = window.NamVietAgent;

  const state = {
    config: null,
    parsedDataset: null, // { headers, rows, missingHeaders, sourceLabel }
    validationResult: null,
    showErrorDetails: false,
    showWarnings: false,
    cleaningState: null, // { passes, mode, result }
    lastFeedback: "",
    feedbackHistory: [],
    agentOutput: null,
    finalized: false
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csvCell(val) {
    const s = String(val ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadBlob(filename, content, mime = "text/plain;charset=utf-8") {
    const bom = mime.includes("csv") ? "\uFEFF" : "";
    const blob = new Blob([bom + content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function updateWorkflowSteps(activeStep, options = {}) {
    const { validationState = null, cleanState = null, verifyState = null, finalized = false } = options;
    $$(".wf-step").forEach(el => {
      const n = Number(el.dataset.wf);
      el.classList.remove("active", "done", "error");
      if (n < activeStep) el.classList.add("done");
      else if (n === activeStep) el.classList.add("active");
    });
    if (validationState === "error") {
      $("#wfStepValidation").classList.remove("active", "done");
      $("#wfStepValidation").classList.add("error");
    } else if (validationState === "ok") {
      $("#wfStepValidation").classList.remove("error");
      $("#wfStepValidation").classList.add("done");
    }
    if (cleanState === "ok") {
      $("#wfStepClean").classList.remove("error");
      $("#wfStepClean").classList.add("done");
    } else if (cleanState === "warn") {
      $("#wfStepClean").classList.remove("done");
      $("#wfStepClean").classList.add("active");
    }
    if (verifyState === "error") {
      $("#wfStepVerify").classList.remove("active", "done");
      $("#wfStepVerify").classList.add("error");
    } else if (verifyState === "ok") {
      $("#wfStepVerify").classList.remove("error");
      $("#wfStepVerify").classList.add("done");
    }
    if (finalized) {
      $("#wfStepReport").classList.remove("active", "error");
      $("#wfStepReport").classList.add("done");
    }
  }

  // ---- Init & Server Health ----
  async function init() {
    bindEvents();
    const h = window.location.hash;
    if (h === "#quy-trinh") showPage("workflow", false);
    else if (h === "#nhap-du-lieu") showPage("workspace", false);
    else showPage("landing", false);
    await checkServerHealth();
    await loadBrainsStatus();
    await loadConfig();
  }

  async function loadBrainsStatus() {
    const badge = $("#brainBadge");
    const box = $("#brainsListBox");
    try {
      const res = await fetch("/api/brains");
      if (!res.ok) throw new Error("not ok");
      const data = await res.json();
      const activeCount = (data.brains || []).filter(b => b.active).length;
      if (data.enabled && activeCount > 0) {
        badge.textContent = `${activeCount} Bộ não Gemini (${data.primary_model})`;
        badge.className = "badge badge-ok";
        $("#llmEnabled").checked = true;
      } else {
        badge.textContent = "Chế độ Local Agent";
        badge.className = "badge badge-neutral";
      }
      $("#llmModel").value = data.primary_model || "gemini-3.5-flash-lite";
      $("#llmEndpoint").value = data.endpoint || "";
      box.innerHTML = (data.brains || []).map(b =>
        `<span class="pill ${b.active ? "pill-green" : "pill-gray"}">${escapeHtml(b.label)}: <code>${escapeHtml(b.masked_key)}</code></span>`
      ).join(" ");
    } catch {
      badge.textContent = "Bộ não Local";
      badge.className = "badge badge-warn";
    }
  }

  async function testServerBrains() {
    const out = $("#brainTestResult");
    out.textContent = "Đang kiểm tra kết nối trực tiếp tới 2 Bộ não API Gemini...";
    try {
      const res = await fetch("/api/brains/test", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error("Lỗi kiểm tra");
      out.innerHTML = (data.results || []).map(r =>
        r.ok
          ? `<div><span class="pill pill-green">OK</span> <strong>${escapeHtml(r.label)}</strong> (<code>${escapeHtml(r.masked_key)}</code>) → Model <code>${escapeHtml(r.model)}</code> (${r.latency_ms}ms): "${escapeHtml(r.reply)}"</div>`
          : `<div><span class="pill pill-red">LỖI</span> <strong>${escapeHtml(r.label)}</strong> (<code>${escapeHtml(r.masked_key)}</code>): ${escapeHtml(r.error)}</div>`
      ).join("");
    } catch (err) {
      out.textContent = "Không kiểm tra được: " + err.message;
    }
  }

  async function checkServerHealth() {
    const badge = $("#serverBadge");
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        badge.textContent = "Server Sẵn sàng (XLSX / GSheet / Disk Logs)";
        badge.className = "badge badge-ok";
      } else {
        throw new Error("bad status");
      }
    } catch {
      badge.textContent = "Chế độ Tĩnh (Chỉ CSV nội bộ)";
      badge.className = "badge badge-warn";
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        state.config = await res.json();
        $("#configEditor").value = JSON.stringify(state.config, null, 2);
        return;
      }
    } catch {}
    // Fallback minimal config if opened offline
    state.config = { schema: { required_columns: ["lead_id", "company_name", "contact_name", "phone", "email", "industry", "region", "product_interest", "need_description", "budget_vnd", "source_channel", "registered_at"], column_aliases: {} }, sales_staff: [], products: [], contact_history: [] };
  }

  function showPage(pageName, updateHash = true) {
    const pages = {
      landing: { view: "#landingView", nav: "#navLandingBtn", hash: "#gioi-thieu" },
      workflow: { view: "#workflowView", nav: "#navWorkflowBtn", hash: "#quy-trinh" },
      workspace: { view: "#workspaceView", nav: "#navWorkspaceBtn", hash: "#nhap-du-lieu" }
    };
    const target = pages[pageName] || pages.landing;

    Object.values(pages).forEach(p => {
      $(p.view)?.classList.add("hidden");
      $(p.nav)?.classList.remove("active");
    });

    $(target.view)?.classList.remove("hidden");
    $(target.nav)?.classList.add("active");
    if (updateHash && window.location.hash !== target.hash) {
      history.pushState({ page: pageName }, "", target.hash);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showLandingView() { showPage("landing"); }
  function showWorkflowView() { showPage("workflow"); }
  function showWorkspaceView() { showPage("workspace"); }

  function bindEvents() {
    $("#brandHomeBtn").addEventListener("click", showLandingView);
    $("#navLandingBtn").addEventListener("click", showLandingView);
    $("#navWorkflowBtn").addEventListener("click", showWorkflowView);
    $("#navWorkspaceBtn").addEventListener("click", showWorkspaceView);
    $("#btnCardGoWorkflow")?.addEventListener("click", showWorkflowView);
    $("#btnWorkflowBackLanding")?.addEventListener("click", showLandingView);
    $("#btnBackWorkflow")?.addEventListener("click", showWorkflowView);
    $("#btnHeroStart").addEventListener("click", showWorkspaceView);
    $("#btnBottomStart").addEventListener("click", showWorkspaceView);
    $("#tiltedEnterWorkspace")?.addEventListener("click", showWorkspaceView);
    $("#heroLivePreviewCard")?.addEventListener("click", showWorkspaceView);
    $("#btnBackLanding").addEventListener("click", showLandingView);

    // Clickable cards with data-nav-target
    $$("[data-nav-target]").forEach(el => {
      el.addEventListener("click", () => showPage(el.dataset.navTarget));
    });

    // Clickable workflow list items arrow -> jump to workspace
    $$(".wf-list-item .wf-item-arrow").forEach(arrow => {
      arrow.addEventListener("click", (e) => {
        e.stopPropagation();
        showWorkspaceView();
      });
    });

    // Browser back/forward hash navigation
    window.addEventListener("popstate", () => {
      const h = window.location.hash;
      if (h === "#quy-trinh") showPage("workflow", false);
      else if (h === "#nhap-du-lieu") showPage("workspace", false);
      else showPage("landing", false);
    });

    $("#btnToggleLLM").addEventListener("click", () => $("#llmPanel").classList.toggle("hidden"));
    $("#btnCloseLLM").addEventListener("click", () => $("#llmPanel").classList.add("hidden"));
    $("#btnTestBrains").addEventListener("click", testServerBrains);

    $("#btnLoadValidSample").addEventListener("click", () => loadSampleUrl("/data/sample_normal_and_edge_cases.csv", "Mẫu chuẩn (16 leads + Edge Cases)"));
    $("#btnLoadInvalidSample").addEventListener("click", () => loadSampleUrl("/data/sample_invalid_format.csv", "Mẫu sai định dạng (Test ràng buộc)"));
    $("#btnDownloadTemplate").addEventListener("click", () => {
      const cols = (state.config?.schema?.required_columns || []).join(",");
      const sampleRow = "L001,Công ty TNHH Minh Tâm,0101234567,Nguyễn Văn A,0912345678,a@minhtam.vn,Sản xuất,Hà Nội,NV-ERP,Cần phần mềm quản trị sản xuất và kho,100000000,Website,2026-11-10";
      const headerWithTax = "lead_id,company_name,tax_code,contact_name,phone,email,industry,region,product_interest,need_description,budget_vnd,source_channel,registered_at";
      downloadBlob("namviet_leads_template.csv", headerWithTax + "\n" + sampleRow + "\n", "text/csv;charset=utf-8");
    });
    $("#btnGen700").addEventListener("click", generateAndLoad700Leads);

    // File upload & drag/drop
    $("#btnChooseFile").addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", (e) => {
      if (e.target.files[0]) handleUploadedFile(e.target.files[0]);
      e.target.value = "";
    });
    const dz = $("#dropZone");
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      if (e.dataTransfer.files[0]) handleUploadedFile(e.dataTransfer.files[0]);
    });

    // Google Sheets
    $("#btnFetchGSheet").addEventListener("click", handleFetchGSheet);

    // Validation, Cleaning, Process & Verify, Finalize
    $("#btnToggleInputPanel").addEventListener("click", () => {
      const body = $("#inputPanelBody");
      const hidden = body.classList.toggle("hidden");
      $("#btnToggleInputPanel").textContent = hidden ? "Đổi file / Mở lại" : "Thu gọn";
    });
    $("#btnToggleErrorDetails").addEventListener("click", () => {
      state.showErrorDetails = !state.showErrorDetails;
      syncErrorDetailsUI();
    });
    $("#btnToggleWarnings").addEventListener("click", () => {
      state.showWarnings = !state.showWarnings;
      $("#warningList").classList.toggle("hidden", !state.showWarnings);
      $("#btnToggleWarnings").textContent = state.showWarnings ? "Ẩn chi tiết thiếu" : "Xem chi tiết thiếu";
    });
    $("#btnRevalidate").addEventListener("click", () => {
      $("#validationBody").classList.remove("hidden");
      $("#validationSummaryLine").classList.add("hidden");
      runValidationGate();
    });
    $("#btnAutoFixCommon").addEventListener("click", autoFixCommonErrors);
    $("#btnGoToClean").addEventListener("click", () => enterCleaningStep("standard"));
    $("#btnSkipMissingAndNext").addEventListener("click", () => enterCleaningStep("standard", true, true));
    $("#btnCleanRetry").addEventListener("click", () => enterCleaningStep("standard"));
    $("#btnCleanDeep").addEventListener("click", () => enterCleaningStep("deep"));
    $("#btnProceedProcess").addEventListener("click", () => handleRunAgentPipeline(""));
    $("#btnRunAgent").addEventListener("click", () => handleRunAgentPipeline(state.lastFeedback));
    $("#btnSendFeedback").addEventListener("click", () => {
      const fb = ($("#verifyFeedbackInput").value || "").trim();
      if (!fb) {
        alert("Vui lòng nhập nội dung Feedback hoặc chọn một gợi ý nhanh bên trên.");
        return;
      }
      handleRunAgentPipeline(fb);
    });
    $$(".fb-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        $("#verifyFeedbackInput").value = chip.dataset.fb || chip.textContent;
      });
    });
    $("#btnOpenDashboard").addEventListener("click", openDashboardStep);
    $("#btnFinalizeAndExportHTML").addEventListener("click", finalizeAndExportHTML);
    $("#btnRedownloadHTML").addEventListener("click", exportFinalHTMLReport);
    $("#btnUnfinalize").addEventListener("click", unfinalizeDashboard);

    // Tabs
    $$(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        $$(".tab-btn").forEach(b => b.classList.remove("active"));
        $$(".tab-content").forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        $("#" + btn.dataset.tab).classList.add("active");
      });
    });

    // Filters
    $("#filterSearch").addEventListener("input", renderCustomersTable);
    $("#filterPriority").addEventListener("change", renderCustomersTable);
    $("#filterStatus").addEventListener("change", renderCustomersTable);

    // Exports
    $("#btnExportCustomersCSV").addEventListener("click", exportCustomersCSV);
    $("#btnExportTasksCSV").addEventListener("click", exportTasksCSV);
    $("#btnExportAuditJSONL").addEventListener("click", exportAuditJSONL);

    // Logs & Self-tests & Config
    $("#btnRefreshLogs").addEventListener("click", refreshDiskLogs);
    $("#btnRunSelfTests").addEventListener("click", runSelfTestSuite);
    $("#btnSaveConfig").addEventListener("click", saveConfigFromEditor);
    $("#btnResetConfig").addEventListener("click", loadConfig);

    // Modal
    $("#btnCloseModal").addEventListener("click", () => $("#draftModal").classList.add("hidden"));
    $(".modal-backdrop").addEventListener("click", () => $("#draftModal").classList.add("hidden"));
    $("#btnCopyDraft").addEventListener("click", () => {
      navigator.clipboard?.writeText($("#modalDraftText").value);
      $("#btnCopyDraft").textContent = "Đã sao chép!";
      setTimeout(() => ($("#btnCopyDraft").textContent = "Sao chép Nội dung"), 1500);
    });
  }

  // ---- Upload Progress Helper ----
  function setUploadProgress(pct, label = "") {
    const box = $("#uploadProgressBox");
    const bar = $("#uploadProgressBar");
    const pctEl = $("#uploadProgressPct");
    const lblEl = $("#uploadProgressLabel");
    if (!box) return;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    box.classList.remove("hidden");
    bar.style.width = clamped + "%";
    pctEl.textContent = clamped + "%";
    if (label) lblEl.textContent = label;
  }

  function readFileWithProgress(file, readAs = "text", onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          onProgress((ev.loaded / ev.total) * 100);
        }
      };
      reader.onload = () => {
        onProgress(100);
        resolve(reader.result);
      };
      reader.onerror = () => reject(reader.error || new Error("Không đọc được file"));
      if (readAs === "arrayBuffer") reader.readAsArrayBuffer(file);
      else reader.readAsText(file, "UTF-8");
    });
  }

  function postJSONWithUploadProgress(url, payloadObj, onUploadProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          onUploadProgress((ev.loaded / ev.total) * 100);
        }
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Lỗi kết nối server"));
      xhr.send(JSON.stringify(payloadObj));
    });
  }

  // ---- Input Loaders ----
  async function loadSampleUrl(url, label) {
    try {
      setUploadProgress(20, `Đang tải ${label}...`);
      const res = await fetch(url);
      setUploadProgress(65, `Đang phân tích ${label}...`);
      const csvText = await res.text();
      setUploadProgress(100, `Hoàn tất tải ${label}`);
      ingestMatrix(validator.parseCSV(csvText), label);
    } catch (err) {
      setUploadProgress(0, `Lỗi tải mẫu: ${err.message}`);
      alert("Không nạp được file mẫu: " + err.message);
    }
  }

  async function handleUploadedFile(file) {
    $("#fileInfoText").textContent = `Đang đọc: ${file.name} (${Math.round(file.size / 1024)} KB)...`;
    const lower = file.name.toLowerCase();

    if (lower.endsWith(".csv")) {
      setUploadProgress(5, `Đang đọc file ${file.name}...`);
      const text = await readFileWithProgress(file, "text", (p) => {
        setUploadProgress(Math.round(p * 0.8), `Đang đọc file ${file.name}...`);
      });
      setUploadProgress(92, `Đang phân tích dữ liệu CSV...`);
      const matrix = validator.parseCSV(text);
      setUploadProgress(100, `Hoàn tất tải ${file.name} (${matrix.length - 1} dòng)`);
      ingestMatrix(matrix, `CSV: ${file.name}`);
      $("#fileInfoText").textContent = `Đã nạp: ${file.name} (${matrix.length - 1} dòng) · 100%`;
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      try {
        setUploadProgress(5, `Đang đọc file ${file.name}...`);
        const buf = await readFileWithProgress(file, "arrayBuffer", (p) => {
          setUploadProgress(Math.round(p * 0.4), `Đang đọc file ${file.name}...`);
        });
        const base64 = arrayBufferToBase64(buf);
        setUploadProgress(45, `Đang tải lên & giải mã Excel ${file.name}...`);
        const data = await postJSONWithUploadProgress(
          "/api/parse-xlsx",
          { filename: file.name, base64 },
          (upPct) => setUploadProgress(45 + Math.round(upPct * 0.45), `Đang tải lên ${file.name}...`)
        );
        if (!data.ok) throw new Error(data.error || "Không đọc được file XLSX");
        setUploadProgress(100, `Hoàn tất tải ${file.name} (${Object.keys(data.sheets).length} sheet)`);
        ingestWorkbookSheets(data.sheets, `XLSX: ${file.name}`);
        $("#fileInfoText").textContent = `Đã nạp: ${file.name} (${Object.keys(data.sheets).length} sheet) · 100%`;
      } catch (err) {
        setUploadProgress(0, `Lỗi đọc ${file.name}: ${err.message}`);
        alert("Lỗi đọc XLSX: " + err.message);
        $("#fileInfoText").textContent = "Lỗi đọc file XLSX";
      }
    } else {
      alert("Định dạng không hỗ trợ. Vui lòng chọn file .csv hoặc .xlsx.");
    }
  }

  async function handleFetchGSheet() {
    const url = $("#gsheetUrl").value.trim();
    const statusEl = $("#gsheetStatus");
    if (!url) {
      statusEl.textContent = "Vui lòng nhập đường link Google Sheets.";
      return;
    }
    statusEl.textContent = "Đang tải dữ liệu từ Google Sheets...";
    setUploadProgress(15, "Đang kết nối Google Sheets...");
    let simTimer = setInterval(() => {
      const cur = parseInt($("#uploadProgressPct")?.textContent || "15", 10);
      if (cur < 85) setUploadProgress(cur + 10, "Đang tải dữ liệu Google Sheets...");
    }, 250);
    try {
      const res = await fetch("/api/fetch-gsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      clearInterval(simTimer);
      if (!data.ok) throw new Error(data.error || "Lỗi tải Google Sheet");
      setUploadProgress(100, "Hoàn tất tải Google Sheets");
      if (data.mode === "xlsx_export" && data.sheets) {
        ingestWorkbookSheets(data.sheets, `Google Sheets (${data.sheetId})`);
        statusEl.textContent = `Đã tải thành công Google Sheets (${Object.keys(data.sheets).length} tab) · 100%.`;
      } else if (data.csv) {
        ingestMatrix(validator.parseCSV(data.csv), `Google Sheets (${data.sheetId})`);
        statusEl.textContent = "Đã tải thành công tab Google Sheets (CSV) · 100%.";
      }
    } catch (err) {
      clearInterval(simTimer);
      setUploadProgress(0, "Lỗi tải Google Sheets");
      statusEl.textContent = "Lỗi: " + err.message;
    }
  }

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function ingestWorkbookSheets(sheetsObj, sourceLabel) {
    const sheetNames = Object.keys(sheetsObj || {});
    if (sheetNames.length === 0) {
      alert("Workbook không có sheet dữ liệu nào.");
      return;
    }
    // Find leads sheet or default to first sheet
    const leadsSheetName = sheetNames.find(n => /lead|khach|ho_so|dang_ky/i.test(n)) || sheetNames[0];
    // Optional reference sheets if provided inside the same workbook
    const histName = sheetNames.find(n => /history|lich_su/i.test(n));
    const staffName = sheetNames.find(n => /staff|nhan_vien|nvkd/i.test(n));
    if (histName && sheetsObj[histName]?.length > 1) {
      const parsedHist = validator.matrixToObjects(sheetsObj[histName], { required_columns: [], column_aliases: state.config.schema.column_aliases });
      state.config.contact_history = parsedHist.rows;
    }
    if (staffName && sheetsObj[staffName]?.length > 1) {
      const parsedStaff = validator.matrixToObjects(sheetsObj[staffName], { required_columns: [], column_aliases: state.config.schema.column_aliases });
      if (parsedStaff.rows.length > 0 && parsedStaff.rows[0].staff_id) {
        state.config.sales_staff = parsedStaff.rows.map(r => ({
          ...r,
          assigned_industries: String(r.assigned_industries || "").split(/[;,]/).map(s => s.trim()).filter(Boolean),
          assigned_regions: String(r.assigned_regions || "").split(/[;,]/).map(s => s.trim()).filter(Boolean),
          product_groups: String(r.product_groups || "").split(/[;,]/).map(s => s.trim()).filter(Boolean),
          current_load: Number(r.current_load || 0),
          max_weekly_capacity: Number(r.max_weekly_capacity || 20)
        }));
      }
    }
    ingestMatrix(sheetsObj[leadsSheetName], `${sourceLabel} [Sheet: ${leadsSheetName}]`);
  }

  function ingestMatrix(matrix, sourceLabel) {
    const parsed = validator.matrixToObjects(matrix, state.config.schema || {});
    parsed.sourceLabel = sourceLabel;
    state.parsedDataset = parsed;
    state.showErrorDetails = false;
    state.showWarnings = false;
    state.cleaningState = null;
    state.lastFeedback = "";
    state.feedbackHistory = [];
    state.agentOutput = null;
    state.finalized = false;

    // Collapse Step 1 upload panel to keep focus on active step
    $("#inputPanelBody").classList.add("hidden");
    $("#btnToggleInputPanel").classList.remove("hidden");
    $("#btnToggleInputPanel").textContent = "Đổi file / Mở lại";
    $("#inputSummaryLine").classList.remove("hidden");
    $("#inputSummaryLine").textContent = `Đã nạp: ${sourceLabel} (${parsed.rows.length} dòng)`;

    $("#validationSection").classList.remove("hidden");
    $("#validationBody").classList.remove("hidden");
    $("#validationSummaryLine").classList.add("hidden");
    $("#repairLogBox").classList.add("hidden");
    $("#cleaningSection").classList.add("hidden");
    $("#processVerifySection").classList.add("hidden");
    $("#resultsSection").classList.add("hidden");
    $("#finalizedBanner").classList.add("hidden");
    $("#feedbackHistoryText").textContent = "";
    $("#verifyFeedbackInput").value = "";
    runValidationGate();
  }

  function syncErrorDetailsUI() {
    const errCount = state.validationResult?.errors?.length || 0;
    const btn = $("#btnToggleErrorDetails");
    const errBox = $("#validationErrorBox");
    const previewDetails = $("#previewDetails");
    if (errCount > 0) {
      btn.classList.remove("hidden");
      btn.textContent = state.showErrorDetails ? `Ẩn lỗi (${errCount})` : `Xem lỗi (${errCount})`;
      errBox.classList.toggle("hidden", !state.showErrorDetails);
      previewDetails.open = state.showErrorDetails;
    } else {
      btn.classList.add("hidden");
      errBox.classList.add("hidden");
    }
  }

  // ---- STEP 2: Strict Validation Gate (Đầu vào hợp lệ?) ----
  function runValidationGate() {
    if (!state.parsedDataset) return;
    const res = validator.validateDataset(state.parsedDataset, state.config.schema || {});
    state.validationResult = res;

    const banner = $("#validationBanner");
    const warnBox = $("#validationWarningBox");
    const btnGoClean = $("#btnGoToClean");
    const btnFix = $("#btnAutoFixCommon");
    const previewDetails = $("#previewDetails");

    $("#previewCount").textContent = res.totalRows;

    if (res.valid) {
      btnGoClean.classList.remove("hidden");
      btnFix.classList.add("hidden");

      if (res.warnings.length > 0) {
        banner.className = "alert alert-success";
        banner.innerHTML = `<strong>Định dạng hợp lệ ✓</strong> (${res.totalRows} dòng) — Có <strong>${res.warnings.length}</strong> mục thiếu thông tin.`;
        previewDetails.open = false;
        updateWorkflowSteps(2, { validationState: "ok" });
      } else {
        banner.className = "alert alert-success";
        banner.innerHTML = `<strong>Đầu vào hợp lệ ✓</strong> (${res.totalRows} dòng). Chuyển sang <strong>Làm sạch Dữ liệu</strong>.`;
        previewDetails.open = false;
        enterCleaningStep("standard", false);
      }
    } else {
      banner.className = "alert alert-danger";
      banner.innerHTML = `<strong>Sai định dạng (${res.errors.length} lỗi)!</strong> Bấm <strong>Tự động Sửa lỗi</strong> hoặc bật <strong>Xem lỗi (${res.errors.length})</strong> để kiểm tra và sửa.`;
      btnGoClean.classList.add("hidden");
      btnFix.classList.remove("hidden");
      $("#cleaningSection").classList.add("hidden");
      $("#processVerifySection").classList.add("hidden");
      $("#resultsSection").classList.add("hidden");
      updateWorkflowSteps(2, { validationState: "error" });

      const tbody = $("#errorTable tbody");
      tbody.innerHTML = res.errors.map(e => `
        <tr>
          <td><strong>${e.row}</strong></td>
          <td><code>${escapeHtml(e.lead_id)}</code></td>
          <td><code>${escapeHtml(e.column)}</code></td>
          <td><span class="pill pill-red">${escapeHtml(e.value || "(Trống)")}</span></td>
          <td>${escapeHtml(e.reason)}</td>
          <td>${escapeHtml(e.suggestion)}</td>
        </tr>
      `).join("");
    }

    syncErrorDetailsUI();

    if (res.warnings.length > 0) {
      warnBox.classList.remove("hidden");
      $("#warningList").classList.toggle("hidden", !state.showWarnings);
      $("#btnToggleWarnings").textContent = state.showWarnings ? "Ẩn chi tiết thiếu" : `Xem chi tiết thiếu (${res.warnings.length})`;
      $("#warningList").innerHTML = res.warnings.slice(0, 8).map(w =>
        `<li>Dòng ${w.row} (<code>${escapeHtml(w.lead_id)}</code>) – <strong>${escapeHtml(w.column)}</strong>: ${escapeHtml(w.reason)}</li>`
      ).join("") + (res.warnings.length > 8 ? `<li>... và ${res.warnings.length - 8} mục thiếu khác.</li>` : "");
    } else {
      warnBox.classList.add("hidden");
    }

    renderEditablePreviewTable(res.errors);
  }

  function renderEditablePreviewTable(errors) {
    const rows = state.parsedDataset.rows || [];
    const cols = ["lead_id", "company_name", "tax_code", "contact_name", "phone", "email", "industry", "region", "product_interest", "need_description", "budget_vnd", "source_channel", "registered_at"];

    const errLookup = new Set(errors.map(e => `${e.row}::${e.column}`));

    const thead = $("#previewTable thead");
    thead.innerHTML = `<tr><th>#</th>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;

    const displayLimit = 100; // keep UI responsive even on 700-lead stress test
    const slice = rows.slice(0, displayLimit);
    const tbody = $("#previewTable tbody");
    tbody.innerHTML = slice.map((r, i) => {
      const rowNum = r.__rowNumber || (i + 2);
      return `<tr>
        <td>${rowNum}</td>
        ${cols.map(c => {
          const hasErr = errLookup.has(`${rowNum}::${c}`);
          return `<td contenteditable="true" data-row-idx="${i}" data-col="${c}" class="${hasErr ? "cell-error" : ""}">${escapeHtml(r[c] ?? "")}</td>`;
        }).join("")}
      </tr>`;
    }).join("") + (rows.length > displayLimit ? `<tr><td colspan="${cols.length + 1}" class="hint">Đang hiển thị ${displayLimit}/${rows.length} dòng đầu tiên để xem trước mượt mà. Toàn bộ ${rows.length} dòng đều được kiểm tra và xử lý.</td></tr>` : "");

    // Sync inline edits back to state.parsedDataset.rows
    tbody.querySelectorAll('td[contenteditable="true"]').forEach(td => {
      td.addEventListener("input", () => {
        const rIdx = Number(td.dataset.rowIdx);
        const col = td.dataset.col;
        state.parsedDataset.rows[rIdx][col] = td.textContent.trim();
        td.classList.remove("cell-error");
      });
    });
  }

  function autoFixCommonErrors() {
    if (!state.parsedDataset) return;
    const repairRes = validator.repairDatasetErrors(state.parsedDataset, state.config.schema || {});
    const logBox = $("#repairLogBox");
    const logList = $("#repairLogList");
    if (repairRes.repairedCount > 0) {
      logBox.classList.remove("hidden");
      logList.innerHTML = repairRes.repairLog.slice(0, 12).map(msg => `<li>${escapeHtml(msg)}</li>`).join("") +
        (repairRes.repairLog.length > 12 ? `<li>... và ${repairRes.repairLog.length - 12} mục sửa khác.</li>` : "");
    } else {
      logBox.classList.add("hidden");
    }
    runValidationGate();
  }

  // ---- STEP 3: Data Cleaning Gate (Dữ liệu đã sạch và ổn?) ----
  function enterCleaningStep(mode = "standard", shouldScroll = true, skippedMissing = false) {
    if (!state.parsedDataset || !state.validationResult?.valid) return;
    const prevPasses = state.cleaningState?.passes || 0;
    const cleanRes = skills.toolCleanDataset(state.parsedDataset.rows, state.config, mode);
    state.parsedDataset.rows = cleanRes.cleanedRows;
    state.cleaningState = {
      passes: prevPasses + 1,
      mode,
      skippedMissing,
      result: cleanRes
    };
    renderEditablePreviewTable([]);

    // Collapse Step 2 body when moving to Step 3 to keep UI focused on main step
    $("#validationBody").classList.add("hidden");
    $("#validationSummaryLine").classList.remove("hidden");
    $("#validationSummaryLine").textContent = skippedMissing
      ? `Định dạng hợp lệ ✓ (Đã bỏ qua ${state.validationResult.warnings.length} mục thiếu để tiếp tục)`
      : `Đạt chuẩn định dạng ✓ (${state.validationResult.totalRows} dòng)`;

    $("#cleaningSection").classList.remove("hidden");
    const banner = $("#cleaningBanner");
    const btnProceed = $("#btnProceedProcess");

    if (cleanRes.stats.isStable) {
      banner.className = "alert alert-success";
      banner.innerHTML = `<strong>Dữ liệu đã sạch & ổn (Lần ${state.cleaningState.passes}) ✓</strong>` +
        (skippedMissing ? ` <em>(Đã bỏ qua các ô thiếu không cần thiết để tiếp tục)</em>.` : "") +
        ` Có thể làm sạch lại hoặc bấm <strong>Chạy Process</strong>.`;
      btnProceed.disabled = false;
      updateWorkflowSteps(3, { validationState: "ok", cleanState: "ok" });
    } else {
      banner.className = "alert alert-danger";
      banner.innerHTML = `<strong>Dữ liệu chưa ổn!</strong> Vui lòng bấm <strong>Làm sạch lại</strong> hoặc chỉnh sửa trực tiếp.`;
      btnProceed.disabled = true;
      updateWorkflowSteps(3, { validationState: "ok", cleanState: "warn" });
    }

    $("#cleaningStatsGrid").innerHTML = [
      { label: "Tổng hồ sơ", val: cleanRes.stats.totalRows, sub: `Lần làm sạch #${state.cleaningState.passes}` },
      { label: "Ô đã chuẩn hóa", val: cleanRes.stats.normalizedCells, sub: mode === "deep" ? "Chế độ Làm sạch sâu" : "Chế độ Chuẩn" },
      { label: "Thiếu SĐT & Email", val: cleanRes.stats.missingContactCount, sub: "Agent sẽ gắn cờ" },
      { label: "Mô tả nhu cầu ngắn", val: cleanRes.stats.missingNeedCount, sub: "Sinh câu hỏi bổ sung" }
    ].map(k => `
      <div class="kpi-card">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val">${k.val}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join("");

    $("#cleanLogList").innerHTML = cleanRes.cleanLog.map(l => `<li>${escapeHtml(l)}</li>`).join("");
    $("#cleanWarnList").innerHTML = cleanRes.warnings.length > 0
      ? cleanRes.warnings.map(w => `<li>${escapeHtml(w)} (Agent vẫn xử lý & tạo câu hỏi bổ sung).</li>`).join("")
      : `<li>Không có cảnh báo dữ liệu bất thường.</li>`;

    if (shouldScroll) {
      $("#cleaningSection").scrollIntoView({ behavior: "smooth" });
    }
  }

  // ---- STEP 4 & 5: Process -> Verify -> Feedback Loop ----
  async function handleRunAgentPipeline(feedbackText = "") {
    if (!state.parsedDataset || !state.validationResult?.valid) return;

    const cleanFb = String(feedbackText || "").trim();
    if (cleanFb) {
      state.lastFeedback = cleanFb;
      state.feedbackHistory.push(cleanFb);
    }

    $("#processVerifySection").classList.remove("hidden");
    const btnProceed = $("#btnProceedProcess");
    const btnRun = $("#btnRunAgent");
    const btnFb = $("#btnSendFeedback");
    const btnOpenDash = $("#btnOpenDashboard");
    const statusText = $("#processStatusText");

    btnProceed.disabled = true;
    btnRun.disabled = true;
    btnFb.disabled = true;
    btnOpenDash.classList.add("hidden");
    statusText.textContent = cleanFb
      ? `Đang chạy lại Process với Feedback: "${cleanFb}"...`
      : "Agent đang chạy Process (5 Skills + Gemini)...";
    updateWorkflowSteps(4, { validationState: "ok", cleanState: "ok" });

    try {
      const llmOptions = {
        enabled: $("#llmEnabled").checked,
        endpoint: $("#llmEndpoint").value.trim(),
        model: $("#llmModel").value.trim(),
        apiKey: $("#llmApiKey").value.trim()
      };

      const output = await agent.runAgentPipeline({
        parsedDataset: state.parsedDataset,
        config: state.config,
        llmOptions,
        feedback: cleanFb,
        cleaningMeta: state.cleaningState ? {
          passes: state.cleaningState.passes,
          mode: state.cleaningState.mode,
          normalizedCells: state.cleaningState.result?.stats?.normalizedCells || 0
        } : null
      });

      state.agentOutput = output;
      state.finalized = false;
      renderVerifyStep(output.verification);
      if (state.feedbackHistory.length > 0) {
        $("#feedbackHistoryText").textContent = `Đã chạy lại theo Feedback (${state.feedbackHistory.length} lần): ${state.feedbackHistory.join(" | ")}`;
      }
      $("#processVerifySection").scrollIntoView({ behavior: "smooth" });
      refreshDiskLogs();
    } catch (err) {
      statusText.textContent = "Lỗi Process: " + err.message;
      alert("Lỗi thực thi Agent: " + err.message);
    } finally {
      btnProceed.disabled = false;
      btnRun.disabled = false;
      btnFb.disabled = false;
    }
  }

  function renderVerifyStep(verification) {
    const banner = $("#verifyBanner");
    const grid = $("#verifyChecksGrid");
    const btnOpenDash = $("#btnOpenDashboard");
    const statusText = $("#processStatusText");

    banner.classList.remove("hidden");
    if (verification?.passed) {
      banner.className = "alert alert-success";
      banner.innerHTML = `<strong>Verify Đạt yêu cầu ✓</strong> ${escapeHtml(verification.summary)} Bấm <strong>Mở Báo cáo & Dashboard</strong> hoặc gửi Feedback nếu muốn tinh chỉnh thêm.`;
      btnOpenDash.classList.remove("hidden");
      statusText.textContent = `Hoàn tất Process & Verify (Run ID: ${state.agentOutput.run_id}).`;
      updateWorkflowSteps(5, { validationState: "ok", cleanState: "ok", verifyState: "ok" });
    } else {
      banner.className = "alert alert-danger";
      banner.innerHTML = `<strong>Verify Chưa đạt!</strong> ${escapeHtml(verification?.summary || "Kiểm tra lại kết quả")} Hãy nhập Feedback để Process chạy lại.`;
      btnOpenDash.classList.add("hidden");
      statusText.textContent = "Verify chưa đạt — chờ Feedback cho Process.";
      updateWorkflowSteps(5, { validationState: "ok", cleanState: "ok", verifyState: "error" });
    }

    grid.innerHTML = (verification?.checks || []).map(ch => `
      <div class="verify-card ${ch.status === "PASS" ? "pass" : "fail"}">
        <div class="flex-between">
          <strong>${escapeHtml(ch.name)}</strong>
          <span class="pill ${ch.status === "PASS" ? "pill-green" : "pill-red"}">${ch.status}</span>
        </div>
        <div class="hint mt-1">${escapeHtml(ch.detail)}</div>
      </div>
    `).join("");
  }

  function openDashboardStep() {
    if (!state.agentOutput) return;
    renderResultsDashboard();
    $("#resultsSection").classList.remove("hidden");
    updateFinalizeUI();
    updateWorkflowSteps(6, { validationState: "ok", cleanState: "ok", verifyState: "ok", finalized: state.finalized });
    $("#resultsSection").scrollIntoView({ behavior: "smooth" });
  }

  function updateFinalizeUI() {
    const pill = $("#finalizeStatusPill");
    const banner = $("#finalizedBanner");
    const btnUnfin = $("#btnUnfinalize");
    const btnFin = $("#btnFinalizeAndExportHTML");
    if (state.finalized) {
      pill.textContent = "Đã chốt kết quả ✓";
      pill.className = "pill pill-green";
      banner.classList.remove("hidden");
      btnUnfin.classList.remove("hidden");
      btnFin.textContent = "Đã chốt · Xuất lại HTML";
      updateWorkflowSteps(6, { validationState: "ok", cleanState: "ok", verifyState: "ok", finalized: true });
    } else {
      pill.textContent = "Chưa chốt kết quả";
      pill.className = "pill pill-amber";
      banner.classList.add("hidden");
      btnUnfin.classList.add("hidden");
      btnFin.textContent = "Chốt kết quả & Xuất file HTML ✓";
      updateWorkflowSteps(6, { validationState: "ok", cleanState: "ok", verifyState: "ok", finalized: false });
    }
  }

  function finalizeAndExportHTML() {
    if (!state.agentOutput) return;
    state.finalized = true;
    state.agentOutput.trace.push({
      run_id: state.agentOutput.run_id,
      step: state.agentOutput.trace.length + 1,
      timestamp: new Date().toISOString(),
      thought: "Người dùng đã chốt kết quả trên Dashboard và xuất báo cáo HTML hoàn chỉnh.",
      tool_called: "finalize_and_export_html",
      input_summary: { unique_customers: state.agentOutput.report.summary.unique_customers },
      rules_applied: ["human_final_approval"],
      output_summary: { finalized: true, format: "HTML" }
    });
    renderExecutionTrace();
    updateFinalizeUI();
    exportFinalHTMLReport();
  }

  function unfinalizeDashboard() {
    state.finalized = false;
    updateFinalizeUI();
  }

  // ---- Render Output Dashboard ----
  function renderResultsDashboard() {
    const out = state.agentOutput;
    if (!out) return;
    const s = out.report.summary;

    const modeLabel = out.llm_used
      ? `Agent + Gemini (${out.llm_meta?.brain_id || "brain"} / ${out.llm_meta?.model_used || "gemini"})`
      : "Autonomous Local Agent";
    $("#runMetaText").textContent =
      `Run ID: ${out.run_id} | Nguồn: ${state.parsedDataset.sourceLabel} | Chế độ: ${modeLabel}` +
      (out.saved_log_file ? ` | Log đĩa: ${out.saved_log_file}` : "");

    $("#badgeManagerCount").textContent = s.manager_decision_count;

    // 1. KPI Grid
    $("#kpiGrid").innerHTML = [
      { label: "Hồ sơ đầu vào (Gốc)", val: s.total_raw_records, sub: `Gộp ${s.duplicates_merged} bản ghi trùng` },
      { label: "Khách hàng Duy nhất", val: s.unique_customers, sub: "Không đếm lặp trùng tên/viết tắt" },
      { label: "Ưu tiên Cao", val: s.by_priority["Cao"], sub: "Khớp SP + Nhu cầu rõ", cls: "pill-green" },
      { label: "Ưu tiên Trung bình", val: s.by_priority["Trung bình"], sub: "Cần chăm sóc / bổ sung", cls: "pill-blue" },
      { label: "Cần Trưởng phòng Quyết định", val: s.manager_decision_count, sub: "Trùng mơ hồ / VIP / Tranh chấp / Quá tải", cls: "pill-amber" },
      { label: "Chưa có NVKD phù hợp", val: s.unassigned_count, sub: "Ngoài vùng/ngành phụ trách", cls: "pill-red" },
      { label: "Không liên hệ lại (Lịch sử)", val: s.do_not_contact_count, sub: "Chặn gọi trùng / Opt-out", cls: "pill-gray" }
    ].map(k => `
      <div class="kpi-card">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val">${k.val}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join("");

    // 2. Executive Brief & Visual Charts
    $("#executiveBriefBox").textContent = out.executive_brief;
    const totalCust = Math.max(1, s.unique_customers);

    // 2a. SVG Donut Chart for Priority
    const priorityDefs = [
      { label: "Ưu tiên Cao", count: s.by_priority["Cao"], color: "#34d399" },
      { label: "Trung bình", count: s.by_priority["Trung bình"], color: "#60a5fa" },
      { label: "Ưu tiên Thấp", count: s.by_priority["Thấp"], color: "#71717a" },
      { label: "Không liên hệ lại", count: s.by_priority["Không liên hệ lại"], color: "#f87171" }
    ];
    $("#priorityDonutChart").innerHTML = buildDonutChartHTML(priorityDefs, s.unique_customers, "Khách duy nhất");

    // 2b. Product Group Distribution Bars
    const prodCounts = { "NV-ERP": 0, "NV-CRM": 0, "NV-HRM": 0, "NV-POS": 0, "Khác / Chưa rõ": 0 };
    for (const c of out.customers) {
      const p = c.matched_products?.[0] || c.product_interest || "";
      if (prodCounts[p] !== undefined && !c.is_wrong_product) prodCounts[p]++;
      else prodCounts["Khác / Chưa rõ"]++;
    }
    const prodColors = { "NV-ERP": "#f2ea00", "NV-CRM": "#34d399", "NV-HRM": "#60a5fa", "NV-POS": "#c084fc", "Khác / Chưa rõ": "#71717a" };
    $("#productBarsChart").innerHTML = Object.entries(prodCounts).map(([lbl, cnt]) => {
      const pct = Math.round((cnt / totalCust) * 100);
      return `
        <div class="bar-row">
          <span>${escapeHtml(lbl)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${prodColors[lbl]};"></div></div>
          <strong>${cnt} (${pct}%)</strong>
        </div>
      `;
    }).join("");

    // 2c. Routing Status Distribution Bars
    const assignedCount = out.customers.filter(c => c.assignment_status === "assigned").length;
    const statusDefs = [
      { label: "Đã giao NVKD", count: assignedCount, color: "#34d399" },
      { label: "Chờ Trưởng phòng", count: s.manager_decision_count, color: "#f2ea00" },
      { label: "Chưa có NVKD", count: s.unassigned_count, color: "#f87171" },
      { label: "Ngừng liên hệ", count: s.do_not_contact_count, color: "#71717a" }
    ];
    $("#statusBarsChart").innerHTML = statusDefs.map(b => {
      const pct = Math.round((b.count / totalCust) * 100);
      return `
        <div class="bar-row">
          <span>${b.label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${b.color};"></div></div>
          <strong>${b.count} (${pct}%)</strong>
        </div>
      `;
    }).join("");

    // 2d. Staff Stacked Load Chart
    $("#staffLoadChart").innerHTML = out.report.by_staff.map(st => {
      const cap = Math.max(1, st.max_weekly_capacity);
      const pInit = Math.min(100, Math.round((st.initial_load / cap) * 100));
      const pNew = Math.min(100 - pInit, Math.round((st.new_assigned_confirmed / cap) * 100));
      const pPend = Math.min(100 - pInit - pNew, Math.round((st.pending_manager_approval / cap) * 100));
      const over = (st.total_projected_load + st.pending_manager_approval) >= st.max_weekly_capacity;
      return `
        <div class="staff-chart-row">
          <span><strong>${escapeHtml(st.staff_name)}</strong> <small class="hint">(${st.staff_id})</small></span>
          <div class="staff-bar-track" title="Hiện có: ${st.initial_load} | Giao mới: ${st.new_assigned_confirmed} | Chờ duyệt: ${st.pending_manager_approval} / Định mức: ${st.max_weekly_capacity}">
            <div class="staff-seg" style="width:${pInit}%;background:#52525b;"></div>
            <div class="staff-seg" style="width:${pNew}%;background:#34d399;"></div>
            <div class="staff-seg" style="width:${pPend}%;background:#f2ea00;"></div>
          </div>
          <strong style="color:${over ? "#b91c1c" : "#111111"};">${st.total_projected_load}${st.pending_manager_approval ? ` (+${st.pending_manager_approval})` : ""} / ${st.max_weekly_capacity}</strong>
        </div>
      `;
    }).join("");

    // 2e. Detailed Business Report
    $("#detailedReportBox").innerHTML = buildDetailedReportHTML(out);

    // 3. Staff Stats Table
    $("#staffStatsTable tbody").innerHTML = out.report.by_staff.map(st => {
      const over = st.total_projected_load >= st.max_weekly_capacity;
      return `
        <tr>
          <td><code>${st.staff_id}</code></td>
          <td><strong>${escapeHtml(st.staff_name)}</strong></td>
          <td>${escapeHtml(st.regions)}</td>
          <td>${escapeHtml(st.industries)}</td>
          <td>${st.initial_load}</td>
          <td><span class="pill pill-green">+${st.new_assigned_confirmed}</span></td>
          <td>${st.pending_manager_approval > 0 ? `<span class="pill pill-amber">${st.pending_manager_approval}</span>` : "0"}</td>
          <td><strong>${st.total_projected_load} / ${st.max_weekly_capacity}</strong></td>
          <td><span class="pill ${over ? "pill-red" : "pill-green"}">${over ? "Sát/Vượt định mức" : "Còn nhận được"}</span></td>
        </tr>
      `;
    }).join("");

    renderCustomersTable();
    renderActionQueues();
    renderExecutionTrace();
  }

  function buildDonutChartHTML(segments, totalVal, centerLabel) {
    const total = Math.max(1, segments.reduce((a, b) => a + b.count, 0));
    const r = 46;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const circles = segments.map(seg => {
      const frac = seg.count / total;
      const len = frac * c;
      const dash = `${len.toFixed(2)} ${(c - len).toFixed(2)}`;
      const circle = `<circle cx="60" cy="60" r="${r}" fill="transparent" stroke="${seg.color}" stroke-width="14" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset).toFixed(2)}" />`;
      offset += len;
      return circle;
    }).join("");

    const legend = segments.map(seg => {
      const pct = Math.round((seg.count / total) * 100);
      return `<div class="donut-legend-item">
        <span><i class="lg-dot" style="background:${seg.color}"></i>${escapeHtml(seg.label)}</span>
        <strong>${seg.count} (${pct}%)</strong>
      </div>`;
    }).join("");

    return `
      <svg width="120" height="120" viewBox="0 0 120 120" style="transform:rotate(-90deg);flex-shrink:0;">
        <circle cx="60" cy="60" r="${r}" fill="transparent" stroke="#e4e4e7" stroke-width="14" />
        ${circles}
        <g style="transform:rotate(90deg);transform-origin:60px 60px;">
          <text x="60" y="57" text-anchor="middle" fill="#111111" font-size="20" font-weight="800">${totalVal}</text>
          <text x="60" y="73" text-anchor="middle" fill="#52525b" font-size="9.5">${escapeHtml(centerLabel)}</text>
        </g>
      </svg>
      <div class="donut-legend">${legend}</div>
    `;
  }

  function buildDetailedReportHTML(out) {
    const s = out.report.summary;
    const customers = out.customers;
    const validPipelineBudget = customers
      .filter(c => !c.is_do_not_contact && !c.is_wrong_product && (c.budget_vnd || 0) > 0)
      .reduce((acc, c) => acc + c.budget_vnd, 0);
    const wrongProdList = customers.filter(c => c.is_wrong_product);
    const clarifyCount = customers.filter(c => !c.is_do_not_contact && c.draft_type === "clarify_questions").length;
    const outreachCount = customers.filter(c => !c.is_do_not_contact && c.draft_type !== "clarify_questions").length;
    const dupRate = s.total_raw_records > 0 ? Math.round((s.duplicates_merged / s.total_raw_records) * 100) : 0;

    const mgrItems = out.report.lists.manager_decisions.slice(0, 5).map(c =>
      `<li><strong>${escapeHtml(c.company_name)}</strong> (${escapeHtml(c.customer_id)}): ${escapeHtml(c.escalation_reasons.join("; "))}</li>`
    ).join("");
    const unItems = out.report.lists.unassigned.slice(0, 5).map(c =>
      `<li><strong>${escapeHtml(c.company_name)}</strong>: Ngành ${escapeHtml(c.industry || "Trống")} · KV ${escapeHtml(c.region || "Trống")}</li>`
    ).join("");
    const dncItems = out.report.lists.do_not_contact.slice(0, 4).map(c =>
      `<li><strong>${escapeHtml(c.company_name)}</strong>: Chặn theo lịch sử liên hệ</li>`
    ).join("");

    return `
      <div class="report-block">
        <strong class="rb-title">I. Tổng hợp Dữ liệu & Giá trị Cơ hội</strong>
        <ul>
          <li>Tiếp nhận <strong>${s.total_raw_records}</strong> hồ sơ → gộp <strong>${s.duplicates_merged}</strong> bản ghi trùng (${dupRate}%) → còn <strong>${s.unique_customers}</strong> khách hàng duy nhất.</li>
          <li>Tổng ngân sách tiềm năng hợp lệ (đã loại sai sản phẩm & DNC): <strong>${skills.formatVND(validPipelineBudget)}</strong>.</li>
          <li>Phát hiện <strong>${wrongProdList.length}</strong> hồ sơ sai sản phẩm (đã chặn nâng ưu tiên dù ngân sách lớn).</li>
        </ul>
      </div>
      <div class="report-block">
        <strong class="rb-title">II. Trường hợp Cần Xử lý & Giám sát</strong>
        <ul>
          ${mgrItems || "<li>Không có ca cần Trưởng phòng duyệt thêm.</li>"}
          ${unItems}
          ${dncItems}
        </ul>
      </div>
      <div class="report-block">
        <strong class="rb-title">III. Kế hoạch Hành động Đội Kinh doanh</strong>
        <ul>
          <li>Đã soạn sẵn <strong>${outreachCount}</strong> bản nháp tiếp cận / chốt demo và <strong>${clarifyCount}</strong> bộ câu hỏi bổ sung cho hồ sơ thiếu thông tin.</li>
          <li>Ưu tiên gọi ngay nhóm <strong>Cao (${s.by_priority["Cao"]} KH)</strong> và xử lý <strong>${s.manager_decision_count} ca</strong> đang chờ Trưởng phòng phê duyệt.</li>
        </ul>
      </div>
    `;
  }

  function getPriorityPillClass(level) {
    if (level === "Cao") return "pill-green";
    if (level === "Trung bình") return "pill-blue";
    if (level === "Không liên hệ lại") return "pill-red";
    return "pill-gray";
  }

  function renderCustomersTable() {
    if (!state.agentOutput) return;
    const q = ($("#filterSearch").value || "").toLowerCase().trim();
    const fp = $("#filterPriority").value;
    const fs = $("#filterStatus").value;

    const filtered = state.agentOutput.customers.filter(c => {
      if (fp && c.priority_level !== fp) return false;
      if (fs && !c.assignment_status.includes(fs)) return false;
      if (q) {
        const hay = [
          c.customer_id, c.company_name, c.tax_code,
          ...c.alias_names, ...c.phones, ...c.emails,
          ...c.source_records.map(sr => sr.lead_id)
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const tbody = $("#customersTable tbody");
    tbody.innerHTML = filtered.slice(0, 150).map(c => {
      const srcHtml = c.source_records.map(sr =>
        `<span class="source-chip" title="${escapeHtml(sr.company_name)}">${escapeHtml(sr.lead_id)} (${escapeHtml(sr.source_channel)})</span>`
      ).join("");
      const missHtml = c.missing_fields.length > 0
        ? c.missing_fields.map(m => `<span class="missing-chip">${escapeHtml(m)}</span>`).join("")
        : `<span class="pill pill-green">Đầy đủ</span>`;

      return `
        <tr>
          <td>
            <strong>${escapeHtml(c.customer_id)}</strong><br/>
            <strong>${escapeHtml(c.company_name)}</strong><br/>
            <small class="hint">${escapeHtml(c.industry || "Chưa rõ ngành")} · ${escapeHtml(c.region || "Chưa rõ vùng")}</small><br/>
            <small class="hint">Ngân sách: ${skills.formatVND(c.budget_vnd)}</small>
          </td>
          <td>
            ${srcHtml}
            ${c.duplicate_count > 1 ? `<div class="hint mt-1">Gộp ${c.duplicate_count} bản ghi (${escapeHtml(c.dedup_reasons.slice(1).join("; "))})</div>` : ""}
            ${c.ambiguous_duplicate ? `<div class="pill pill-amber mt-1">Cần xác nhận trùng</div>` : ""}
          </td>
          <td>
            <div>${escapeHtml(c.merged_needs || "(Chưa có mô tả)")}</div>
            <div class="mt-1"><strong>Thiếu:</strong> ${missHtml}</div>
          </td>
          <td>
            <span class="pill ${getPriorityPillClass(c.priority_level)}">${escapeHtml(c.priority_level)} (${c.priority_score}đ)</span>
            <div class="hint mt-1">${escapeHtml(c.priority_rationale)}</div>
          </td>
          <td>
            <strong>${escapeHtml(c.assigned_salesperson)}</strong><br/>
            <small class="hint"><strong>Việc tiếp theo:</strong> ${escapeHtml(c.next_action)}</small>
          </td>
          <td>
            <button class="btn btn-outline btn-sm btn-view-draft" data-cid="${c.customer_id}" type="button">
              ${c.draft_type === "clarify_questions" ? "Xem Câu hỏi Bổ sung" : "Xem Bản nháp Tiếp cận"}
            </button>
          </td>
        </tr>
      `;
    }).join("") + (filtered.length > 150 ? `<tr><td colspan="6" class="hint">Đang hiển thị 150/${filtered.length} khách hàng. Dùng ô tìm kiếm để lọc nhanh.</td></tr>` : "");

    tbody.querySelectorAll(".btn-view-draft").forEach(btn => {
      btn.addEventListener("click", () => {
        const cust = state.agentOutput.customers.find(x => x.customer_id === btn.dataset.cid);
        if (!cust) return;
        $("#modalTitle").textContent = `${cust.customer_id} – ${cust.company_name} (${cust.draft_type === "clarify_questions" ? "Câu hỏi bổ sung" : "Thông điệp tiếp cận"})`;
        $("#modalDraftText").value = cust.draft_message;
        $("#draftModal").classList.remove("hidden");
      });
    });
  }

  function renderActionQueues() {
    if (!state.agentOutput) return;
    const lists = state.agentOutput.report.lists;
    const staffOptions = (state.config.sales_staff || []).map(s =>
      `<option value="${s.staff_id}">${escapeHtml(s.staff_name)} (${s.staff_id} - ${escapeHtml(s.assigned_regions[0] || "")})</option>`
    ).join("");

    // A. Manager Decision Queue
    const mgrContainer = $("#managerDecisionCards");
    if (lists.manager_decisions.length === 0) {
      mgrContainer.innerHTML = `<p class="hint">Không có trường hợp nào cần Trưởng phòng xử lý thêm.</p>`;
    } else {
      mgrContainer.innerHTML = lists.manager_decisions.map(c => `
        <div class="action-card card-amber">
          <div class="flex-between">
            <strong>${c.customer_id} – ${escapeHtml(c.company_name)}</strong>
            <span class="pill ${getPriorityPillClass(c.priority_level)}">${c.priority_level} (${c.priority_score}đ)</span>
          </div>
          <div class="hint">Bản ghi nguồn: ${c.source_records.map(r => r.lead_id).join(", ")} | Đề xuất hiện tại: <strong>${escapeHtml(c.assigned_salesperson)}</strong></div>
          <ul class="warning-list">${c.escalation_reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
          <div class="action-card-controls">
            <select class="mgr-staff-select" data-cid="${c.customer_id}">
              <option value="">-- Giữ đề xuất / Chọn NVKD duyệt giao --</option>
              ${staffOptions}
            </select>
            <button class="btn btn-primary btn-sm btn-mgr-approve" data-cid="${c.customer_id}" type="button">Phê duyệt & Giao việc</button>
          </div>
        </div>
      `).join("");
    }

    // B. Unassigned Queue
    const unContainer = $("#unassignedCards");
    if (lists.unassigned.length === 0) {
      unContainer.innerHTML = `<p class="hint">Tất cả khách hàng hợp lệ đều đã có NVKD phù hợp.</p>`;
    } else {
      unContainer.innerHTML = lists.unassigned.map(c => `
        <div class="action-card card-red">
          <strong>${c.customer_id} – ${escapeHtml(c.company_name)}</strong>
          <div class="hint">Ngành: ${escapeHtml(c.industry || "Trống")} | Khu vực: ${escapeHtml(c.region || "Trống")} | Ưu tiên: ${c.priority_level}</div>
          <div class="action-card-controls">
            <select class="mgr-staff-select" data-cid="${c.customer_id}">
              <option value="">-- Chọn NVKD điều phối chéo --</option>
              ${staffOptions}
            </select>
            <button class="btn btn-secondary btn-sm btn-mgr-approve" data-cid="${c.customer_id}" type="button">Gán phụ trách</button>
          </div>
        </div>
      `).join("");
    }

    // Bind manager approval buttons
    $$(".btn-mgr-approve").forEach(btn => {
      btn.addEventListener("click", () => {
        const cid = btn.dataset.cid;
        const select = btn.parentElement.querySelector(".mgr-staff-select");
        const chosenId = select.value;
        const cust = state.agentOutput.customers.find(x => x.customer_id === cid);
        if (!cust) return;
        if (chosenId) {
          const st = state.config.sales_staff.find(s => s.staff_id === chosenId);
          cust.assigned_staff_id = st.staff_id;
          cust.assigned_salesperson = `${st.staff_name} (${st.staff_id}) [Trưởng phòng duyệt]`;
        } else if (!cust.assigned_staff_id) {
          alert("Vui lòng chọn một Nhân viên Kinh doanh trước khi gán.");
          return;
        }
        cust.needs_manager_decision = false;
        cust.ambiguous_duplicate = false;
        cust.assignment_status = "assigned";
        cust.next_action = `Đã được Trưởng phòng Kinh doanh phê duyệt giao cho ${cust.assigned_salesperson}.`;

        // Recompute report stats cleanly without double-counting
        const staffPool = (state.config.sales_staff || []).map(s => ({ ...s, dynamic_load: s.current_load || 0 }));
        state.agentOutput.report = skills.toolCompileReportsAndStats(state.agentOutput.customers, staffPool);
        state.agentOutput.trace.push({
          run_id: state.agentOutput.run_id,
          step: state.agentOutput.trace.length + 1,
          timestamp: new Date().toISOString(),
          thought: "Trưởng phòng Kinh doanh (Human-in-the-Loop) đã phê duyệt quyết định phân công trên giao diện.",
          tool_called: "human_manager_approval",
          input_summary: { customer_id: cid, assigned_to: cust.assigned_salesperson },
          rules_applied: ["human_in_the_loop_override"],
          output_summary: { status: "approved" }
        });
        renderResultsDashboard();
      });
    });

    // C. Do Not Contact Queue
    const dncContainer = $("#doNotContactCards");
    if (lists.do_not_contact.length === 0) {
      dncContainer.innerHTML = `<p class="hint">Không phát hiện khách thuộc danh sách ngừng liên hệ.</p>`;
    } else {
      dncContainer.innerHTML = lists.do_not_contact.map(c => `
        <div class="action-card card-gray">
          <strong>${c.customer_id} – ${escapeHtml(c.company_name)}</strong>
          <div class="hint">Nguồn đăng ký lại: ${c.source_records.map(r => r.lead_id).join(", ")}</div>
          <div class="mt-1"><strong>Lý do chặn:</strong> ${escapeHtml(c.priority_rationale)}</div>
        </div>
      `).join("");
    }

    // D. Tasks grouped by Salesperson
    const tasksContainer = $("#salesTasksByStaff");
    const staffGroups = (state.config.sales_staff || []).map(st => {
      const myTasks = state.agentOutput.customers.filter(c => c.assigned_staff_id === st.staff_id && !c.is_do_not_contact);
      if (myTasks.length === 0) return "";
      return `
        <div class="action-card mt-1">
          <strong>${escapeHtml(st.staff_name)} (${st.staff_id})</strong> — ${myTasks.length} khách hàng được giao/đề xuất
          <ul style="margin:6px 0 0;padding-left:18px;">
            ${myTasks.map(t => `
              <li>
                <strong>${t.customer_id} – ${escapeHtml(t.company_name)}</strong>
                <span class="pill ${getPriorityPillClass(t.priority_level)}">${t.priority_level}</span>
                ${t.needs_manager_decision ? `<span class="pill pill-amber">Chờ Trưởng phòng duyệt</span>` : ""}
                — ${escapeHtml(t.next_action)}
              </li>
            `).join("")}
          </ul>
        </div>
      `;
    }).join("");
    tasksContainer.innerHTML = staffGroups || `<p class="hint">Chưa có công việc nào được giao cho NVKD.</p>`;
  }

  function renderExecutionTrace() {
    if (!state.agentOutput) return;
    $("#traceTimeline").innerHTML = state.agentOutput.trace.map(t => `
      <div class="trace-item">
        <div class="flex-between">
          <strong>Bước ${t.step}: Tool <code>${escapeHtml(t.tool_called)}</code></strong>
          <small class="hint">${escapeHtml(t.timestamp)}</small>
        </div>
        <div><em>Suy luận Agent (Thought):</em> ${escapeHtml(t.thought)}</div>
        <div class="hint mt-1"><strong>Quy tắc áp dụng:</strong> ${(t.rules_applied || []).map(r => `<code>${escapeHtml(r)}</code>`).join(", ")}</div>
        <pre>${escapeHtml(JSON.stringify({ input: t.input_summary, output: t.output_summary }, null, 2))}</pre>
      </div>
    `).join("");
  }

  async function refreshDiskLogs() {
    const ul = $("#diskLogsList");
    try {
      const res = await fetch("/api/logs");
      const data = await res.json();
      if (!data.ok || !data.files?.length) {
        ul.innerHTML = `<li class="hint">Chưa có file log nào trong thư mục logs/.</li>`;
        return;
      }
      ul.innerHTML = data.files.slice(0, 10).map(f => `
        <li>
          <span><code>logs/${escapeHtml(f.Name)}</code> (${f.Length} bytes)</span>
          <a href="/api/logs/${encodeURIComponent(f.Name)}" target="_blank" class="btn btn-outline btn-sm">Mở Log</a>
        </li>
      `).join("");
    } catch {
      ul.innerHTML = `<li class="hint">Chế độ tĩnh không kết nối server log.</li>`;
    }
  }

  // ---- Exports ----
  function exportCustomersCSV() {
    if (!state.agentOutput) return;
    const headers = ["customer_id", "company_name", "source_lead_ids", "merged_needs", "missing_fields", "priority_level", "priority_score", "priority_rationale", "assigned_salesperson", "assignment_status", "next_action", "draft_message"];
    const lines = [headers.join(",")];
    for (const c of state.agentOutput.customers) {
      lines.push([
        c.customer_id,
        c.company_name,
        c.source_records.map(r => r.lead_id).join("; "),
        c.merged_needs,
        c.missing_fields.join("; "),
        c.priority_level,
        c.priority_score,
        c.priority_rationale,
        c.assigned_salesperson,
        c.assignment_status,
        c.next_action,
        c.draft_message
      ].map(csvCell).join(","));
    }
    downloadBlob(`namviet_customers_${state.agentOutput.run_id}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportTasksCSV() {
    if (!state.agentOutput) return;
    const headers = ["queue_type", "customer_id", "company_name", "priority_level", "assigned_salesperson", "escalation_reasons", "next_action"];
    const lines = [headers.join(",")];
    for (const c of state.agentOutput.customers) {
      let q = "SALES_TASK";
      if (c.is_do_not_contact) q = "DO_NOT_CONTACT";
      else if (c.needs_manager_decision) q = "MANAGER_DECISION";
      else if (c.assignment_status === "unassigned") q = "UNASSIGNED";
      lines.push([
        q, c.customer_id, c.company_name, c.priority_level,
        c.assigned_salesperson, c.escalation_reasons.join(" | "), c.next_action
      ].map(csvCell).join(","));
    }
    downloadBlob(`namviet_business_tasks_${state.agentOutput.run_id}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportAuditJSONL() {
    if (!state.agentOutput) return;
    const jsonl = state.agentOutput.trace.map(t => JSON.stringify(t)).join("\n");
    downloadBlob(`trace_${state.agentOutput.run_id}.jsonl`, jsonl, "application/x-ndjson;charset=utf-8");
  }

  function exportFinalHTMLReport() {
    if (!state.agentOutput) return;
    const out = state.agentOutput;
    const s = out.report.summary;
    const staffRows = out.report.by_staff.map(st => `
      <tr>
        <td>${escapeHtml(st.staff_id)}</td>
        <td><strong>${escapeHtml(st.staff_name)}</strong></td>
        <td>${escapeHtml(st.regions)}</td>
        <td>${escapeHtml(st.industries)}</td>
        <td>${st.initial_load}</td>
        <td>+${st.new_assigned_confirmed}</td>
        <td>${st.pending_manager_approval}</td>
        <td>${st.total_projected_load} / ${st.max_weekly_capacity}</td>
      </tr>
    `).join("");

    const customerRows = out.customers.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.customer_id)}</strong><br/>${escapeHtml(c.company_name)}<br/><small>${escapeHtml(c.industry)} · ${escapeHtml(c.region)}</small></td>
        <td>${c.source_records.map(r => escapeHtml(r.lead_id)).join(", ")}</td>
        <td>${escapeHtml(c.merged_needs || "")}<br/><small><strong>Thiếu:</strong> ${c.missing_fields.length ? escapeHtml(c.missing_fields.join(", ")) : "Đủ"}</small></td>
        <td><strong>${escapeHtml(c.priority_level)}</strong> (${c.priority_score}đ)<br/><small>${escapeHtml(c.priority_rationale)}</small></td>
        <td><strong>${escapeHtml(c.assigned_salesperson)}</strong><br/><small>${escapeHtml(c.next_action)}</small></td>
        <td><pre style="white-space:pre-wrap;margin:0;font-family:inherit;font-size:12px;">${escapeHtml(c.draft_message || "")}</pre></td>
      </tr>
    `).join("");

    const verifyHtml = (out.verification?.checks || []).map(ch =>
      `<span class="pill ${ch.status === "PASS" ? "ok" : "err"}">${escapeHtml(ch.name)}: ${escapeHtml(ch.status)}</span>`
    ).join(" ");
    const detailedReportHtml = buildDetailedReportHTML(out);
    const donutHtml = $("#priorityDonutChart")?.innerHTML || "";

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Báo cáo Chốt Kết quả - Nam Việt AI Agent (${escapeHtml(out.run_id)})</title>
<style>
  body { margin:0; padding:28px; font-family:"Segoe UI",system-ui,sans-serif; background:#ffffff; color:#111111; line-height:1.5; }
  .wrap { max-width:1280px; margin:0 auto; }
  .hdr { background:#fefce8; border:1px solid #eab308; border-radius:14px; padding:20px 24px; margin-bottom:20px; }
  h1 { margin:0 0 6px; font-size:22px; color:#111111; }
  h2 { margin:22px 0 10px; font-size:17px; color:#111111; border-left:4px solid #facc15; padding-left:10px; }
  .meta { color:#52525b; font-size:13px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin:14px 0; }
  .kpi { background:#ffffff; border:1px solid #e4e4e7; border-radius:10px; padding:12px 14px; }
  .kpi .lbl { font-size:12px; color:#52525b; }
  .kpi .val { font-size:24px; font-weight:800; color:#111111; margin-top:4px; }
  .brief { background:#fefce8; border:1px solid #fde047; border-radius:10px; padding:14px; white-space:pre-wrap; font-family:inherit; color:#111111; }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin:2px; }
  .pill.ok { background:#dcfce7; color:#15803d; border:1px solid #86efac; }
  .pill.err { background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; }
  .donut-legend { display:grid; gap:6px; flex:1; font-size:13px; }
  .donut-legend-item { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .lg-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; }
  .detail-report-list { display:grid; gap:8px; font-size:13px; }
  .detail-report-item { padding:8px 10px; border-radius:8px; background:#fefce8; border:1px solid #fde68a; }
  table { width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #e4e4e7; font-size:12.5px; }
  th, td { border:1px solid #e4e4e7; padding:8px 10px; text-align:left; vertical-align:top; color:#111111; }
  th { background:#fef9c3; color:#111111; font-weight:700; }
  @media print { body { background:#fff; color:#111; } .hdr,.kpi,.brief,table { background:#fff; color:#111; border-color:#ccc; } th { background:#fef9c3; color:#111; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>BÁO CÁO CHỐT KẾT QUẢ ĐIỀU PHỐI KHÁCH HÀNG — NAM VIỆT AI AGENT</h1>
    <div class="meta">Run ID: ${escapeHtml(out.run_id)} · Nguồn: ${escapeHtml(state.parsedDataset?.sourceLabel || "")} · Thời điểm xuất: ${escapeHtml(new Date().toLocaleString("vi-VN"))}</div>
    <div style="margin-top:8px;">${verifyHtml}</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="lbl">Hồ sơ gốc</div><div class="val">${s.total_raw_records}</div></div>
    <div class="kpi"><div class="lbl">KH Duy nhất</div><div class="val">${s.unique_customers}</div></div>
    <div class="kpi"><div class="lbl">Ưu tiên Cao</div><div class="val">${s.by_priority["Cao"]}</div></div>
    <div class="kpi"><div class="lbl">Trung bình</div><div class="val">${s.by_priority["Trung bình"]}</div></div>
    <div class="kpi"><div class="lbl">Thấp</div><div class="val">${s.by_priority["Thấp"]}</div></div>
    <div class="kpi"><div class="lbl">Chờ Trưởng phòng</div><div class="val">${s.manager_decision_count}</div></div>
    <div class="kpi"><div class="lbl">Chưa có NVKD</div><div class="val">${s.unassigned_count}</div></div>
    <div class="kpi"><div class="lbl">Không liên hệ lại</div><div class="val">${s.do_not_contact_count}</div></div>
  </div>

  <h2>Biểu đồ Tỷ lệ Ưu tiên & Báo cáo Chi tiết</h2>
  <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:16px;margin-bottom:16px;">
    <div class="kpi" style="display:flex;align-items:center;gap:16px;">${donutHtml}</div>
    <div class="kpi">${detailedReportHtml}</div>
  </div>

  <h2>Tóm tắt Điều hành</h2>
  <pre class="brief">${escapeHtml(out.executive_brief)}</pre>

  <h2>Phân công Đội ngũ 8 Nhân viên Kinh doanh</h2>
  <table>
    <thead><tr><th>Mã</th><th>NVKD</th><th>Khu vực</th><th>Ngành</th><th>Hiện có</th><th>Giao mới</th><th>Chờ duyệt</th><th>Tổng / Định mức</th></tr></thead>
    <tbody>${staffRows}</tbody>
  </table>

  <h2>Danh sách Hồ sơ Khách hàng Sau Đối chiếu (${out.customers.length})</h2>
  <table>
    <thead><tr><th>Khách hàng</th><th>Nguồn</th><th>Nhu cầu & Thiếu</th><th>Ưu tiên & Lý do</th><th>Phân công & Việc tiếp theo</th><th>Bản nháp</th></tr></thead>
    <tbody>${customerRows}</tbody>
  </table>
</div>
</body>
</html>`;

    downloadBlob(`namviet_bao_cao_ket_qua_${out.run_id}.html`, html, "text/html;charset=utf-8");
  }

  // ---- Config Save ----
  async function saveConfigFromEditor() {
    const statusEl = $("#configSaveStatus");
    try {
      const parsed = JSON.parse($("#configEditor").value);
      state.config = parsed;
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      if (res.ok) {
        statusEl.textContent = "Đã lưu cấu hình quy tắc xuống config/business_rules.json!";
      } else {
        statusEl.textContent = "Đã áp dụng cấu hình vào phiên làm việc hiện tại.";
      }
    } catch (err) {
      statusEl.textContent = "JSON không hợp lệ: " + err.message;
    }
  }

  // ---- 700 Leads Generator (Context Stress Test) ----
  function generateAndLoad700Leads() {
    const industries = ["Sản xuất", "Thương mại", "Bán lẻ", "Dịch vụ", "Logistics", "Giáo dục", "F&B", "Nông nghiệp"];
    const regions = ["Hà Nội", "TP.HCM", "Đà Nẵng", "Bình Dương", "Cần Thơ", "Hải Phòng", "Tây Nguyên"];
    const channels = ["Hội thảo", "Website", "Campaign"];
    const products = ["NV-ERP", "NV-CRM", "NV-HRM", "NV-POS", ""];
    const needs = [
      "Cần phần mềm quản lý tồn kho và kế toán sản xuất gấp trong tháng này",
      "Tìm hiểu giải pháp CRM chăm sóc khách hàng và pipeline bán hàng",
      "Quản lý chuỗi cửa hàng bán lẻ POS và hóa đơn mã vạch",
      "Chấm công tính lương nhân sự cho 80 nhân viên",
      "Đang tìm hiểu phần mềm quản trị doanh nghiệp"
    ];

    const header = ["lead_id", "company_name", "tax_code", "contact_name", "phone", "email", "industry", "region", "product_interest", "need_description", "budget_vnd", "source_channel", "registered_at"];
    const matrix = [header];

    // Generate 700 raw leads with realistic ~15% duplicates & edge cases
    for (let i = 1; i <= 700; i++) {
      const baseIdx = i % 580 === 0 ? 1 : (i > 580 ? i - 580 : i); // inject ~120 duplicates
      const ind = industries[baseIdx % industries.length];
      const reg = regions[baseIdx % regions.length];
      const ch = channels[i % channels.length];
      const prod = products[baseIdx % products.length];
      const compName = i > 580 ? `Cty TNHH Doanh nghiệp ${baseIdx}` : `Công ty Cổ phần Doanh nghiệp ${baseIdx}`;
      const budget = (i % 7 === 0) ? "" : String(((baseIdx % 12) + 2) * 25000000);
      matrix.push([
        `L700_${String(i).padStart(3, "0")}`,
        compName,
        `010${String(1000000 + baseIdx)}`,
        `Liên hệ ${i}`,
        `09${String(10000000 + baseIdx).slice(0, 8)}`,
        `contact${baseIdx}@dn${baseIdx}.vn`,
        ind,
        reg,
        prod,
        needs[baseIdx % needs.length],
        budget,
        ch,
        "2026-11-10"
      ]);
    }
    ingestMatrix(matrix, "Bộ dữ liệu Stress Test 700 Leads/Tuần");
  }

  // ---- Self-Test Suite (Task 2 Verification) ----
  async function runSelfTestSuite() {
    const outBox = $("#selfTestResults");
    outBox.innerHTML = `<p class="hint">Đang chạy bộ kiểm thử tự động...</p>`;
    const cases = [];

    // Case 1: Normal case
    const normalDS = validator.matrixToObjects([
      ["lead_id", "company_name", "tax_code", "contact_name", "phone", "email", "industry", "region", "product_interest", "need_description", "budget_vnd", "source_channel", "registered_at"],
      ["T01", "Công ty CP Cơ khí Hòa Phát", "0108881112", "Nguyễn A", "0912000111", "a@hoaphat.vn", "Sản xuất", "Hà Nội", "NV-ERP", "Cần triển khai ERP quản trị sản xuất và tồn kho tháng này", "120000000", "Website", "2026-11-10"]
    ], state.config.schema);
    const res1 = await agent.runAgentPipeline({ parsedDataset: normalDS, config: state.config });
    const c1 = res1.customers[0];
    cases.push({
      name: "Kịch bản 1 (Thông thường): Khách khớp SP + đầy đủ dữ liệu",
      passed: c1.priority_level === "Cao" && c1.assigned_staff_id === "NV01" && !c1.needs_manager_decision,
      detail: `Ưu tiên=${c1.priority_level} (${c1.priority_score}đ), NVKD=${c1.assigned_salesperson}, Duyệt TP=${c1.needs_manager_decision}`
    });

    // Case 2: Missing info case (must NOT be discarded + generates clarifying questions)
    const missingDS = validator.matrixToObjects([
      ["lead_id", "company_name", "tax_code", "contact_name", "phone", "email", "industry", "region", "product_interest", "need_description", "budget_vnd", "source_channel", "registered_at"],
      ["T02", "Xưởng Gỗ Thành Đạt", "", "Trần B", "0988111222", "", "Sản xuất", "Hà Nội", "", "Cần phần mềm quản trị sản xuất nhưng chưa rõ ngân sách", "", "Hội thảo", "2026-11-10"]
    ], state.config.schema);
    const res2 = await agent.runAgentPipeline({ parsedDataset: missingDS, config: state.config });
    const c2 = res2.customers[0];
    cases.push({
      name: "Kịch bản 2 (Thiếu dữ liệu): Thiếu ngân sách, MST, Email nhưng vẫn đúng sản phẩm",
      passed: c2.missing_fields.includes("Ngân sách dự kiến") && c2.draft_type === "clarify_questions" && c2.priority_level !== "Thấp",
      detail: `Thiếu=[${c2.missing_fields.join(", ")}], Ưu tiên=${c2.priority_level} (${c2.priority_score}đ), Loại nháp=${c2.draft_type}`
    });

    // Case 3: Boundary & Rule Traps
    const edgeDS = validator.matrixToObjects([
      ["lead_id", "company_name", "tax_code", "contact_name", "phone", "email", "industry", "region", "product_interest", "need_description", "budget_vnd", "source_channel", "registered_at"],
      // 3a. Wrong product + high budget (450M)
      ["T03A", "Cty Media XYZ", "0301112223", "Lê C", "0901112233", "c@xyz.vn", "Dịch vụ", "TP.HCM", "Khác", "Thiết kế logo và quay phim quảng cáo Facebook", "450000000", "Campaign", "2026-11-10"],
      // 3b. Duplicate with abbreviation
      ["T03B1", "Công ty TNHH Hoàng Hà", "0102233445", "An", "0911223344", "an@hoangha.vn", "Sản xuất", "Hà Nội", "NV-ERP", "Cần ERP kho", "100000000", "Hội thảo", "2026-11-09"],
      ["T03B2", "Cty HH", "", "Bình", "0911223399", "binh@hoangha.vn", "Sản xuất", "Hà Nội", "NV-HRM", "Thêm HRM chấm công", "50000000", "Website", "2026-11-10"],
      // 3c. Boundary VIP 300,000,000 exact
      ["T03C", "Tập đoàn Thực phẩm Á Châu", "0305556667", "Dũng", "0909333444", "dung@achau.vn", "Sản xuất", "TP.HCM", "NV-ERP", "Triển khai ERP toàn diện cho 3 nhà máy cần demo gấp", "300000000", "Hội thảo", "2026-11-10"],
      // 3d. History Do Not Contact
      ["T03D", "Công ty TNHH Thương mại Thái Bình Dương", "0312998877", "Huy", "0909112233", "contact@thaibinhduong.vn", "Thương mại", "TP.HCM", "NV-CRM", "Đăng ký lại", "50000000", "Website", "2026-11-10"],
      // 3e. Unassigned region/industry
      ["T03E", "HTX Nông sản Tây Nguyên", "", "Y Sơn", "0944123123", "son@htx.vn", "Nông nghiệp", "Tây Nguyên", "NV-ERP", "Quản lý kho nông sản", "90000000", "Website", "2026-11-10"]
    ], state.config.schema);
    const res3 = await agent.runAgentPipeline({ parsedDataset: edgeDS, config: state.config });
    const c3a = res3.customers.find(c => c.source_records.some(r => r.lead_id === "T03A"));
    const c3b = res3.customers.find(c => c.source_records.some(r => r.lead_id === "T03B1"));
    const c3c = res3.customers.find(c => c.source_records.some(r => r.lead_id === "T03C"));
    const c3d = res3.customers.find(c => c.source_records.some(r => r.lead_id === "T03D"));
    const c3e = res3.customers.find(c => c.source_records.some(r => r.lead_id === "T03E"));

    cases.push({
      name: "Kịch bản 3a (Ranh giới Sai sản phẩm): Ngân sách 450tr nhưng sai sản phẩm -> Chặn ưu tiên cao",
      passed: c3a.is_wrong_product && c3a.priority_level === "Thấp",
      detail: `is_wrong_product=${c3a.is_wrong_product}, Ưu tiên=${c3a.priority_level}`
    });
    cases.push({
      name: "Kịch bản 3b (Gộp trùng viết tắt): 'Công ty TNHH Hoàng Hà' + 'Cty HH' -> Gom thành 1 KH duy nhất",
      passed: c3b.duplicate_count === 2 && res3.report.summary.unique_customers === 5,
      detail: `Số bản ghi gộp=${c3b.duplicate_count}, Tổng KH duy nhất=${res3.report.summary.unique_customers}/6 hồ sơ gốc`
    });
    cases.push({
      name: "Kịch bản 3c (Ranh giới VIP = 300.000.000 VNĐ): Chuyển Trưởng phòng phê duyệt",
      passed: c3c.needs_manager_decision === true,
      detail: `needs_manager_decision=${c3c.needs_manager_decision}, Lý do=[${c3c.escalation_reasons.join("; ")}]`
    });
    cases.push({
      name: "Kịch bản 3d (Lịch sử chặn liên hệ): Thái Bình Dương -> Danh sách Không liên hệ lại",
      passed: c3d.is_do_not_contact === true && c3d.priority_level === "Không liên hệ lại",
      detail: `is_do_not_contact=${c3d.is_do_not_contact}, Trạng thái=${c3d.assignment_status}`
    });
    cases.push({
      name: "Kịch bản 3e (Chưa có người phù hợp): Ngành Nông nghiệp tại Tây Nguyên -> Unassigned",
      passed: c3e.assignment_status.startsWith("unassigned"),
      detail: `Trạng thái=${c3e.assignment_status}, NVKD=${c3e.assigned_salesperson}`
    });

    // Case 4: Invalid format rejection constraint
    const badDS = validator.matrixToObjects([
      ["lead_id", "company_name", "tax_code", "contact_name", "phone", "email", "industry", "region", "product_interest", "need_description", "budget_vnd", "source_channel", "registered_at"],
      ["B01", "Cty Test", "", "A", "123", "bad-email", "Sản xuất", "Hà Nội", "NV-ERP", "Nhu cầu", "80 triệu", "", "99/99/2026"]
    ], state.config.schema);
    const badVal = validator.validateDataset(badDS, state.config.schema);
    cases.push({
      name: "Kịch bản 4 (Ràng buộc dữ liệu sai): Từ chối thực thi khi sai SĐT, Email, Ngân sách chữ, Ngày, Thiếu kênh",
      passed: badVal.valid === false && badVal.errors.length >= 4,
      detail: `valid=${badVal.valid}, Số lỗi phát hiện=${badVal.errors.length}`
    });

    outBox.innerHTML = cases.map(cs => `
      <div class="action-card ${cs.passed ? "" : "card-red"} mt-1">
        <div class="flex-between">
          <strong>${escapeHtml(cs.name)}</strong>
          <span class="pill ${cs.passed ? "pill-green" : "pill-red"}">${cs.passed ? "PASS" : "FAIL"}</span>
        </div>
        <div class="hint mt-1">${escapeHtml(cs.detail)}</div>
      </div>
    `).join("");
  }

  document.addEventListener("DOMContentLoaded", init);
})();

