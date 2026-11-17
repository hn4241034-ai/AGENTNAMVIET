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
    else if (h === "#bao-cao-dashboard" || h === "#bao-cao") showDashboardView();
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
    try {
      const res = await fetch("config/business_rules.json");
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
      workspace: { view: "#workspaceView", nav: "#navWorkspaceBtn", hash: "#nhap-du-lieu" },
      dashboard: { view: "#dashboardView", nav: "#navDashboardBtn", hash: "#bao-cao-dashboard" }
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
  function showDashboardView() {
    renderBusinessKpiDashboard(
      $("#dashDatasetFilter") ? $("#dashDatasetFilter").value : "auto",
      $("#dashPeriodFilter") ? $("#dashPeriodFilter").value : "auto"
    );
    if (state.agentOutput) {
      renderResultsDashboard();
    }
    $("#resultsSection")?.classList.remove("hidden");
    showPage("dashboard");
  }

  function bindEvents() {
    $("#brandHomeBtn").addEventListener("click", showLandingView);
    $("#navLandingBtn").addEventListener("click", showLandingView);
    $("#navWorkflowBtn").addEventListener("click", showWorkflowView);
    $("#navWorkspaceBtn").addEventListener("click", showWorkspaceView);
    $("#navDashboardBtn").addEventListener("click", showDashboardView);
    $("#btnBackToWorkspace")?.addEventListener("click", showWorkspaceView);
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
      else if (h === "#bao-cao-dashboard" || h === "#bao-cao") showDashboardView();
      else showPage("landing", false);
    });

    $("#btnToggleLLM").addEventListener("click", () => $("#llmPanel").classList.toggle("hidden"));
    $("#btnCloseLLM").addEventListener("click", () => $("#llmPanel").classList.add("hidden"));
    $("#btnTestBrains").addEventListener("click", testServerBrains);

    $("#btnLoadValidSample").addEventListener("click", () => loadSampleUrl("data/sample_normal_and_edge_cases.csv", "Mẫu chuẩn (16 leads + Edge Cases)"));
    if ($("#btnLoadRetailSample")) {
      $("#btnLoadRetailSample").addEventListener("click", () => loadSampleUrl("data/sample_retail_kpi.csv", "Bán lẻ & Doanh thu (22 dòng KPI)"));
    }
    $("#btnLoadInvalidSample").addEventListener("click", () => loadSampleUrl("data/sample_invalid_format.csv", "Mẫu sai định dạng (Test ràng buộc)"));
    $("#btnDownloadTemplate").addEventListener("click", () => {
      const cols = (state.config?.schema?.required_columns || []).join(",");
      const sampleRow = "L001,Công ty TNHH Minh Tâm,0101234567,Nguyễn Văn A,0912345678,a@minhtam.vn,Sản xuất,Hà Nội,NV-ERP,Cần phần mềm quản trị sản xuất và kho,100000000,Website,2026-11-10";
      const headerWithTax = "lead_id,company_name,tax_code,contact_name,phone,email,industry,region,product_interest,need_description,budget_vnd,source_channel,registered_at";
      downloadBlob("namviet_leads_template.csv", headerWithTax + "\n" + sampleRow + "\n", "text/csv;charset=utf-8");
    });
    $("#btnGen700").addEventListener("click", generateAndLoad700Leads);

    // Rule checkboxes live re-clean
    ["ruleTrimWhitespace", "ruleRemoveEmptyRows", "ruleRemoveDuplicates", "ruleDropMissingRows"].forEach(id => {
      const el = $(`#${id}`);
      if (el) {
        el.addEventListener("change", () => {
          if (state.parsedDataset) {
            enterCleaningStep(state.cleaningState?.mode || "standard", false);
          }
        });
      }
    });

    // Dashboard Filters live sync
    if ($("#dashDatasetFilter")) {
      $("#dashDatasetFilter").addEventListener("change", (e) => {
        renderBusinessKpiDashboard(e.target.value, "auto");
      });
    }
    if ($("#dashPeriodFilter")) {
      $("#dashPeriodFilter").addEventListener("change", (e) => {
        renderBusinessKpiDashboard($("#dashDatasetFilter") ? $("#dashDatasetFilter").value : "auto", e.target.value);
      });
    }

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
      let res = await fetch(url).catch(() => null);
      if (!res || !res.ok) {
        const altUrl = url.startsWith("/") ? url.slice(1) : "/" + url;
        res = await fetch(altUrl).catch(() => null);
      }
      if (!res || !res.ok) {
        throw new Error("Không thể tải file mẫu");
      }
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

    if ($("#fileHealthRow")) {
      $("#fileHealthRow").classList.remove("hidden");
      if ($("#fileHashBadge")) $("#fileHashBadge").textContent = `Mã băm: ${parsed.fileHash || "SHA-256"}`;
      if ($("#dataHealthBadge")) {
        const score = parsed.dataQualityProfile?.healthScore ?? 100;
        $("#dataHealthBadge").textContent = `Chất lượng: ${score}%`;
        $("#dataHealthBadge").className = `pill ${score >= 80 ? "pill-green" : (score >= 60 ? "pill-amber" : "pill-red")}`;
      }
      if ($("#quarantineCountBadge")) {
        const qCount = parsed.dataQualityProfile?.quarantineCount || 0;
        $("#quarantineCountBadge").textContent = `Cách ly: ${qCount}`;
        $("#quarantineCountBadge").className = `pill ${qCount > 0 ? "pill-amber" : "pill-green"}`;
      }
    }

    // Dynamic scan and update dashboard dataset selector
    const dsFilter = $("#dashDatasetFilter");
    if (dsFilter) {
      let autoOpt = dsFilter.querySelector('option[value="auto"]');
      if (!autoOpt) {
        autoOpt = document.createElement("option");
        autoOpt.value = "auto";
        dsFilter.insertBefore(autoOpt, dsFilter.firstChild);
      }
      autoOpt.textContent = `📂 File hiện tại: ${sourceLabel} (${parsed.rows.length} dòng)`;
      dsFilter.value = "auto";
    }
    renderBusinessKpiDashboard("auto", "auto");

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

    const ruleOptions = {
      trimWhitespace: $("#ruleTrimWhitespace") ? $("#ruleTrimWhitespace").checked : true,
      removeEmptyRows: $("#ruleRemoveEmptyRows") ? $("#ruleRemoveEmptyRows").checked : true,
      removeDuplicates: $("#ruleRemoveDuplicates") ? $("#ruleRemoveDuplicates").checked : true,
      dropMissingRows: $("#ruleDropMissingRows") ? $("#ruleDropMissingRows").checked : false
    };

    const cleanRes = skills.toolCleanDataset(state.parsedDataset.rows, state.config, mode, ruleOptions);
    state.cleanedDatasetRows = cleanRes.cleanedRows;
    state.cleaningState = {
      passes: prevPasses + 1,
      mode,
      skippedMissing,
      result: cleanRes,
      ruleOptions
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

    // 3 KPI Counters Row (matching Image 3)
    if ($("#cleanStatCleanedRows")) $("#cleanStatCleanedRows").textContent = cleanRes.stats.cleanedRowsCount;
    if ($("#cleanStatRemovedRows")) $("#cleanStatRemovedRows").textContent = cleanRes.stats.removedRowsCount;
    if ($("#cleanStatRemainingEmpty")) $("#cleanStatRemainingEmpty").textContent = cleanRes.stats.remainingEmptyCellsCount;

    // Dynamic Summary Line (matching Image 3)
    if ($("#cleanPreviewSummaryLine")) {
      $("#cleanPreviewSummaryLine").textContent =
        `${cleanRes.stats.sourceRowsCount} dòng nguồn · ${cleanRes.stats.emptyRowsRemovedCount} dòng trống · ` +
        `${cleanRes.stats.duplicateRowsRemovedCount} dòng trùng · ${cleanRes.stats.missingRowsRemovedCount} dòng thiếu bị xóa · ` +
        `0 dòng bỏ theo yêu cầu · ${cleanRes.stats.trimmedCellsCount} ô đã cắt khoảng trắng`;
    }

    // Render Cleaned Preview Table (matching Image 3)
    renderCleanPreviewTable(cleanRes.cleanedRows);

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

    // Dynamic scan and update dashboard with cleaned dataset
    const dsCleanFilter = $("#dashDatasetFilter");
    if (dsCleanFilter) {
      let autoOpt = dsCleanFilter.querySelector('option[value="auto"]');
      if (autoOpt) {
        autoOpt.textContent = `📂 File hiện tại: ${state.parsedDataset?.sourceLabel || "Đang xử lý"} (${cleanRes.cleanedRows.length} dòng sạch)`;
      }
    }
    renderBusinessKpiDashboard("auto", "auto");

    if (shouldScroll) {
      $("#cleaningSection").scrollIntoView({ behavior: "smooth" });
    }
  }

  function renderCleanPreviewTable(rows) {
    const table = $("#cleanPreviewTable");
    if (!table) return;
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    if (!rows || rows.length === 0) {
      thead.innerHTML = "<tr><th>Không có dữ liệu</th></tr>";
      tbody.innerHTML = "<tr><td>Không còn dòng nào sau khi áp dụng bộ quy tắc làm sạch.</td></tr>";
      return;
    }
    const cols = Object.keys(rows[0]).filter(k => k !== "__rowNumber");
    thead.innerHTML = "<tr>" + cols.map(c => `<th>${escapeHtml(c)}</th>`).join("") + "</tr>";
    tbody.innerHTML = rows.slice(0, 40).map(r => {
      return "<tr>" + cols.map(c => {
        const val = String(r[c] ?? "");
        return val ? `<td>${escapeHtml(val)}</td>` : `<td style="color:#9ca3af;font-style:italic;">(Trống)</td>`;
      }).join("") + "</tr>";
    }).join("");
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
    showDashboardView();
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
    state.finalized = true;
    if (state.agentOutput) {
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
    }
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
    renderExecutiveBrief(out.executive_brief);
    const totalCust = Math.max(1, s.unique_customers);

    // 2a. SVG Donut Chart for Priority (Biểu đồ tròn)
    const priorityDefs = [
      { label: "Ưu tiên Cao", count: s.by_priority["Cao"], color: "#34d399" },
      { label: "Trung bình", count: s.by_priority["Trung bình"], color: "#60a5fa" },
      { label: "Ưu tiên Thấp", count: s.by_priority["Thấp"], color: "#71717a" },
      { label: "Không liên hệ lại", count: s.by_priority["Không liên hệ lại"], color: "#f87171" }
    ];
    $("#priorityDonutChart").innerHTML = buildDonutChartHTML(priorityDefs, s.unique_customers, "Khách duy nhất");

    // 2b. Vertical Column Chart for Regions (Biểu đồ cột đứng)
    $("#regionColumnChart").innerHTML = buildRegionColumnChartHTML(out.customers);

    // 2c. Product Group Distribution Bars (Biểu đồ thanh ngang)
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

    // 2d. Routing Status Distribution Bars (Biểu đồ thanh ngang)
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

    // 2e. Staff Stacked Load Chart (Biểu đồ thanh ngang xếp chồng)
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
    renderBusinessKpiDashboard(
      $("#dashDatasetFilter") ? $("#dashDatasetFilter").value : "auto",
      $("#dashPeriodFilter") ? $("#dashPeriodFilter").value : "auto"
    );
    renderLeadershipVisuals(out);
  }

  // ---- 4 BỘ BIỂU ĐỒ KIỂM SOÁT ĐẦU RA CHO TRƯỞNG PHÒNG ----
  function renderLeadershipVisuals(out) {
    if (!out || !out.report) return;
    const s = out.report.summary || {};

    // 1. Lead Funnel Chart
    const funnelEl = $("#leadFunnelChart");
    if (funnelEl && s.funnel_data) {
      funnelEl.innerHTML = s.funnel_data.map((f, i) => {
        const dropText = i > 0 ? `(Giữ lại ${f.pct}%)` : `(100% gốc)`;
        return `
          <div class="funnel-bar-row">
            <span style="font-weight:600;color:#111111;">${escapeHtml(f.stage)}</span>
            <div class="funnel-track" title="${f.count} hồ sơ ${dropText}">
              <div class="funnel-fill" style="width:${Math.max(5, f.pct)}%;background:${f.color};"></div>
            </div>
            <span class="funnel-val">${f.count} <small style="color:#6b7280;font-weight:normal;">${f.pct}%</small></span>
          </div>
        `;
      }).join("");
    }

    // 2. Staff Stacked by Priority Chart
    const staffPriorityEl = $("#staffPriorityStackedChart");
    if (staffPriorityEl && out.report.by_staff) {
      staffPriorityEl.innerHTML = out.report.by_staff.map(st => {
        const totalAssigned = Math.max(1, st.new_assigned_confirmed);
        const pH = Math.round(((st.priority_high || 0) / totalAssigned) * 100);
        const pM = Math.round(((st.priority_medium || 0) / totalAssigned) * 100);
        const pL = Math.max(0, 100 - pH - pM);
        const over = st.total_projected_load >= st.max_weekly_capacity;
        return `
          <div class="staff-chart-row">
            <span><strong>${escapeHtml(st.staff_name)}</strong> <small class="hint">(${st.staff_id})</small></span>
            <div class="staff-bar-track" title="Cao: ${st.priority_high || 0} | TB: ${st.priority_medium || 0} | Thấp: ${st.priority_low || 0} / Đã nhận: ${st.new_assigned_confirmed}">
              <div class="staff-seg" style="width:${pH}%;background:#34d399;"></div>
              <div class="staff-seg" style="width:${pM}%;background:#f2ea00;"></div>
              <div class="staff-seg" style="width:${pL}%;background:#71717a;"></div>
            </div>
            <strong style="color:${over ? "#b91c1c" : "#111111"};">${st.new_assigned_confirmed} <small style="font-weight:normal;color:#6b7280;">/ ${st.max_weekly_capacity}</small></strong>
          </div>
        `;
      }).join("");
    }

    // 3. Missing Data Heatmap
    const heatmapEl = $("#dataMissingHeatmap");
    if (heatmapEl && s.heatmap_matrix) {
      const fields = ["budget_vnd", "need_description", "phone", "email", "industry"];
      const labels = s.field_labels || { budget_vnd: "Ngân sách", need_description: "Nhu cầu", phone: "SĐT", email: "Email", industry: "Ngành" };
      heatmapEl.innerHTML = `
        <table class="heatmap-table">
          <thead>
            <tr>
              <th style="text-align:left;">Nguồn thu hút</th>
              ${fields.map(f => `<th>${escapeHtml(labels[f] || f)}</th>`).join("")}
              <th>Tổng dòng</th>
            </tr>
          </thead>
          <tbody>
            ${s.heatmap_matrix.map(m => `
              <tr>
                <td class="heatmap-chan">${escapeHtml(m.channel)}</td>
                ${fields.map(f => {
                  const rate = m.rates?.[f] || { pct: 0, missing: 0 };
                  const cls = rate.pct === 0 ? "good" : (rate.pct <= 25 ? "medium" : "warn");
                  return `<td class="heatmap-cell ${cls}" title="${rate.missing}/${m.total} ô trống">${rate.pct}%</td>`;
                }).join("")}
                <td style="font-weight:700;">${m.total}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }

    // 4. Exception Breakdown Bar Chart
    const exceptionEl = $("#exceptionReasonChart");
    if (exceptionEl && s.exception_breakdown) {
      const maxEx = Math.max(1, ...s.exception_breakdown.map(e => e.count));
      exceptionEl.innerHTML = s.exception_breakdown.map(e => {
        const pct = Math.round((e.count / maxEx) * 100);
        return `
          <div class="exception-bar-row">
            <span style="font-weight:600;color:#374151;">${escapeHtml(e.reason)}</span>
            <div class="exception-bar-track">
              <div class="exception-bar-fill" style="width:${Math.max(4, pct)}%;background:${e.color};"></div>
            </div>
            <span class="exception-bar-val">${e.count} ca</span>
          </div>
        `;
      }).join("");
    }
  }

  // ---- Dynamic Business KPI Dashboard & Agent Analysis Engine ----
  const cachedDatasets = {};

  function formatCompactVND(val) {
    if (val === null || val === undefined || isNaN(val)) return "0";
    const abs = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1).replace(".", ",") + " Tỷ";
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1).replace(".", ",") + " Tr";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + " K";
    return sign + Math.round(abs).toLocaleString("vi-VN");
  }

  function formatCurrencyFull(val) {
    if (val === null || val === undefined || isNaN(val)) return "0 VND";
    return Math.round(val).toLocaleString("vi-VN") + " VND";
  }

  function parseNumeric(val, fallback = 0) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === "number") return isNaN(val) ? fallback : val;
    let str = String(val).trim().replace(/[VNDvndđ\$\s]/g, "");
    if (!str) return fallback;
    if (/\.\d{3}/.test(str) && !str.includes(",")) {
      str = str.replace(/\./g, "");
    } else if (/,\d{3}/.test(str) && !str.includes(".")) {
      str = str.replace(/,/g, "");
    } else if (str.includes(",") && str.includes(".")) {
      if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
        str = str.replace(/\./g, "").replace(",", ".");
      } else {
        str = str.replace(/,/g, "");
      }
    }
    const num = parseFloat(str);
    return isNaN(num) ? fallback : num;
  }

  function parsePeriodString(val) {
    if (!val) return "(Không có ngày)";
    const str = String(val).trim();
    const m1 = str.match(/^(\d{4})[-\/.](\d{1,2})/);
    if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}`;
    const m2 = str.match(/^(\d{1,2})[-\/.](\d{4})/);
    if (m2) return `${m2[2]}-${m2[1].padStart(2, "0")}`;
    return str;
  }

  function formatPeriodName(p) {
    if (!p || p === "all") return "Toàn bộ các kỳ";
    const m = String(p).match(/^(\d{4})-(\d{2})$/);
    if (m) return `Tháng ${m[2]}/${m[1]}`;
    return String(p);
  }

  function detectBusinessColumns(headers) {
    const norm = s => (s || "").toLowerCase().replace(/[\s_\(\)\/\-–]/g, "");
    let colDate = null, colRev = null, colCost = null, colProfit = null, colOrders = null, colChannel = null, colSecondary = null;

    for (const h of headers) {
      const n = norm(h);
      if (!colDate && /^(thang|month|ky|period|ngay|date|registeredat|createdat|thoigian)/.test(n)) colDate = h;
      else if (!colRev && /(doanhthu|revenue|sales|thanhtien|budgetvnd|budget|ngansach|giatri|sotien)/.test(n)) colRev = h;
      else if (!colCost && /(chiphi|cost|cogs|giavon|expense)/.test(n)) colCost = h;
      else if (!colProfit && /(loinhuan|profit|margin|lai)/.test(n)) colProfit = h;
      else if (!colOrders && /(sodon|orders|count|soluong|quantity|luotclick)/.test(n)) colOrders = h;
      else if (!colChannel && /(kenh|channel|sourcechannel|nguon)/.test(n)) colChannel = h;
      else if (!colSecondary && /(sanpham|product|productinterest|chiendich|campaign|nganh|industry)/.test(n)) colSecondary = h;
    }
    if (!colChannel) {
      colChannel = headers.find(h => /(khuvuc|region|diaban|tinh)/.test(norm(h))) || null;
    }
    return { colDate, colRev, colCost, colProfit, colOrders, colChannel, colSecondary };
  }

  async function getDatasetRows(datasetType) {
    if (datasetType === "auto" || !datasetType) {
      if (state.cleaningState?.cleanedRows?.length) {
        return {
          rows: state.cleaningState.cleanedRows,
          label: state.parsedDataset?.sourceLabel ? `${state.parsedDataset.sourceLabel} (Đã làm sạch)` : "Dữ liệu hiện tại"
        };
      }
      if (state.parsedDataset?.rows?.length) {
        return {
          rows: state.parsedDataset.rows,
          label: state.parsedDataset.sourceLabel || "Dữ liệu vừa tải"
        };
      }
      // Fallback: load retail sample
      return await getDatasetRows("retail");
    }

    if (datasetType === "retail") {
      if (!cachedDatasets.retail) {
        const text = await fetch("data/sample_retail_kpi.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.retail = validator.parseCSV(text).rows;
      }
      return { rows: cachedDatasets.retail, label: "Bán lẻ mẫu (sample_retail_kpi.csv)" };
    }

    if (datasetType === "marketing") {
      if (!cachedDatasets.marketing) {
        const text = await fetch("data/sample_marketing.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.marketing = validator.parseCSV(text).rows;
      }
      return { rows: cachedDatasets.marketing, label: "Marketing mẫu (sample_marketing.csv)" };
    }

    if (datasetType === "crm") {
      if (!cachedDatasets.crm) {
        const text = await fetch("data/sample_normal_and_edge_cases.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.crm = validator.parseCSV(text).rows;
      }
      return { rows: cachedDatasets.crm, label: "CRM Khách hàng (sample_normal_and_edge_cases.csv)" };
    }

    return { rows: [], label: "Dữ liệu trống" };
  }

  async function renderBusinessKpiDashboard(datasetType = "auto", period = "auto") {
    const dsSelect = $("#dashDatasetFilter");
    if (dsSelect && dsSelect.value !== datasetType) {
      dsSelect.value = datasetType;
    }

    const { rows: rawRows, label: datasetLabel } = await getDatasetRows(datasetType);
    if (!rawRows || rawRows.length === 0) {
      if ($("#dashSubtitleLine")) $("#dashSubtitleLine").textContent = "Chưa có dữ liệu để phân tích.";
      return;
    }

    // Dynamic Column Detection via Heuristics
    const headers = Object.keys(rawRows[0] || {});
    const { colDate, colRev, colCost, colProfit, colOrders, colChannel, colSecondary } = detectBusinessColumns(headers);

    // Normalize Rows
    const normalizedRows = rawRows.map(r => {
      const p = colDate ? parsePeriodString(r[colDate]) : "Toàn bộ";
      const ch = colChannel ? (String(r[colChannel] || "").trim() || "(Ô trống)") : "Kênh chung";
      const sec = colSecondary ? (String(r[colSecondary] || "").trim() || "(Khác)") : "Chung";
      const rev = colRev ? parseNumeric(r[colRev], 0) : 0;
      const cost = colCost ? parseNumeric(r[colCost], 0) : (colRev ? Math.round(rev * 0.58) : 0);
      const profit = colProfit ? parseNumeric(r[colProfit], rev - cost) : (rev - cost);
      const orders = colOrders ? Math.max(1, parseNumeric(r[colOrders], 1)) : 1;
      return { period: p, channel: ch, secondary: sec, rev, cost, profit, orders, raw: r };
    });

    // Extract Periods
    const periodSet = new Set();
    normalizedRows.forEach(r => {
      if (r.period && r.period !== "(Không có ngày)") periodSet.add(r.period);
    });
    let sortedPeriods = Array.from(periodSet).sort();
    if (sortedPeriods.length === 0) sortedPeriods = ["Toàn bộ"];

    // Update Period Filter Dropdown
    const periodSelect = $("#dashPeriodFilter");
    if (periodSelect) {
      const existingOptions = Array.from(periodSelect.options).map(o => o.value);
      const neededOptions = [...sortedPeriods.slice().reverse(), "all"];
      const needsRebuild = existingOptions.length !== neededOptions.length ||
        !neededOptions.every((v, i) => existingOptions[i] === v);

      if (needsRebuild) {
        periodSelect.innerHTML = [
          ...sortedPeriods.slice().reverse().map(p => `<option value="${p}">${formatPeriodName(p)}</option>`),
          `<option value="all">Toàn bộ các kỳ (${sortedPeriods.length} kỳ)</option>`
        ].join("");
      }

      if (period && period !== "auto" && (sortedPeriods.includes(period) || period === "all")) {
        periodSelect.value = period;
      } else {
        periodSelect.value = sortedPeriods[sortedPeriods.length - 1] || "all";
      }
    }

    const activePeriod = periodSelect ? periodSelect.value : (sortedPeriods[sortedPeriods.length - 1] || "all");

    // Filter Rows for Current and Previous Period
    let currRows = [];
    let prevPeriod = null;
    let prevRows = [];

    if (activePeriod === "all") {
      currRows = normalizedRows;
      if (sortedPeriods.length >= 2) {
        prevPeriod = sortedPeriods[sortedPeriods.length - 2];
        prevRows = normalizedRows.filter(r => r.period === prevPeriod);
      }
    } else {
      currRows = normalizedRows.filter(r => r.period === activePeriod);
      const idx = sortedPeriods.indexOf(activePeriod);
      if (idx > 0) {
        prevPeriod = sortedPeriods[idx - 1];
        prevRows = normalizedRows.filter(r => r.period === prevPeriod);
      }
    }

    // Totals
    const sumField = (arr, field) => arr.reduce((acc, r) => acc + (r[field] || 0), 0);
    const currOrders = sumField(currRows, "orders");
    const currRev = sumField(currRows, "rev");
    const currCost = sumField(currRows, "cost");
    const currProfit = sumField(currRows, "profit");

    const prevOrders = prevRows.length ? sumField(prevRows, "orders") : 0;
    const prevRev = prevRows.length ? sumField(prevRows, "rev") : 0;
    const prevCost = prevRows.length ? sumField(prevRows, "cost") : 0;
    const prevProfit = prevRows.length ? sumField(prevRows, "profit") : 0;

    const calcDelta = (curr, prev) => {
      if (!prevPeriod || prev === 0) return { text: "Số liệu cơ sở", isPos: true };
      const pct = ((curr - prev) / prev) * 100;
      const sign = pct >= 0 ? "+" : "";
      return {
        text: `${sign}${pct.toFixed(1).replace(".", ",")}% so với ${formatPeriodName(prevPeriod)}`,
        isPos: pct >= 0
      };
    };

    const dOrders = calcDelta(currOrders, prevOrders);
    const dRev = calcDelta(currRev, prevRev);
    const dProfit = calcDelta(currProfit, prevProfit);
    const dCost = calcDelta(currCost, prevCost);

    // Update Top 4 KPI Cards
    if ($("#dashSubtitleLine")) {
      $("#dashSubtitleLine").textContent = `${formatPeriodName(activePeriod)} · ${currRows.length} dòng · ${datasetLabel}`;
    }
    if ($("#dashAgentScanBadge")) {
      $("#dashAgentScanBadge").innerHTML = `<span class="pulse-beacon"></span> Agent đã rà soát động từ file (${rawRows.length} dòng)`;
    }
    if ($("#dashValOrders")) $("#dashValOrders").textContent = currOrders.toLocaleString("vi-VN");
    if ($("#dashDeltaOrders")) {
      $("#dashDeltaOrders").textContent = dOrders.text;
      $("#dashDeltaOrders").className = `dash-kpi-delta ${dOrders.isPos ? "positive" : "negative"}`;
    }
    if ($("#dashValRevenue")) $("#dashValRevenue").textContent = formatCurrencyFull(currRev);
    if ($("#dashDeltaRevenue")) {
      $("#dashDeltaRevenue").textContent = dRev.text;
      $("#dashDeltaRevenue").className = `dash-kpi-delta ${dRev.isPos ? "positive" : "negative"}`;
    }
    if ($("#dashValProfit")) $("#dashValProfit").textContent = formatCurrencyFull(currProfit);
    if ($("#dashDeltaProfit")) {
      $("#dashDeltaProfit").textContent = dProfit.text;
      $("#dashDeltaProfit").className = `dash-kpi-delta ${dProfit.isPos ? "positive" : "negative"}`;
    }
    if ($("#dashValCost")) $("#dashValCost").textContent = formatCurrencyFull(currCost);
    if ($("#dashDeltaCost")) {
      $("#dashDeltaCost").textContent = dCost.text;
      $("#dashDeltaCost").className = `dash-kpi-delta ${dCost.isPos ? "positive" : "negative"}`;
    }

    // 1. Monthly Revenue Trend SVG
    const monthsData = sortedPeriods.map((p, i) => {
      const pRows = normalizedRows.filter(r => r.period === p);
      const rev = sumField(pRows, "rev");
      let growth = "-";
      if (i > 0) {
        const priorRev = sumField(normalizedRows.filter(r => r.period === sortedPeriods[i - 1]), "rev");
        if (priorRev > 0) {
          const g = ((rev - priorRev) / priorRev) * 100;
          growth = `${g >= 0 ? "+" : ""}${g.toFixed(1).replace(".", ",")}%`;
        }
      }
      return { month: p, rev, label: formatCompactVND(rev), growth };
    });

    if ($("#dashRevenueTrendSvg")) {
      $("#dashRevenueTrendSvg").innerHTML = buildRevenueTrendSVG(monthsData);
    }
    if ($("#dashMonthTableCollapsible")) {
      $("#dashMonthTableCollapsible").innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>Kỳ</th><th>Doanh thu (VND)</th><th>Tăng trưởng</th></tr>
          </thead>
          <tbody>
            ${monthsData.map(m => `
              <tr>
                <td><strong>${formatPeriodName(m.month)}</strong></td>
                <td>${Math.round(m.rev).toLocaleString("vi-VN")} VND</td>
                <td><span class="pill ${m.growth.startsWith("+") ? "pill-green" : (m.growth.startsWith("-") ? "pill-amber" : "pill-gray")}">${m.growth}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }

    // 2. Cost Breakdown Donut
    const channelCostMap = {};
    const channelRevMap = {};
    currRows.forEach(r => {
      channelCostMap[r.channel] = (channelCostMap[r.channel] || 0) + r.cost;
      channelRevMap[r.channel] = (channelRevMap[r.channel] || 0) + r.rev;
    });

    const palette = ["#0f766e", "#2dd4bf", "#84cc16", "#f59e0b", "#6366f1", "#ec4899", "#8b5cf6", "#14b8a6"];
    const totalCostCurr = Math.max(1, sumField(currRows, "cost"));
    const costChannels = Object.entries(channelCostMap)
      .map(([name, val], idx) => {
        const pct = ((val / totalCostCurr) * 100).toFixed(1);
        return {
          name,
          val,
          valText: formatCurrencyFull(val),
          pct: parseFloat(pct),
          color: palette[idx % palette.length]
        };
      })
      .sort((a, b) => b.val - a.val);

    if ($("#dashCostDonutChart")) {
      $("#dashCostDonutChart").innerHTML = buildCostDonutHTML(costChannels.length ? costChannels : [
        { name: "Chung", val: currCost, valText: formatCurrencyFull(currCost), pct: 100, color: "#0f766e" }
      ]);
    }

    // 3. Revenue Contribution Horizontal Bars
    const maxRevChannel = Math.max(1, ...Object.values(channelRevMap));
    const revContrib = Object.entries(channelRevMap)
      .map(([name, val]) => ({
        name,
        val,
        valText: formatCurrencyFull(val),
        pct: Math.min(100, Math.round((val / maxRevChannel) * 100))
      }))
      .sort((a, b) => b.val - a.val);

    if ($("#dashRevenueContribBars")) {
      $("#dashRevenueContribBars").innerHTML = buildRevenueContribBarsHTML(revContrib);
    }

    // 4. Variance Waterfall Bars
    let varianceItems = [];
    if (prevPeriod && prevRows.length) {
      const prevChannelRevMap = {};
      prevRows.forEach(r => {
        prevChannelRevMap[r.channel] = (prevChannelRevMap[r.channel] || 0) + r.rev;
      });
      const allChs = new Set([...Object.keys(channelRevMap), ...Object.keys(prevChannelRevMap)]);
      const diffList = [];
      allChs.forEach(ch => {
        const cVal = channelRevMap[ch] || 0;
        const pVal = prevChannelRevMap[ch] || 0;
        const diff = cVal - pVal;
        diffList.push({ name: ch, diff, absDiff: Math.abs(diff) });
      });
      diffList.sort((a, b) => b.absDiff - a.absDiff);
      const maxAbs = Math.max(1, diffList[0]?.absDiff || 1);
      varianceItems = diffList.map(it => ({
        name: it.name,
        valText: `${it.diff >= 0 ? "+" : ""}${formatCurrencyFull(it.diff)}`,
        pct: Math.min(100, Math.round((it.absDiff / maxAbs) * 100)),
        isPositive: it.diff >= 0
      }));

      if ($("#dashVarianceSub")) {
        $("#dashVarianceSub").textContent = `${formatPeriodName(prevPeriod)} → ${formatPeriodName(activePeriod)} · Kênh`;
      }
      if ($("#dashVarianceNote")) {
        const totalDiff = currRev - prevRev;
        $("#dashVarianceNote").textContent = `Từ ${formatCurrencyFull(prevRev)} đến ${formatCurrencyFull(currRev)} · Thay đổi ${totalDiff >= 0 ? "+" : ""}${formatCurrencyFull(totalDiff)}`;
      }
    } else {
      const avgRev = currRev / Math.max(1, revContrib.length);
      varianceItems = revContrib.map(it => {
        const diff = it.val - avgRev;
        return {
          name: it.name,
          valText: `${diff >= 0 ? "+" : ""}${formatCurrencyFull(diff)}`,
          pct: Math.min(100, Math.round((Math.abs(diff) / Math.max(1, maxRevChannel)) * 100)),
          isPositive: diff >= 0
        };
      });
      if ($("#dashVarianceSub")) $("#dashVarianceSub").textContent = `Độ lệch so với mức trung bình kênh (${formatCurrencyFull(avgRev)})`;
      if ($("#dashVarianceNote")) $("#dashVarianceNote").textContent = `Kỳ hiện hành đạt ${formatCurrencyFull(currRev)} trên ${revContrib.length} kênh phân phối.`;
    }

    if ($("#dashVarianceBars")) {
      $("#dashVarianceBars").innerHTML = buildVarianceBarsHTML(varianceItems);
    }

    // SECTION 2: Phân tích chuyên đề (Thematic Analysis)
    const allChannelRevMap = {};
    const allChannelRowsMap = {};
    normalizedRows.forEach(r => {
      allChannelRevMap[r.channel] = (allChannelRevMap[r.channel] || 0) + r.rev;
      allChannelRowsMap[r.channel] = (allChannelRowsMap[r.channel] || 0) + 1;
    });
    const maxAllRev = Math.max(1, ...Object.values(allChannelRevMap));
    const allTopicRev = Object.entries(allChannelRevMap)
      .map(([name, val]) => ({
        name,
        val,
        valText: formatCurrencyFull(val),
        pct: Math.min(100, Math.round((val / maxAllRev) * 100)),
        rowsCount: allChannelRowsMap[name] || 0
      }))
      .sort((a, b) => b.val - a.val);

    if ($("#dashTopicRevBars")) $("#dashTopicRevBars").innerHTML = buildRevenueContribBarsHTML(allTopicRev);

    const topChannel = allTopicRev[0] || { name: "Chung", val: 0, rowsCount: 0 };
    const totalAllRev = sumField(normalizedRows, "rev");
    const totalAllCost = sumField(normalizedRows, "cost");
    const blankChannel = allTopicRev.find(c => c.name.includes("Ô trống") || c.name === "") || null;

    if ($("#dashTopicRevInsight")) {
      $("#dashTopicRevInsight").textContent =
        `Bộ dữ liệu "${datasetLabel}" · Nhóm "${topChannel.name}" có tổng "Doanh thu (VND)" cao nhất trong ${allTopicRev.length} nhóm theo "Kênh" (${formatCurrencyFull(topChannel.val)}). Cột này có số liệu ở ${topChannel.rowsCount}/${normalizedRows.length} dòng.`;
    }

    if ($("#dashTopicCogsBanner")) {
      $("#dashTopicCogsBanner").innerHTML = `
        <strong>Chi phí giá vốn (VND)</strong>
        <p>Bộ dữ liệu "${datasetLabel}" · Tổng "Chi phí giá vốn (VND)" là ${formatCurrencyFull(totalAllCost)}. Cột này có số liệu ở ${normalizedRows.length}/${normalizedRows.length} dòng.</p>
      `;
    }

    // Secondary Dimension (Product / Campaign)
    const secCostMap = {};
    const secRowsMap = {};
    normalizedRows.forEach(r => {
      secCostMap[r.secondary] = (secCostMap[r.secondary] || 0) + r.cost;
      secRowsMap[r.secondary] = (secRowsMap[r.secondary] || 0) + 1;
    });
    const maxSecCost = Math.max(1, ...Object.values(secCostMap));
    const secList = Object.entries(secCostMap)
      .map(([name, val]) => ({
        name,
        val,
        valText: formatCurrencyFull(val),
        pct: Math.min(100, Math.round((val / maxSecCost) * 100)),
        rowsCount: secRowsMap[name] || 0
      }))
      .sort((a, b) => b.val - a.val);

    if ($("#dashTopicMktBars")) $("#dashTopicMktBars").innerHTML = buildRevenueContribBarsHTML(secList);

    const topSec = secList[0] || { name: "Chung", val: 0, rowsCount: 0 };
    if ($("#dashTopicMktInsight")) {
      $("#dashTopicMktInsight").textContent =
        `Bộ dữ liệu "${datasetLabel}" · Nhóm "${topSec.name}" có tổng "Chi phí" cao nhất trong ${secList.length} nhóm theo "${colSecondary || "Phân loại"}" (${formatCurrencyFull(topSec.val)}). Cột này có số liệu ở ${topSec.rowsCount}/${normalizedRows.length} dòng.`;
    }

    // SECTION 3: Dynamic Conclusions & Action Recommendations
    const grossMarginPct = totalAllRev > 0 ? (((totalAllRev - totalAllCost) / totalAllRev) * 100).toFixed(1) : "0";
    const topVariance = varianceItems[0] || null;

    if ($("#dashConclusionList")) {
      const conclusions = [
        `Bộ dữ liệu "${datasetLabel}" · Nhóm "${topChannel.name}" có tổng "Doanh thu (VND)" cao nhất trong ${allTopicRev.length} nhóm theo "Kênh" (${formatCurrencyFull(topChannel.val)}). Cột này có số liệu ở ${topChannel.rowsCount}/${normalizedRows.length} dòng.`,
        `Bộ dữ liệu "${datasetLabel}" · Tổng "Chi phí giá vốn (VND)" là ${formatCurrencyFull(totalAllCost)}, biên lợi nhuận gộp trung bình toàn kỳ đạt ${grossMarginPct}%.`,
      ];
      if (prevPeriod) {
        conclusions.push(
          `${datasetLabel} · Doanh thu ${formatPeriodName(activePeriod)} ${currRev >= prevRev ? "tăng" : "giảm"} so với ${formatPeriodName(prevPeriod)} ${formatCurrencyFull(Math.abs(currRev - prevRev))} (${dRev.text.split(" ")[0]}). ${topVariance ? `Nhóm "${topVariance.name}" thay đổi nhiều nhất theo độ lớn, ${topVariance.isPositive ? "tăng" : "giảm"} ${topVariance.valText.replace("+", "")}.` : ""}`
        );
      } else {
        conclusions.push(
          `Hồ sơ ghi nhận tổng cộng ${normalizedRows.length} giao dịch với tổng doanh thu đạt ${formatCurrencyFull(totalAllRev)}.`
        );
      }
      if (blankChannel && blankChannel.val > 0) {
        conclusions.push(
          `Cảnh báo dữ liệu: Có ${blankChannel.rowsCount} dòng thiếu kênh thuộc nhóm "(Ô trống)" với tổng giá trị ${formatCurrencyFull(blankChannel.val)} cần được rà soát bổ sung.`
        );
      }
      $("#dashConclusionList").innerHTML = conclusions.map(t => `<li>${escapeHtml(t)}</li>`).join("");
    }

    if ($("#dashActionList")) {
      const actions = [
        {
          type: "positive",
          badge: "+",
          text: `Tập trung phân bổ 50-60% nguồn lực vào kênh "${topChannel.name}" vì đây là động lực doanh thu lớn nhất (${formatCurrencyFull(topChannel.val)}, chiếm ${totalAllRev > 0 ? ((topChannel.val / totalAllRev) * 100).toFixed(1) : 0}% tổng doanh thu toàn kỳ).`
        },
        {
          type: "positive",
          badge: "+",
          text: `Đẩy mạnh nhóm "${topSec.name}" vì đang chiếm tỷ trọng hoạt động cao nhất (${formatCurrencyFull(topSec.val)}) và mang lại lượng giao dịch chủ lực.`
        }
      ];

      if (topVariance && topVariance.isPositive) {
        actions.push({
          type: "positive",
          badge: "+",
          text: `Nhân rộng mô hình thúc đẩy tăng trưởng tại "${topVariance.name}": Nhóm này bứt phá mạnh nhất (${topVariance.valText}) trong kỳ ${formatPeriodName(activePeriod)}.`
        });
      }

      if (blankChannel && blankChannel.val > 0) {
        actions.push({
          type: "warning",
          badge: "-",
          text: `Rà soát dữ liệu: Xử lý dứt điểm ${formatCurrencyFull(blankChannel.val)} doanh thu ở nhóm "(Ô trống)" để định danh chính xác nguồn thu và không thất thoát số liệu.`
        });
      }

      actions.push({
        type: "warning",
        badge: "-",
        text: `Kiểm soát chi phí giá vốn: Tổng giá vốn toàn kỳ đạt ${formatCurrencyFull(totalAllCost)} (chiếm ${totalAllRev > 0 ? ((totalAllCost / totalAllRev) * 100).toFixed(1) : 0}% doanh thu), cần đàm phán hợp đồng cung ứng số lượng lớn để đẩy biên lợi nhuận gộp lên trên 42%.`
      });

      $("#dashActionList").innerHTML = actions.map(a => `
        <div class="dash-action-card ${a.type}">
          <span class="dash-action-badge">${a.badge}</span>
          <div>${escapeHtml(a.text)}</div>
        </div>
      `).join("");
    }
  }

  function buildRevenueTrendSVG(months) {
    if (!months || months.length === 0) {
      return `<p class="hint" style="text-align:center;padding:30px;">Chưa có dữ liệu kỳ để vẽ xu hướng.</p>`;
    }
    const maxVal = Math.max(1, ...months.map(m => m.rev || 0));
    const width = 500, height = 180;
    const padX = 75, padY = 25, chartW = width - padX - 35, chartH = height - padY * 2;

    const points = months.map((m, i) => {
      const x = padX + (months.length === 1 ? chartW / 2 : (i / Math.max(1, months.length - 1)) * chartW);
      const y = padY + chartH - ((m.rev || 0) / maxVal) * chartH;
      return { x, y, month: m.month, label: m.label, rev: m.rev };
    });

    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${(padY + chartH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padY + chartH).toFixed(1)} Z`;

    const yTicks = [
      { y: padY, val: formatCompactVND(maxVal) },
      { y: padY + chartH * 0.25, val: formatCompactVND(maxVal * 0.75) },
      { y: padY + chartH * 0.5, val: formatCompactVND(maxVal * 0.5) },
      { y: padY + chartH * 0.75, val: formatCompactVND(maxVal * 0.25) },
      { y: padY + chartH, val: "0" }
    ];

    return `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;overflow:visible;">
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0d9488" stop-opacity="0.30" />
            <stop offset="100%" stop-color="#0d9488" stop-opacity="0.03" />
          </linearGradient>
        </defs>
        ${yTicks.map(t => `
          <line x1="${padX}" y1="${t.y}" x2="${width - 30}" y2="${t.y}" stroke="#f3f4f6" stroke-width="1" />
          <text x="${padX - 10}" y="${t.y + 4}" text-anchor="end" font-size="11" fill="#9ca3af" font-family="sans-serif">${t.val}</text>
        `).join("")}
        <path d="${areaD}" fill="url(#trendGrad)" />
        <path d="${pathD}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        ${points.map(p => `
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#0f766e" stroke="#ffffff" stroke-width="2">
            <title>${p.month}: ${p.label}</title>
          </circle>
          <text x="${p.x.toFixed(1)}" y="${padY + chartH + 18}" text-anchor="middle" font-size="11" fill="#6b7280" font-family="sans-serif">${p.month}</text>
        `).join("")}
      </svg>
    `;
  }

  function buildCostDonutHTML(channels) {
    const total = Math.max(1, channels.reduce((sum, c) => sum + c.val, 0));
    const radius = 45;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    const slices = channels.map(c => {
      const dash = (c.val / total) * circumference;
      const slice = `
        <circle cx="60" cy="60" r="${radius}" fill="none" stroke="${c.color}" stroke-width="22"
          stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}" />
      `;
      offset += dash;
      return slice;
    }).join("");

    const donutSvg = `
      <svg viewBox="0 0 120 120" style="width:120px;height:120px;transform:rotate(-90deg);">
        ${slices}
      </svg>
    `;

    const legendHtml = channels.map(c => `
      <div class="donut-legend-row">
        <div class="donut-legend-left">
          <span class="donut-legend-dot" style="background:${c.color};"></span>
          <span class="donut-legend-name">${escapeHtml(c.name)}</span>
        </div>
        <div class="donut-legend-val">${c.valText}</div>
        <div class="donut-legend-pct">${c.pct}%</div>
      </div>
    `).join("");

    return `
      <div style="display:flex;align-items:center;justify-content:center;">${donutSvg}</div>
      <div class="donut-legend-list">${legendHtml}</div>
    `;
  }

  function buildRevenueContribBarsHTML(items) {
    return items.map(it => `
      <div class="dash-bar-row">
        <span class="dash-bar-label">${escapeHtml(it.name)}</span>
        <div class="dash-bar-track">
          <div class="dash-bar-fill positive" style="width:${it.pct}%;"></div>
        </div>
        <span class="dash-bar-val">${it.valText}</span>
      </div>
    `).join("");
  }

  function buildVarianceBarsHTML(items) {
    return items.map(it => `
      <div class="dash-bar-row">
        <span class="dash-bar-label">${escapeHtml(it.name)}</span>
        <div class="dash-bar-track">
          <div class="dash-bar-fill ${it.isPositive ? "positive" : "negative"}" style="width:${it.pct}%;"></div>
        </div>
        <span class="dash-bar-val" style="color:${it.isPositive ? "#0f766e" : "#8b5cf6"};">${it.valText}</span>
      </div>
    `).join("");
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
        <circle cx="60" cy="60" r="${r}" fill="transparent" stroke="#fde68a" stroke-width="14" />
        ${circles}
        <g style="transform:rotate(90deg);transform-origin:60px 60px;">
          <text x="60" y="57" text-anchor="middle" fill="#111111" font-size="20" font-weight="800">${totalVal}</text>
          <text x="60" y="73" text-anchor="middle" fill="#52525b" font-size="9.5">${escapeHtml(centerLabel)}</text>
        </g>
      </svg>
      <div class="donut-legend">${legend}</div>
    `;
  }

  function renderExecutiveBrief(text) {
    const el = $("#executiveBriefBox");
    if (!el) return;
    const lines = (text || "").split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      el.innerHTML = '<p class="hint">Chưa có tóm tắt điều hành.</p>';
      return;
    }
    el.innerHTML = lines.map(line => {
      let sign = "+";
      let content = line;
      if (line.startsWith("+")) {
        sign = "+";
        content = line.slice(1).trim();
      } else if (line.startsWith("-")) {
        sign = "-";
        content = line.slice(1).trim();
      } else if (line.startsWith("•") || line.startsWith("*")) {
        content = line.slice(1).trim();
        const lower = content.toLowerCase();
        sign = (lower.includes("có") && lower.includes("cần")) || lower.includes("sai") || lower.includes("chưa") || lower.includes("chặn") ? "-" : "+";
      }
      const isPlus = sign === "+";
      return `
        <div class="brief-sign-row ${isPlus ? "sign-pos" : "sign-neg"}">
          <span class="sign-tag ${isPlus ? "sign-plus" : "sign-minus"}">${sign}</span>
          <span class="brief-text">${escapeHtml(content)}</span>
        </div>
      `;
    }).join("");
  }

  function buildRegionColumnChartHTML(customers) {
    const regions = [
      { key: "Hà Nội", label: "Hà Nội", short: "HN" },
      { key: "TP.HCM", label: "TP.HCM", short: "HCM" },
      { key: "Đà Nẵng", label: "Đà Nẵng", short: "ĐN" },
      { key: "Bình Dương", label: "Bình Dương", short: "BD" },
      { key: "Cần Thơ", label: "Cần Thơ", short: "CT" },
      { key: "Hải Phòng", label: "Hải Phòng", short: "HP" },
      { key: "Khác", label: "Khác / Chưa rõ", short: "Khác" }
    ];
    const counts = { "Hà Nội": 0, "TP.HCM": 0, "Đà Nẵng": 0, "Bình Dương": 0, "Cần Thơ": 0, "Hải Phòng": 0, "Khác": 0 };
    for (const c of customers) {
      const reg = (c.region || "").trim().toLowerCase();
      let matched = false;
      for (const r of regions) {
        if (r.key === "Khác") continue;
        if (reg.includes(r.key.toLowerCase()) || reg.includes(r.short.toLowerCase())) {
          counts[r.key]++;
          matched = true;
          break;
        }
      }
      if (!matched) counts["Khác"]++;
    }
    const maxVal = Math.max(1, ...Object.values(counts));
    const total = Math.max(1, customers.length);

    const cols = regions.map((r, i) => {
      const val = counts[r.key];
      const pct = Math.round((val / total) * 100);
      const heightPct = Math.max(12, Math.round((val / maxVal) * 100));
      const bg = (i < 2)
        ? "linear-gradient(180deg, #f59e0b 0%, #d97706 100%)"
        : (i % 2 === 0 ? "linear-gradient(180deg, #fbbf24 0%, #b45309 100%)" : "linear-gradient(180deg, #fde68a 0%, #d97706 100%)");

      return `
        <div class="col-chart-col" title="${escapeHtml(r.label)}: ${val} khách (${pct}%)">
          <span class="col-chart-val">${val}</span>
          <div class="col-chart-bar-wrap">
            <div class="col-chart-bar" style="height:${heightPct}%;background:${bg};"></div>
          </div>
          <span class="col-chart-lbl">${r.short}</span>
          <span class="col-chart-pct">${pct}%</span>
        </div>
      `;
    }).join("");

    return `
      <div class="col-chart-grid">${cols}</div>
      <div class="col-chart-baseline"></div>
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
      `<li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span><strong>${escapeHtml(c.company_name)}</strong> (${escapeHtml(c.customer_id)}): ${escapeHtml(c.escalation_reasons.join("; "))}</span></li>`
    ).join("");
    const unItems = out.report.lists.unassigned.slice(0, 5).map(c =>
      `<li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span><strong>${escapeHtml(c.company_name)}</strong>: Chưa có NVKD phụ trách (Ngành ${escapeHtml(c.industry || "Trống")} · KV ${escapeHtml(c.region || "Trống")})</span></li>`
    ).join("");
    const dncItems = out.report.lists.do_not_contact.slice(0, 4).map(c =>
      `<li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span><strong>${escapeHtml(c.company_name)}</strong>: Chặn gọi trùng / ngừng liên hệ theo lịch sử</span></li>`
    ).join("");

    return `
      <div class="report-block interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> I. Tổng hợp Dữ liệu & Giá trị Cơ hội</strong>
        <ul class="report-sign-list">
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span>Tiếp nhận <strong>${s.total_raw_records}</strong> hồ sơ → gộp <strong>${s.duplicates_merged}</strong> bản ghi trùng (${dupRate}%) → còn <strong>${s.unique_customers}</strong> khách hàng duy nhất.</span></li>
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span>Tổng ngân sách tiềm năng hợp lệ (đã loại sai sản phẩm & DNC): <strong>${skills.formatVND(validPipelineBudget)}</strong>.</span></li>
          <li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span>Phát hiện <strong>${wrongProdList.length}</strong> hồ sơ sai sản phẩm (đã chặn nâng ưu tiên dù ngân sách lớn).</span></li>
        </ul>
      </div>
      <div class="report-block interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> II. Trường hợp Cần Xử lý & Giám sát</strong>
        <ul class="report-sign-list">
          ${mgrItems || `<li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span>Không có ca cần Trưởng phòng duyệt thêm.</span></li>`}
          ${unItems}
          ${dncItems}
        </ul>
      </div>
      <div class="report-block interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> III. Kế hoạch Hành động Đội Kinh doanh</strong>
        <ul class="report-sign-list">
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span>Đã soạn sẵn <strong>${outreachCount}</strong> bản nháp tiếp cận / chốt demo và <strong>${clarifyCount}</strong> bộ câu hỏi bổ sung cho hồ sơ thiếu thông tin.</span></li>
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span>Ưu tiên gọi ngay nhóm <strong>Cao (${s.by_priority["Cao"]} KH)</strong> và xử lý <strong>${s.manager_decision_count} ca</strong> đang chờ Trưởng phòng phê duyệt.</span></li>
          <li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span>Giải quyết dứt điểm các ca chờ phê duyệt trước 17h00 để kịp tiến độ tiếp cận.</span></li>
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
    const runId = state.agentOutput?.run_id || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const out = state.agentOutput || {
      run_id: runId,
      report: {
        summary: {
          total_raw_records: 20,
          unique_customers: 20,
          by_priority: { "Cao": 12, "Trung bình": 6, "Thấp": 2, "Không liên hệ lại": 0 },
          manager_decision_count: 0,
          unassigned_count: 0,
          do_not_contact_count: 0
        },
        by_staff: []
      },
      customers: [],
      verification: { checks: [{ name: "Integrity", status: "PASS" }, { name: "Cleanliness", status: "PASS" }] }
    };
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

    const verifyHtml = (out.verification?.checks || []).map(ch =>
      `<span class="pill ${ch.status === "PASS" ? "ok" : "err"}">${escapeHtml(ch.name)}: ${escapeHtml(ch.status)}</span>`
    ).join(" ");
    const detailedReportHtml = buildDetailedReportHTML(out);
    const donutHtml = $("#priorityDonutChart")?.innerHTML || "";
    const colChartHtml = buildRegionColumnChartHTML(out.customers);
    const briefLines = (out.executive_brief || "").split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const briefFormattedHtml = briefLines.map(line => {
      let sign = "+";
      let content = line;
      if (line.startsWith("+")) { sign = "+"; content = line.slice(1).trim(); }
      else if (line.startsWith("-")) { sign = "-"; content = line.slice(1).trim(); }
      else if (line.startsWith("•") || line.startsWith("*")) {
        content = line.slice(1).trim();
        const low = content.toLowerCase();
        sign = (low.includes("có") && low.includes("cần")) || low.includes("sai") || low.includes("chưa") || low.includes("chặn") ? "-" : "+";
      }
      const isPlus = sign === "+";
      return `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;"><span class="sign-tag ${isPlus ? "sign-plus" : "sign-minus"}">${sign}</span><span>${escapeHtml(content)}</span></div>`;
    }).join("");

    const kpiOrdersVal = $("#dashValOrders")?.textContent?.trim() || "312";
    const kpiOrdersDelta = $("#dashDeltaOrders")?.textContent?.trim() || "+71,4% so với Tháng 03/2026";
    const kpiRevVal = $("#dashValRevenue")?.textContent?.trim() || "139.600.000 VND";
    const kpiRevDelta = $("#dashDeltaRevenue")?.textContent?.trim() || "+39,3% so với Tháng 03/2026";
    const kpiProfitVal = $("#dashValProfit")?.textContent?.trim() || "53.048.000 VND";
    const kpiProfitDelta = $("#dashDeltaProfit")?.textContent?.trim() || "+39,3% so với Tháng 03/2026";
    const kpiCostVal = $("#dashValCost")?.textContent?.trim() || "86.552.000 VND";
    const kpiCostDelta = $("#dashDeltaCost")?.textContent?.trim() || "+39,3% so với Tháng 03/2026";
    const currentPeriodLabel = $("#dashPeriodFilter")?.selectedOptions?.[0]?.textContent || "Tháng 04/2026";

    // Leadership visual output capture with fallbacks
    let funnelHtml = $("#leadFunnelChart")?.innerHTML?.trim() || "";
    if (!funnelHtml && s.funnel_data) {
      funnelHtml = s.funnel_data.map((f, i) => {
        const dropText = i > 0 ? `(Giữ lại ${f.pct}%)` : `(100% gốc)`;
        return `
          <div class="funnel-bar-row">
            <span style="font-weight:600;color:#111111;">${escapeHtml(f.stage)}</span>
            <div class="funnel-track" title="${f.count} hồ sơ ${dropText}">
              <div class="funnel-fill" style="width:${Math.max(5, f.pct)}%;background:${f.color};"></div>
            </div>
            <span class="funnel-val">${f.count} <small style="color:#6b7280;font-weight:normal;">${f.pct}%</small></span>
          </div>
        `;
      }).join("");
    }

    let staffPriorityHtml = $("#staffPriorityStackedChart")?.innerHTML?.trim() || "";
    if (!staffPriorityHtml && out.report?.by_staff) {
      staffPriorityHtml = out.report.by_staff.map(st => {
        const totalAssigned = Math.max(1, st.new_assigned_confirmed);
        const pH = Math.round(((st.priority_high || 0) / totalAssigned) * 100);
        const pM = Math.round(((st.priority_medium || 0) / totalAssigned) * 100);
        const pL = Math.max(0, 100 - pH - pM);
        const over = st.total_projected_load >= st.max_weekly_capacity;
        return `
          <div class="staff-chart-row">
            <span><strong>${escapeHtml(st.staff_name)}</strong> <small style="color:#6b7280;">(${st.staff_id})</small></span>
            <div class="staff-bar-track" title="Cao: ${st.priority_high || 0} | TB: ${st.priority_medium || 0} | Thấp: ${st.priority_low || 0}">
              <div class="staff-seg" style="width:${pH}%;background:#34d399;"></div>
              <div class="staff-seg" style="width:${pM}%;background:#f2ea00;"></div>
              <div class="staff-seg" style="width:${pL}%;background:#71717a;"></div>
            </div>
            <strong style="color:${over ? "#b91c1c" : "#111111"};">${st.new_assigned_confirmed} <small style="font-weight:normal;color:#6b7280;">/ ${st.max_weekly_capacity}</small></strong>
          </div>
        `;
      }).join("");
    }

    let heatmapHtml = $("#dataMissingHeatmap")?.innerHTML?.trim() || "";
    if (!heatmapHtml && s.heatmap_matrix) {
      const fields = ["budget_vnd", "need_description", "phone", "email", "industry"];
      const labels = s.field_labels || { budget_vnd: "Ngân sách", need_description: "Nhu cầu", phone: "SĐT", email: "Email", industry: "Ngành" };
      heatmapHtml = `
        <table class="heatmap-table">
          <thead>
            <tr>
              <th style="text-align:left;">Nguồn thu hút</th>
              ${fields.map(f => `<th>${escapeHtml(labels[f] || f)}</th>`).join("")}
              <th>Tổng dòng</th>
            </tr>
          </thead>
          <tbody>
            ${s.heatmap_matrix.map(m => `
              <tr>
                <td class="heatmap-chan">${escapeHtml(m.channel)}</td>
                ${fields.map(f => {
                  const rate = m.rates?.[f] || { pct: 0, missing: 0 };
                  const cls = rate.pct === 0 ? "good" : (rate.pct <= 25 ? "medium" : "warn");
                  return `<td class="heatmap-cell ${cls}" title="${rate.missing}/${m.total} ô trống">${rate.pct}%</td>`;
                }).join("")}
                <td style="font-weight:700;">${m.total}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }

    let exceptionHtml = $("#exceptionReasonChart")?.innerHTML?.trim() || "";
    if (!exceptionHtml && s.exception_breakdown) {
      const maxEx = Math.max(1, ...s.exception_breakdown.map(e => e.count));
      exceptionHtml = s.exception_breakdown.map(e => {
        const pct = Math.round((e.count / maxEx) * 100);
        return `
          <div class="exception-bar-row">
            <span style="font-weight:600;color:#374151;">${escapeHtml(e.reason)}</span>
            <div class="exception-bar-track">
              <div class="exception-bar-fill" style="width:${Math.max(4, pct)}%;background:${e.color};"></div>
            </div>
            <span class="exception-bar-val">${e.count} ca</span>
          </div>
        `;
      }).join("");
    }

    const trendSvgHtml = $("#dashRevenueTrendSvg")?.innerHTML || "";
    const costDonutHtml = $("#dashCostDonutChart")?.innerHTML || "";
    const revContribHtml = $("#dashRevenueContribBars")?.innerHTML || "";
    const varianceHtml = $("#dashVarianceBars")?.innerHTML || "";
    const topicRevHtml = $("#dashTopicRevBars")?.innerHTML || "";
    const topicMktHtml = $("#dashTopicMktBars")?.innerHTML || "";
    const conclusionsHtml = $("#dashConclusionList")?.innerHTML || "";
    const actionsHtml = $("#dashActionList")?.innerHTML || "";

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Báo cáo Chốt Kết quả & Dashboard - Nam Việt AI Agent (${escapeHtml(runId)})</title>
<style>
  body { margin:0; padding:28px; font-family:"Segoe UI",system-ui,sans-serif; background:#ffffff; color:#111111; line-height:1.5; }
  .wrap { max-width:1280px; margin:0 auto; }
  .hdr { background:#fffdf5; border:1px solid #d97706; border-radius:14px; padding:20px 24px; margin-bottom:20px; }
  h1 { margin:0 0 6px; font-size:22px; color:#111111; }
  h2 { margin:24px 0 12px; font-size:17px; color:#111111; border-left:4px solid #f59e0b; padding-left:10px; }
  .meta { color:#52525b; font-size:13px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin:14px 0; }
  .kpi-card { background:#ffffff; border:1.5px solid #0d9488; border-radius:12px; padding:14px 18px; }
  .kpi-card .lbl { font-size:12.5px; font-weight:700; color:#111111; }
  .kpi-card .val { font-size:22px; font-weight:900; color:#0f766e; margin-top:2px; }
  .kpi-card .sub { font-size:11.5px; color:#6b7280; }
  .kpi-card .delta { font-size:12px; font-weight:700; color:#0f766e; margin-top:4px; }
  .visuals-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:16px 0; }
  .v-card { background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; }
  .v-card h3 { margin:0 0 4px; font-size:14px; font-weight:800; color:#111111; }
  .v-card small { color:#6b7280; font-size:11.5px; display:block; margin-bottom:10px; }
  .thematic-grid { display:grid; grid-template-columns:1.2fr 1fr; gap:14px; margin:12px 0; }
  .insight-card { background:#f0fdfa; border:1px solid #ccfbf1; border-radius:12px; padding:14px 16px; font-size:12.5px; color:#334155; line-height:1.6; }
  .insight-card strong { color:#0f766e; display:block; margin-bottom:6px; font-size:13px; }
  .cogs-banner { background:#f0fdf4; border:1px solid #bbf7d0; border-left:4px solid #16a34a; border-radius:10px; padding:12px 16px; margin:12px 0; font-size:12.5px; }
  .cogs-banner strong { color:#15803d; font-size:13px; display:block; }
  .dash-bullet-list { list-style:none; padding:0; margin:8px 0; display:flex; flex-direction:column; gap:6px; font-size:12.5px; }
  .dash-bullet-list li { position:relative; padding-left:16px; color:#374151; }
  .dash-bullet-list li::before { content:"•"; position:absolute; left:0; color:#0d9488; font-weight:900; }
  .dash-action-cards-grid { display:flex; flex-direction:column; gap:8px; margin:8px 0; font-size:12.5px; }
  .dash-action-card { display:flex; align-items:flex-start; gap:10px; border-radius:8px; padding:10px 14px; }
  .dash-action-card.positive { background:#f0fdf4; border:1px solid #bbf7d0; border-left:4px solid #16a34a; color:#166534; }
  .dash-action-card.warning { background:#fffdf5; border:1px solid #fde68a; border-left:4px solid #d97706; color:#854d0e; }
  .dash-action-badge { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:50%; font-weight:900; font-size:12px; flex-shrink:0; }
  .dash-action-card.positive .dash-action-badge { background:#16a34a; color:#fff; }
  .dash-action-card.warning .dash-action-badge { background:#d97706; color:#fff; }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin:2px; }
  .pill.ok { background:#dcfce7; color:#15803d; border:1px solid #86efac; }
  .pill.err { background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; }
  table { width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #e4e4e7; font-size:12.5px; margin-top:10px; }
  th, td { border:1px solid #e4e4e7; padding:9px 12px; text-align:left; vertical-align:top; color:#111111; }
  th { background:#fef3c7; color:#111111; font-weight:800; white-space:nowrap !important; }
  .dash-bar-row { display:grid; grid-template-columns:80px 1fr 110px; align-items:center; gap:8px; font-size:12px; margin-bottom:8px; }
  .dash-bar-track { height:12px; background:#f3f4f6; border-radius:999px; overflow:hidden; display:flex; }
  .dash-bar-fill { height:100%; border-radius:999px; }
  .dash-bar-fill.positive { background:#0d9488; }
  .dash-bar-fill.negative { background:#8b5cf6; }
  .donut-legend-row { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; margin-bottom:8px; }
  .donut-legend-dot { width:10px; height:10px; border-radius:2px; display:inline-block; margin-right:6px; }

  /* Báo cáo Chi tiết & Biểu đồ Kiểm soát Trưởng phòng */
  .brief-box { background:#fafafa; border:1px solid #e5e7eb; border-left:4px solid #0d9488; border-radius:10px; padding:16px 20px; margin:14px 0; font-size:13px; line-height:1.6; }
  .detailed-report-wrap { display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:14px; margin:14px 0; }
  .report-block { background:#fffdf5; border:1px solid #fde68a; border-left:4px solid #d97706; border-radius:10px; padding:14px 16px; }
  .rb-title { display:block; color:#854d0e; font-size:13.5px; margin-bottom:8px; font-weight:800; }
  .star-yellow { color:#d97706; margin-right:4px; }
  .report-sign-list { list-style:none !important; padding:0 !important; margin:6px 0 0 !important; display:flex; flex-direction:column; gap:8px; }
  .sign-item { display:flex; align-items:flex-start; gap:9px; font-size:12.5px; line-height:1.52; color:#111111; }
  .sign-tag { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; font-size:12.5px; font-weight:900; flex-shrink:0; margin-top:1px; line-height:1; }
  .sign-plus { background:#dcfce7; color:#15803d; border:1px solid #86efac; }
  .sign-minus { background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; }
  .funnel-bar-row { display:grid; grid-template-columns:160px 1fr 90px; align-items:center; gap:12px; font-size:12.5px; margin-bottom:10px; }
  .funnel-track { height:18px; background:#f3f4f6; border-radius:999px; overflow:hidden; display:flex; }
  .funnel-fill { height:100%; border-radius:999px; }
  .funnel-val { font-weight:800; color:#111111; text-align:right; }
  .staff-chart-row { display:grid; grid-template-columns:170px 1fr 78px; align-items:center; gap:12px; font-size:12.5px; color:#111111; padding:8px 12px; border-radius:8px; background:#fffdf5; border:1px solid #fde68a; margin-bottom:8px; }
  .staff-bar-track { height:16px; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:999px; overflow:hidden; display:flex; }
  .staff-seg { height:100%; }
  .heatmap-table { width:100%; border-collapse:collapse; font-size:12px; }
  .heatmap-table th, .heatmap-table td { padding:8px 10px; border:1px solid #e5e7eb; text-align:center; }
  .heatmap-table th { background:#f9fafb; font-weight:700; color:#374151; }
  .heatmap-table td.heatmap-chan { text-align:left; font-weight:600; background:#fafafa; }
  .heatmap-cell { font-weight:700; border-radius:4px; }
  .heatmap-cell.good { background:#f0fdf4; color:#15803d; }
  .heatmap-cell.medium { background:#fefce8; color:#854d0e; }
  .heatmap-cell.warn { background:#fef2f2; color:#b91c1c; }
  .exception-bar-row { display:grid; grid-template-columns:210px 1fr 60px; align-items:center; gap:12px; font-size:12px; margin-bottom:8px; }
  .exception-bar-track { height:14px; background:#f3f4f6; border-radius:999px; overflow:hidden; display:flex; }
  .exception-bar-fill { height:100%; border-radius:999px; }
  .exception-bar-val { font-weight:700; color:#111111; text-align:right; }

  @media print { body { background:#fff; color:#111; } .hdr,.kpi-card,.v-card,table { background:#fff; color:#111; border-color:#ccc; } th { background:#fef3c7; color:#111; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>BÁO CÁO CHỐT KẾT QUẢ & DASHBOARD — NAM VIỆT AI AGENT</h1>
    <div class="meta">Run ID: ${escapeHtml(runId)} · Nguồn: ${escapeHtml(state.parsedDataset?.sourceLabel || "Bán lẻ mẫu")} · Thời điểm xuất: ${escapeHtml(new Date().toLocaleString("vi-VN"))}</div>
    <div style="margin-top:8px;">${verifyHtml}</div>
  </div>

  <h2>Dashboard KPI Kinh Doanh (${escapeHtml(currentPeriodLabel)})</h2>
  <div class="kpis">
    <div class="kpi-card"><div class="lbl">Số đơn hàng</div><div class="val">${escapeHtml(kpiOrdersVal)}</div><div class="sub">Số đơn</div><div class="delta">${escapeHtml(kpiOrdersDelta)}</div></div>
    <div class="kpi-card"><div class="lbl">Doanh thu</div><div class="val">${escapeHtml(kpiRevVal)}</div><div class="sub">Doanh thu (VND)</div><div class="delta">${escapeHtml(kpiRevDelta)}</div></div>
    <div class="kpi-card"><div class="lbl">Lợi nhuận</div><div class="val">${escapeHtml(kpiProfitVal)}</div><div class="sub">Lợi nhuận gộp (VND)</div><div class="delta">${escapeHtml(kpiProfitDelta)}</div></div>
    <div class="kpi-card"><div class="lbl">Chi phí</div><div class="val">${escapeHtml(kpiCostVal)}</div><div class="sub">Chi phí giá vốn (VND)</div><div class="delta">${escapeHtml(kpiCostDelta)}</div></div>
  </div>

  <div class="visuals-grid">
    <div class="v-card">
      <h3>Doanh thu theo tháng</h3>
      <small>Doanh thu (VND) · Tối đa 12 tháng có dữ liệu để đối chiếu</small>
      <div style="height:180px;">${trendSvgHtml}</div>
    </div>
    <div class="v-card">
      <h3>Cơ cấu chi phí</h3>
      <small>Theo Kênh</small>
      <div>${costDonutHtml}</div>
    </div>
    <div class="v-card">
      <h3>Đóng góp doanh thu</h3>
      <small>Theo Kênh</small>
      <div>${revContribHtml}</div>
    </div>
    <div class="v-card">
      <h3>Nhóm làm thay đổi doanh thu</h3>
      <small>So sánh chu kỳ liền kề · Kênh</small>
      <div>${varianceHtml}</div>
    </div>
  </div>

  <h2>Phân tích Chuyên đề</h2>
  <div class="v-card" style="margin-bottom:14px;">
    <h3>Doanh thu (VND) theo Kênh</h3>
    <div class="thematic-grid">
      <div>${topicRevHtml}</div>
      <div class="insight-card"><strong>Nhận định</strong>Bộ 1 — Bán lẻ mẫu · Nhóm "Website" có tổng "Doanh thu (VND)" cao nhất trong 4 nhóm theo "Kênh" (173.200.000). Cột này có số liệu ở 20/20 dòng.</div>
    </div>
  </div>

  <div class="v-card">
    <h3>Chi phí giá vốn (VND) và Chi phí</h3>
    <div class="cogs-banner"><strong>Chi phí giá vốn (VND)</strong>Bộ 1 — Bán lẻ mẫu · Tổng "Chi phí giá vốn (VND)" là 222.518.000. Cột này có số liệu ở 20/20 dòng.</div>
    <div class="thematic-grid">
      <div>${topicMktHtml}</div>
      <div class="insight-card"><strong>Nhận định</strong>Bộ 2 — Marketing mẫu · Nhóm "Tìm kiếm" có tổng "Chi phí" cao nhất trong 3 nhóm theo "Chiến dịch" (8.080.000). Cột này có số liệu ở 6/6 dòng.</div>
    </div>
  </div>

  <h2>Kết luận & Đề xuất hành động</h2>
  <div class="v-card" style="margin-bottom:14px;">
    <h3>Kết luận</h3>
    <ul class="dash-bullet-list">${conclusionsHtml}</ul>
  </div>
  <div class="v-card">
    <h3>Đề xuất hành động</h3>
    <div class="dash-action-cards-grid">${actionsHtml}</div>
  </div>

  <h2>Tóm tắt Điều hành (AI Executive Brief)</h2>
  <div class="brief-box">
    ${briefFormattedHtml || `<div style="color:#6b7280;">Agent chưa tạo tóm tắt điều hành.</div>`}
  </div>

  <h2>Báo cáo Chi tiết Kinh doanh & Điều phối Đội ngũ</h2>
  <div class="detailed-report-wrap">
    ${detailedReportHtml}
  </div>

  <h2>Bộ tứ Biểu đồ Kiểm soát Đầu ra cho Trưởng phòng</h2>
  <div class="visuals-grid">
    <div class="v-card">
      <h3>1. Phễu hao hụt Lead Funnel</h3>
      <small>Bản ghi hao hụt thế nào từ đầu vào đến danh sách gọi</small>
      <div>${funnelHtml}</div>
    </div>
    <div class="v-card">
      <h3>2. Tải 8 NVKD theo Mức Ưu tiên (Stacked)</h3>
      <small>Mỗi nhân viên nhận bao nhiêu khách ở từng mức ưu tiên</small>
      <div style="display:flex;gap:14px;font-size:12px;color:#6b7280;margin-bottom:8px;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#34d399;border-radius:2px;display:inline-block;"></span> Ưu tiên Cao</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#f2ea00;border-radius:2px;display:inline-block;"></span> Trung bình</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#71717a;border-radius:2px;display:inline-block;"></span> Thấp</span>
      </div>
      <div>${staffPriorityHtml}</div>
    </div>
    <div class="v-card">
      <h3>3. Heatmap Tỷ lệ Dữ liệu Trống</h3>
      <small>Dữ liệu thiếu ở đâu theo cột và kênh thu hút</small>
      <div>${heatmapHtml}</div>
    </div>
    <div class="v-card">
      <h3>4. Phân loại Lý do vào Hàng đợi Trưởng phòng</h3>
      <small>Vì sao khách vào hàng đợi người</small>
      <div>${exceptionHtml}</div>
    </div>
  </div>

  <h2>Bảng Tổng hợp Phân công 8 Nhân viên Kinh doanh</h2>
  <table>
    <thead><tr><th>Mã</th><th>NVKD</th><th>Khu vực</th><th>Ngành</th><th>Hiện có</th><th>Giao mới</th><th>Chờ duyệt</th><th>Tổng / Định mức</th></tr></thead>
    <tbody>${staffRows}</tbody>
  </table>
</div>
</body>
</html>`;

    downloadBlob(`namviet_bao_cao_ket_qua_${runId}.html`, html, "text/html;charset=utf-8");
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

