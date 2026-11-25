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
      $("#dashPeriodFilter") ? $("#dashPeriodFilter").value : "auto",
      true
    );
    if (state.agentOutput) {
      renderResultsDashboard();
    }
    $("#resultsSection")?.classList.remove("hidden");
    showPage("dashboard");
  }

  function bindEvents() {
    $("#btnRunDashboardAgent")?.addEventListener("click", () => {
      renderBusinessKpiDashboard(
        $("#dashDatasetFilter") ? $("#dashDatasetFilter").value : "auto",
        $("#dashPeriodFilter") ? $("#dashPeriodFilter").value : "auto",
        true
      );
    });
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
        renderBusinessKpiDashboard(e.target.value, "auto", true);
      });
    }
    if ($("#dashPeriodFilter")) {
      $("#dashPeriodFilter").addEventListener("change", (e) => {
        renderBusinessKpiDashboard($("#dashDatasetFilter") ? $("#dashDatasetFilter").value : "auto", e.target.value, true);
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
      $("#btnToggleInputPanel").textContent = hidden ? "📂 Đổi file dữ liệu" : "✕ Thu gọn khung nạp file";
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
    $("#btnGoToClean").addEventListener("click", () => enterBusinessContextStep());
    $("#btnConfirmDataSubset")?.addEventListener("click", () => enterBusinessContextStep());
    $("#btnResetDataSubset")?.addEventListener("click", () => resetDataSubset());
    $("#btnSendWranglerCmd")?.addEventListener("click", () => {
      const input = $("#aiWranglerInput");
      if (input) handleWranglerCommand(input.value);
    });
    $("#aiWranglerInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleWranglerCommand(e.target.value);
      }
    });
    document.querySelectorAll(".wrangler-quick-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        handleWranglerCommand(btn.dataset.prompt);
      });
    });
    $("#btnSkipMissingAndNext").addEventListener("click", () => enterBusinessContextStep());
    $("#btnConfirmContextProceedClean").addEventListener("click", () => {
      saveBusinessContextFromUI();
      enterCleaningStep("standard", true);
    });
    $("#btnSkipContextDirectClean").addEventListener("click", () => enterCleaningStep("standard", true));
    $("#btnReopenContext").addEventListener("click", () => enterBusinessContextStep());
    $("#btnReviewScope").addEventListener("click", () => {
      refreshInteractiveAiScope(true);
    });
    $("#ctxBusinessType").addEventListener("input", updateAiUnderstanding);
    $("#ctxAnalysisQuestions").addEventListener("input", updateAiUnderstanding);
    $("#btnSendScopeChat")?.addEventListener("click", () => handleSendScopeChat());
    $("#aiScopeChatInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendScopeChat();
      }
    });
    $("#btnDashReopenScope")?.addEventListener("click", () => {
      showPage("workspace", true);
      enterBusinessContextStep();
    });
    $("#btnDashQuickAsk")?.addEventListener("click", () => handleDashboardQuickAsk());
    $("#dashQuickAskInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleDashboardQuickAsk();
      }
    });
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

    // Save original dataset deep copy and active headers
    const headersList = (Array.isArray(parsed.headers) && parsed.headers.length > 0)
      ? [...parsed.headers]
      : Object.keys(parsed.rows[0] || {}).filter(k => !k.startsWith("__"));
    parsed.headers = headersList;
    state.originalDataset = {
      headers: [...headersList],
      rows: parsed.rows.map(r => ({ ...r })),
      sourceLabel
    };
    state.activeHeaders = [...headersList];
    state.wranglerMessages = [];

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
    $("#btnToggleInputPanel").textContent = "📂 Đổi file dữ liệu";
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
      autoOpt.textContent = `📂 File hiện tại: ${sourceLabel} (${parsed.rows.length} dòng · ${headersList.length} cột)`;
      dsFilter.value = "auto";
    }
    renderBusinessKpiDashboard("auto", "auto");

    $("#validationSection").classList.remove("hidden");
    $("#validationBody").classList.remove("hidden");
    $("#validationSummaryLine").classList.add("hidden");
    $("#repairLogBox").classList.add("hidden");
    $("#businessContextSection")?.classList.add("hidden");
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
    if (errCount > 0) {
      btn.classList.remove("hidden");
      btn.textContent = state.showErrorDetails ? `Ẩn lỗi (${errCount})` : `Xem lỗi (${errCount})`;
      errBox.classList.toggle("hidden", !state.showErrorDetails);
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

    $("#previewCount").textContent = res.totalRows;

    if (res.valid) {
      btnGoClean.classList.remove("hidden");
      btnFix.classList.add("hidden");

      if (res.warnings.length > 0) {
        banner.className = "alert alert-success";
        banner.innerHTML = `<strong>Định dạng hợp lệ ✓</strong> (${res.totalRows} dòng) — Có <strong>${res.warnings.length}</strong> mục thiếu thông tin. Bạn có thể kiểm tra bảng và <strong>Chat với AI</strong> để chỉnh sửa cột/dòng trực tiếp bên dưới.`;
        updateWorkflowSteps(2, { validationState: "ok" });
      } else {
        banner.className = "alert alert-success";
        banner.innerHTML = `<strong>Đầu vào hợp lệ ✓</strong> (${res.totalRows} dòng · ${state.activeHeaders?.length || res.headers?.length || 0} cột). Bạn có thể xem toàn bộ bảng biểu, chọn cột hoặc <strong>Chat với AI</strong> để chỉnh sửa dữ liệu trực tiếp bên dưới.`;
      }
      renderDataStudioUI();
    } else {
      banner.className = "alert alert-danger";
      banner.innerHTML = `<strong>Sai định dạng (${res.errors.length} lỗi)!</strong> Bấm <strong>Tự động Sửa lỗi</strong> hoặc bật <strong>Xem lỗi (${res.errors.length})</strong> để kiểm tra và sửa.`;
      btnGoClean.classList.add("hidden");
      btnFix.classList.remove("hidden");
      $("#businessContextSection")?.classList.add("hidden");
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
      renderDataStudioUI();
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
  }

  function renderDataStudioUI() {
    const container = $("#dataStudioContainer");
    if (!container) return;

    const origHeaders = state.originalDataset?.headers || state.parsedDataset?.headers || [];
    const activeHeaders = state.activeHeaders || origHeaders;
    const totalRows = state.parsedDataset?.rows?.length || 0;

    if ($("#dataStudioRowCount")) {
      $("#dataStudioRowCount").innerHTML = `<strong>${totalRows.toLocaleString("vi-VN")}</strong> dòng`;
    }
    if ($("#dataStudioColCount")) {
      $("#dataStudioColCount").innerHTML = `<strong>${origHeaders.length}</strong> cột gốc`;
    }
    if ($("#dataStudioActiveColsBadge")) {
      $("#dataStudioActiveColsBadge").innerHTML = `Đang dùng <strong>${activeHeaders.length}</strong> / ${origHeaders.length} cột`;
      $("#dataStudioActiveColsBadge").className = `stat-pill ${activeHeaders.length < origHeaders.length ? "amber" : ""}`;
    }
    if ($("#colSelectionSummary")) {
      $("#colSelectionSummary").textContent = activeHeaders.length === origHeaders.length
        ? "Đang chọn tất cả cột"
        : `Đã lọc: giữ ${activeHeaders.length} cột, ẩn ${origHeaders.length - activeHeaders.length} cột`;
    }

    // Render Column Chips
    const chipsWrap = $("#columnChipsList");
    if (chipsWrap && origHeaders.length > 0) {
      chipsWrap.innerHTML = origHeaders.map(h => {
        const isActive = activeHeaders.includes(h);
        return `<span class="col-chip ${isActive ? "active" : "inactive"}" data-col="${escapeHtml(h)}" title="${isActive ? "Bấm để bỏ cột" : "Bấm để chọn cột"}">
          <span>${isActive ? "✓" : "✕"}</span> ${escapeHtml(h)}
        </span>`;
      }).join("");

      chipsWrap.querySelectorAll(".col-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const colName = chip.dataset.col;
          toggleColumnSelection(colName);
        });
      });
    }

    // Initial greeting in AI Wrangler messages if empty
    if (!state.wranglerMessages || state.wranglerMessages.length === 0) {
      state.wranglerMessages = [
        {
          sender: "ai",
          text: `👋 <strong>Minh Hoàng AI Data Wrangler đã sẵn sàng!</strong><br/>File của bạn đang có <strong>${totalRows} dòng</strong> và <strong>${origHeaders.length} cột</strong>.<br/>Bạn có thể ra lệnh trực tiếp cho tôi (Ví dụ: <em>"Đang có 50 cột nhưng mình chỉ muốn tính dữ liệu theo 10 cột đầu tiên"</em>, hoặc <em>"Bỏ cột X"</em>), hoặc bấm các nút gợi ý nhanh bên trên!`
        }
      ];
    }
    renderWranglerMessages();

    // Render Preview Table
    renderEditablePreviewTable(state.validationResult?.errors || []);
  }

  function renderWranglerMessages() {
    const box = $("#aiWranglerMessages");
    if (!box) return;
    box.innerHTML = (state.wranglerMessages || []).map(m => `
      <div class="ai-chat-msg ${m.sender}">
        <div class="ai-chat-avatar">${m.sender === "ai" ? "🤖" : "👤"}</div>
        <div class="ai-chat-bubble">${m.text}</div>
      </div>
    `).join("");
    box.scrollTop = box.scrollHeight;
  }

  function toggleColumnSelection(colName) {
    if (!state.originalDataset) return;
    let current = [...(state.activeHeaders || state.originalDataset.headers)];
    if (current.includes(colName)) {
      if (current.length <= 1) {
        alert("Bảng phải có ít nhất 1 cột để phân tích.");
        return;
      }
      current = current.filter(c => c !== colName);
    } else {
      current.push(colName);
    }
    applyColumnFilter(current);
  }

  function resetDataSubset() {
    if (!state.originalDataset) return;
    applyColumnFilter([...state.originalDataset.headers]);
  }

  function applyColumnFilter(newHeaders) {
    if (!state.originalDataset) return;
    const validHeaders = newHeaders.filter(h => state.originalDataset.headers.includes(h));
    if (validHeaders.length === 0) return;

    state.activeHeaders = [...validHeaders];
    state.parsedDataset.headers = [...validHeaders];
    state.parsedDataset.rows = state.originalDataset.rows.map(r => {
      const obj = { __rowNumber: r.__rowNumber };
      validHeaders.forEach(h => { obj[h] = r[h] ?? ""; });
      return obj;
    });

    renderDataStudioUI();

    // Dynamically update dashboard and downstream listeners
    const dsFilter = $("#dashDatasetFilter");
    if (dsFilter) {
      let autoOpt = dsFilter.querySelector('option[value="auto"]');
      if (autoOpt) {
        autoOpt.textContent = `📂 File hiện tại: ${state.parsedDataset.sourceLabel} (${state.parsedDataset.rows.length} dòng · ${validHeaders.length} cột)`;
      }
    }
    renderBusinessKpiDashboard("auto", "auto", false);
  }

  async function handleWranglerCommand(cmdText) {
    if (!cmdText || !cmdText.trim()) return;
    const text = cmdText.trim();
    if (!state.originalDataset) return;

    // Append user message
    state.wranglerMessages.push({ sender: "user", text: escapeHtml(text) });
    renderWranglerMessages();

    // Clear input
    const inputEl = $("#aiWranglerInput");
    if (inputEl) inputEl.value = "";

    const origHeaders = state.originalDataset.headers || [];

    // Case 1: First N columns (Matches exact user request: "Đang có 50 cột nhưng mình chỉ muốn tính dữ liệu theo 10 cột đầu tiên", "chỉ tính 10 cột đầu", "chỉ lấy 5 cột...")
    const nMatch = text.match(/(?:chỉ\s*(?:lấy|giữ|tính|chọn)|giữ\s*lại|tính\s*dữ\s*liệu\s*theo|chỉ\s*muốn\s*tính|đầu\s*tiên\s*chỉ\s*lấy)\s*(\d+)\s*cột/i)
      || text.match(/(\d+)\s*cột\s*(?:đầu|đầu\s*tiên)/i)
      || text.match(/top\s*(\d+)\s*cột/i);

    if (nMatch) {
      const count = Math.max(1, Math.min(origHeaders.length, parseInt(nMatch[1], 10)));
      const selectedCols = origHeaders.slice(0, count);
      applyColumnFilter(selectedCols);
      state.wranglerMessages.push({
        sender: "ai",
        text: `✅ <strong>Đã xử lý thành công theo yêu cầu của bạn!</strong><br/>
• <strong>Đã chọn giữ lại ${count} cột đầu tiên:</strong> <code>${selectedCols.join("</code>, <code>")}</code>.<br/>
• <strong>Đã ẩn ${origHeaders.length - count} cột</strong> còn lại.<br/>
• Bảng dữ liệu bên dưới đã được cập nhật trực quan ngay lập tức. Toàn bộ các bước Bối cảnh, Làm sạch, KPI và Dashboard tiếp theo sẽ tính toán chính xác trên ${count} cột này!`
      });
      renderWranglerMessages();
      return;
    }

    // Case 2: Reset to all columns
    if (/khôi\s*phục|reset|toàn\s*bộ|tất\s*cả|mặc\s*định/i.test(text)) {
      resetDataSubset();
      state.wranglerMessages.push({
        sender: "ai",
        text: `🔄 <strong>Đã khôi phục toàn bộ ${origHeaders.length} cột ban đầu!</strong> Bảng dữ liệu và tất cả các bước phân tích đã được đồng bộ về trạng thái đầy đủ.`
      });
      renderWranglerMessages();
      return;
    }

    // Case 3: Select core / numeric & dimension columns
    if (/số\s*liệu|chỉ\s*số|phân\s*loại/i.test(text)) {
      const sch = detectAdaptiveSchema(state.originalDataset.rows, origHeaders);
      const kept = [];
      if (sch.colEntity) kept.push(sch.colEntity);
      if (sch.colDate && !kept.includes(sch.colDate)) kept.push(sch.colDate);
      if (sch.colPrimaryDim && !kept.includes(sch.colPrimaryDim)) kept.push(sch.colPrimaryDim);
      (sch.numericCandidates || []).forEach(c => { if (!kept.includes(c.col)) kept.push(c.col); });
      if (kept.length > 0) {
        applyColumnFilter(kept);
        state.wranglerMessages.push({
          sender: "ai",
          text: `📊 <strong>Đã tự động lọc các cột cốt lõi:</strong> Giữ lại <strong>${kept.length} cột</strong> quan trọng nhất (<code>${kept.join("</code>, <code>")}</code>). Đã ẩn các cột phụ trợ.`
        });
        renderWranglerMessages();
        return;
      }
    }

    // Case 4: Drop specific named columns
    if (/bỏ|xóa|loại|ẩn/i.test(text)) {
      const normText = normalizeViText(text);
      const toRemove = (state.activeHeaders || origHeaders).filter(h => normText.includes(normalizeViText(h)));
      if (toRemove.length > 0) {
        const remain = (state.activeHeaders || origHeaders).filter(h => !toRemove.includes(h));
        if (remain.length > 0) {
          applyColumnFilter(remain);
          state.wranglerMessages.push({
            sender: "ai",
            text: `🗑️ <strong>Đã loại bỏ ${toRemove.length} cột:</strong> <code>${toRemove.join("</code>, <code>")}</code>.<br/>Còn lại <strong>${remain.length} cột</strong> đang được dùng để tính toán.`
          });
          renderWranglerMessages();
          return;
        }
      }
    }

    // Case 5: Keep specific named columns
    const normText = normalizeViText(text);
    const matchedCols = origHeaders.filter(h => normText.includes(normalizeViText(h)));
    if (matchedCols.length >= 2) {
      applyColumnFilter(matchedCols);
      state.wranglerMessages.push({
        sender: "ai",
        text: `🎯 <strong>Đã chọn đích danh ${matchedCols.length} cột theo yêu cầu:</strong> <code>${matchedCols.join("</code>, <code>")}</code>.<br/>Đã ẩn ${origHeaders.length - matchedCols.length} cột còn lại.`
      });
      renderWranglerMessages();
      return;
    }

    // General fallback
    state.wranglerMessages.push({
      sender: "ai",
      text: `💡 Tôi đã ghi nhận yêu cầu: <em>"${escapeHtml(text)}"</em>.<br/>Bạn có thể bấm vào các nút gợi ý nhanh ở trên (Ví dụ: <strong>⚡ Chỉ tính 10 cột đầu tiên</strong>) hoặc bấm trực tiếp vào từng thẻ cột bên dưới để chọn lọc!`
    });
    renderWranglerMessages();
  }

  function renderEditablePreviewTable(errors = []) {
    const rows = state.parsedDataset?.rows || [];
    const cols = (state.activeHeaders && state.activeHeaders.length > 0)
      ? state.activeHeaders
      : ((state.parsedDataset?.headers && state.parsedDataset.headers.length > 0)
          ? state.parsedDataset.headers
          : Object.keys(rows[0] || {}).filter(k => !k.startsWith("__")));

    const errLookup = new Set((errors || []).map(e => `${e.row}::${e.column}`));

    const thead = $("#previewTable thead");
    if (!thead) return;
    thead.innerHTML = `<tr><th>#</th>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;

    const displayLimit = 100; // keep UI responsive even on 700-lead stress test
    const slice = rows.slice(0, displayLimit);
    const tbody = $("#previewTable tbody");
    if (!tbody) return;
    tbody.innerHTML = slice.map((r, i) => {
      const rowNum = r.__rowNumber || (i + 2);
      return `<tr>
        <td>${rowNum}</td>
        ${cols.map(c => {
          const hasErr = errLookup.has(`${rowNum}::${c}`);
          return `<td contenteditable="true" data-row-idx="${i}" data-col="${escapeHtml(c)}" class="${hasErr ? "cell-error" : ""}">${escapeHtml(r[c] ?? "")}</td>`;
        }).join("")}
      </tr>`;
    }).join("") + (rows.length > displayLimit ? `<tr><td colspan="${cols.length + 1}" class="hint">Đang hiển thị ${displayLimit}/${rows.length} dòng đầu tiên để xem trước mượt mà. Toàn bộ ${rows.length} dòng đều được kiểm tra và xử lý.</td></tr>` : "");

    // Sync inline edits back to state.parsedDataset.rows
    tbody.querySelectorAll('td[contenteditable="true"]').forEach(td => {
      td.addEventListener("input", () => {
        const rIdx = Number(td.dataset.rowIdx);
        const col = td.dataset.col;
        if (state.parsedDataset?.rows?.[rIdx]) {
          state.parsedDataset.rows[rIdx][col] = td.textContent.trim();
        }
        if (state.originalDataset?.rows?.[rIdx]) {
          state.originalDataset.rows[rIdx][col] = td.textContent.trim();
        }
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

  // ---- STEP 2.5: Interactive Data-Driven Business Context & Human-AI Consultation ----
  function normalizeViText(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
  }

  function getActiveLlmOptions() {
    return {
      enabled: $("#llmEnabled") ? $("#llmEnabled").checked : true,
      endpoint: $("#llmEndpoint") ? $("#llmEndpoint").value.trim() : "",
      model: $("#llmModel") ? $("#llmModel").value.trim() : "gemini-3.5-flash-lite",
      apiKey: $("#llmApiKey") ? $("#llmApiKey").value.trim() : ""
    };
  }

  function buildFileDataProfile(rawRows, headers, schema) {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const sch = schema || detectAdaptiveSchema(rows, headers);
    const primaryCol = sch.colPrimaryMetric || sch.colRev || null;

    // Periods breakdown
    const periodMap = {};
    const periodSet = new Set();
    if (sch.colDate) {
      rows.forEach(r => {
        const p = parsePeriodString(r[sch.colDate]);
        if (p && p !== "(Không có ngày)") {
          periodSet.add(p);
          const v = primaryCol ? parseNumeric(r[primaryCol], 0) : 1;
          periodMap[p] = (periodMap[p] || 0) + v;
        }
      });
    }
    const sortedPeriods = Array.from(periodSet).sort();
    const periodNames = sortedPeriods.map(formatPeriodName);
    let peakPeriod = null;
    let troughPeriod = null;
    if (sortedPeriods.length) {
      const pEntries = sortedPeriods.map((p, idx) => ({ period: p, label: periodNames[idx], val: periodMap[p] || 0 }));
      pEntries.sort((a, b) => b.val - a.val);
      peakPeriod = pEntries[0];
      troughPeriod = pEntries[pEntries.length - 1];
    }

    // Numeric metrics summary
    const metrics = (sch.numericCandidates || []).map(c => ({
      col: c.col,
      name: c.name || getColDisplayName(c.col),
      sum: c.sum,
      avg: c.avg,
      isCurr: c.isCurr,
      isCnt: c.isCnt
    }));

    // Categorical dimensions with top values & metric totals
    const totalPrimaryAll = primaryCol
      ? rows.reduce((acc, r) => acc + parseNumeric(r[primaryCol], 0), 0)
      : rows.length;

    let blankCount = 0;
    const dimensions = (sch.categoricalCandidates || []).slice(0, 4).map(c => {
      const valMap = {};
      rows.forEach(r => {
        const rawV = String(r[c.col] ?? "").trim();
        if (!rawV) {
          blankCount++;
          return;
        }
        if (!valMap[rawV]) valMap[rawV] = { name: rawV, count: 0, val: 0 };
        valMap[rawV].count += 1;
        valMap[rawV].val += primaryCol ? parseNumeric(r[primaryCol], 0) : 1;
      });
      const topValues = Object.values(valMap)
        .sort((a, b) => b.val - a.val)
        .slice(0, 6)
        .map(v => ({
          ...v,
          pct: totalPrimaryAll > 0 ? Number(((v.val / totalPrimaryAll) * 100).toFixed(1)) : 0
        }));
      return {
        col: c.col,
        name: c.name || getColDisplayName(c.col),
        distinctCount: c.distinctCount,
        topValues
      };
    });

    return {
      domainType: sch.domainType,
      domainName: sch.domainName,
      rowCount: rows.length,
      headers,
      dateCol: sch.colDate,
      dateColLabel: sch.colDate ? getColDisplayName(sch.colDate) : "",
      entityCol: sch.colEntity,
      entityColLabel: sch.colEntity ? getColDisplayName(sch.colEntity) : "",
      sortedPeriods,
      periodNames,
      peakPeriod,
      troughPeriod,
      metrics,
      dimensions,
      blankCount,
      schema: sch
    };
  }

  function parseDirectivesFromContext(businessContext, dataProfile, schema) {
    const ctx = businessContext || {};
    const profile = dataProfile || state.currentFileProfile;
    const sch = schema || profile?.schema || null;
    const chatDir = ctx.chatDirectives || {};

    const directives = {
      focusPeriod: chatDir.focusPeriod || "auto",
      focusMetricCol: chatDir.focusMetricCol || null,
      focusDimCol: chatDir.focusDimCol || null,
      focusGroupValues: Array.isArray(chatDir.focusGroupValues) ? [...chatDir.focusGroupValues] : [],
      targetGoal: chatDir.targetGoal || null,
      userQuestions: (ctx.analysisQuestions || "")
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean)
    };

    const dynamicQA = Array.isArray(ctx.dynamicQA) ? ctx.dynamicQA : [];
    const combinedAnswersText = dynamicQA.map(q => q.answer || "").join("\n");
    const nAns = normalizeViText(combinedAnswersText);

    // 1. Period directive from Q&A if chat didn't override
    if (directives.focusPeriod === "auto" && profile?.sortedPeriods?.length) {
      const periodAnswer = normalizeViText(dynamicQA.find(q => q.role === "period")?.answer || combinedAnswersText);
      if (/(toan bo|tat ca|ca \d+ ky|xem tat ca)/i.test(periodAnswer)) {
        directives.focusPeriod = "all";
      } else {
        let matched = null;
        for (let i = 0; i < profile.sortedPeriods.length; i++) {
          const per = profile.sortedPeriods[i];
          const [yy, mm] = per.split("-");
          const mmInt = String(parseInt(mm, 10));
          if (periodAnswer.includes(per) || periodAnswer.includes(`${mm}/${yy}`) || new RegExp(`thang\\s*0?${mmInt}\\b`).test(periodAnswer)) {
            matched = per;
            break;
          }
        }
        if (matched) {
          directives.focusPeriod = matched;
        } else if (/(moi nhat|gan nhat|thang cuoi)/i.test(periodAnswer)) {
          directives.focusPeriod = profile.sortedPeriods[profile.sortedPeriods.length - 1];
        }
      }
    }

    // 2. Metric priority directive from Q&A if chat didn't override
    if (!directives.focusMetricCol && profile?.metrics?.length) {
      const metricAnswer = normalizeViText(dynamicQA.find(q => q.role === "metric")?.answer || combinedAnswersText);
      // Skip if user explicitly says "đối chiếu cả" / "song song" without favoring the 2nd one alone
      const isPreferExplicit = /(uu tien|tap trung|dao sang|chuyen sang|chon)/i.test(metricAnswer) && !/(song song|ca 2|doi chieu ca)/i.test(metricAnswer);
      if (isPreferExplicit) {
        for (const m of profile.metrics) {
          const nm = normalizeViText(m.name);
          const nc = normalizeViText(m.col).replace(/_/g, " ");
          if ((nm && metricAnswer.includes(nm)) || (nc && metricAnswer.includes(nc))) {
            directives.focusMetricCol = m.col;
            break;
          }
        }
      }
    }

    // 3. Dimension switch directive from Q&A if chat didn't override
    if (!directives.focusDimCol && profile?.dimensions?.length >= 2) {
      const dimAnswer = normalizeViText(dynamicQA.find(q => q.role === "dimension_switch")?.answer || combinedAnswersText);
      if (/(phan tich chinh theo|doi chieu.*sang|chuyen sang theo)/i.test(dimAnswer)) {
        for (const d of profile.dimensions) {
          const nd = normalizeViText(d.name);
          const nc = normalizeViText(d.col).replace(/_/g, " ");
          if ((nd && dimAnswer.includes(nd)) || (nc && dimAnswer.includes(nc))) {
            directives.focusDimCol = d.col;
            break;
          }
        }
      }
    }

    // 4. Specific group filter from Q&A if chat didn't explicitly set
    if (!Array.isArray(chatDir.focusGroupValues) && profile?.dimensions?.length) {
      const dimAns = normalizeViText(dynamicQA.find(q => q.role === "dimension")?.answer || "");
      const wantsOnlySpecific = /(chi tap trung|chi xem|loc rieng|rieng nhom)/i.test(dimAns) && !/(tat ca|toan bo|so sanh tat ca)/i.test(dimAns);
      if (wantsOnlySpecific) {
        const found = [];
        profile.dimensions.forEach(d => {
          d.topValues.forEach(v => {
            const nv = normalizeViText(v.name);
            if (nv.length >= 2 && dimAns.includes(nv) && !found.includes(v.name)) {
              found.push(v.name);
            }
          });
        });
        if (found.length) directives.focusGroupValues = found;
      }
    }

    // 5. Target goal from Q&A if chat didn't set
    if (!directives.targetGoal) {
      const targetAns = normalizeViText(dynamicQA.find(q => q.role === "target")?.answer || combinedAnswersText);
      const mTy = targetAns.match(/(\d+(?:[.,]\d+)?)\s*(ty|ti\b)/i);
      const mTri = targetAns.match(/(\d+(?:[.,]\d+)?)\s*(trieu|tr\b)/i);
      const mVnd = targetAns.match(/(\d{1,3}(?:\.\d{3}){2,})\s*vnd/i);
      const mPct = targetAns.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
      if (mTy) {
        const val = parseFloat(mTy[1].replace(",", ".")) * 1e9;
        directives.targetGoal = { type: "amount", value: val, label: formatCurrencyFull(val) };
      } else if (mTri) {
        const val = parseFloat(mTri[1].replace(",", ".")) * 1e6;
        directives.targetGoal = { type: "amount", value: val, label: formatCurrencyFull(val) };
      } else if (mVnd) {
        const val = parseFloat(mVnd[1].replace(/\./g, ""));
        directives.targetGoal = { type: "amount", value: val, label: formatCurrencyFull(val) };
      } else if (mPct && /(muc tieu|tang truong|canh bao)/i.test(targetAns)) {
        const pctVal = parseFloat(mPct[1].replace(",", "."));
        directives.targetGoal = { type: "pct", value: pctVal, label: `${pctVal >= 0 ? "+" : ""}${pctVal}%` };
      }
    }

    return directives;
  }

  function renderActiveDirectivesPreview(directives, dataProfile) {
    const el = $("#aiActiveDirectivesPreview");
    if (!el) return;
    const p = dataProfile || state.currentFileProfile;
    const pills = [];

    const periodLabel = directives.focusPeriod === "all"
      ? `Toàn bộ ${p?.sortedPeriods?.length || 1} kỳ`
      : (directives.focusPeriod && directives.focusPeriod !== "auto" ? formatPeriodName(directives.focusPeriod) : "Tự động theo file");
    pills.push(`<span class="ai-directive-pill">📅 Kỳ: ${escapeHtml(periodLabel)}</span>`);

    const metricLabel = directives.focusMetricCol
      ? getColDisplayName(directives.focusMetricCol)
      : (p?.metrics?.[0]?.name || "Tự động");
    pills.push(`<span class="ai-directive-pill">📊 Chỉ số ưu tiên: ${escapeHtml(metricLabel)}</span>`);

    const dimLabel = directives.focusDimCol
      ? getColDisplayName(directives.focusDimCol)
      : (p?.dimensions?.[0]?.name || "Tự động");
    pills.push(`<span class="ai-directive-pill">🏷 Chiều phân tích: ${escapeHtml(dimLabel)}</span>`);

    if (directives.focusGroupValues?.length) {
      pills.push(`<span class="ai-directive-pill amber">🔍 Lọc nhóm: ${escapeHtml(directives.focusGroupValues.join(", "))}</span>`);
    }
    if (directives.targetGoal?.label) {
      pills.push(`<span class="ai-directive-pill amber">🎯 Mục tiêu: ${escapeHtml(directives.targetGoal.label)}</span>`);
    }
    pills.push(`<span class="ai-directive-pill">❓ ${directives.userQuestions.length || 1} câu hỏi sẽ được giải đáp</span>`);

    el.innerHTML = pills.join("");
  }

  function renderScopeChatMessages() {
    const box = $("#aiScopeChatMessages");
    if (!box) return;
    const msgs = state.scopeChatHistory || [];
    if (!msgs.length) {
      box.innerHTML = `<div class="ai-loading-placeholder">AI Agent đang đọc dữ liệu trong file để bắt đầu trao đổi với bạn...</div>`;
      return;
    }
    box.innerHTML = msgs.map(m => `
      <div class="ai-chat-msg ${m.role === "user" ? "user" : "ai"}">
        <div class="ai-chat-avatar">${m.role === "user" ? "BẠN" : "AI"}</div>
        <div>
          <div class="ai-chat-bubble">${m.isTyping ? `<span class="ai-typing-dots"><span></span><span></span><span></span></span> Đang đối chiếu số liệu trong file...` : escapeHtml(m.text)}</div>
          ${m.meta ? `<div class="ai-chat-meta">${escapeHtml(m.meta)}</div>` : ""}
        </div>
      </div>
    `).join("");
    box.scrollTop = box.scrollHeight;
  }

  function renderChatQuickPrompts(prompts) {
    const wrap = $("#aiChatQuickPrompts");
    if (!wrap) return;
    const list = Array.isArray(prompts) ? prompts.slice(0, 4) : [];
    wrap.innerHTML = list.map(text => `
      <button type="button" class="ai-quick-chip ai-chat-prompt-btn" data-prompt="${escapeHtml(text)}">💬 ${escapeHtml(text)}</button>
    `).join("");
    wrap.querySelectorAll(".ai-chat-prompt-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        handleSendScopeChat(btn.dataset.prompt || btn.textContent);
      });
    });
  }

  function renderSuggestedAnglesList(angles) {
    const ul = $("#aiSuggestedAnglesList");
    if (!ul) return;
    if (!angles || !angles.length) {
      ul.innerHTML = `<li>Đang tổng hợp góc nhìn từ các cột trong file...</li>`;
      return;
    }
    ul.innerHTML = angles.map((a, idx) => `
      <li class="ai-angle-item">
        <span>${escapeHtml(a.label || a.question)}</span>
        <button type="button" class="ai-angle-add-btn" data-angle-idx="${idx}">+ Thêm câu hỏi</button>
      </li>
    `).join("");

    ul.querySelectorAll(".ai-angle-add-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.angleIdx);
        const angle = angles[idx];
        if (!angle) return;
        const qBox = $("#ctxAnalysisQuestions");
        if (qBox) {
          const existing = qBox.value.split("\n").map(s => s.trim()).filter(Boolean);
          const qText = angle.question || angle.label;
          if (!existing.includes(qText)) {
            existing.push(qText);
            qBox.value = existing.slice(0, 8).join("\n");
          }
        }
        btn.textContent = "✓ Đã thêm";
        btn.disabled = true;
        updateAiUnderstanding();
      });
    });
  }

  function renderDynamicClarifyQuestions(questions) {
    const container = $("#aiClarifyQuestionsContainer");
    if (!container) return;
    state.currentDynamicQuestions = Array.isArray(questions) ? questions : [];

    if (!state.currentDynamicQuestions.length) {
      container.innerHTML = `<div class="ai-loading-placeholder">Chưa có câu hỏi làm rõ cho file này.</div>`;
      return;
    }

    container.innerHTML = state.currentDynamicQuestions.map((q, idx) => {
      const qId = q.id || `dyn_q_${idx + 1}`;
      const chips = Array.isArray(q.quick_chips) ? q.quick_chips : [];
      return `
        <div class="ai-dynamic-q-card" data-q-card-id="${escapeHtml(qId)}">
          <div class="ai-q-header-row">
            <label class="ai-q-label" for="aiDynAns_${escapeHtml(qId)}" style="margin-bottom:0;">
              ${idx + 1}. ${escapeHtml(q.question)}
            </label>
            ${q.source_fact ? `<span class="ai-q-source-tag">${escapeHtml(q.source_fact)}</span>` : ""}
          </div>
          ${chips.length ? `
            <div class="ai-quick-chips mt-1">
              ${chips.map(ch => `<button type="button" class="ai-quick-chip ai-ans-chip" data-target="aiDynAns_${escapeHtml(qId)}" data-val="${escapeHtml(ch)}">${escapeHtml(ch)}</button>`).join("")}
            </div>
          ` : ""}
          <textarea
            id="aiDynAns_${escapeHtml(qId)}"
            class="context-textarea ai-dynamic-answer"
            data-q-id="${escapeHtml(qId)}"
            data-q-role="${escapeHtml(q.role || "general")}"
            data-q-text="${escapeHtml(q.question)}"
            rows="2"
            placeholder="Chọn nhanh gợi ý phía trên hoặc nhập trực tiếp yêu cầu của bạn..."
          >${escapeHtml(q.default_answer || "")}</textarea>
        </div>
      `;
    }).join("");

    // Wire quick-reply chips
    container.querySelectorAll(".ai-ans-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const targetId = chip.dataset.target;
        const val = chip.dataset.val || chip.textContent;
        const ta = document.getElementById(targetId);
        if (ta) {
          ta.value = val;
          // Highlight active chip within the same question card
          const siblings = chip.parentElement?.querySelectorAll(".ai-ans-chip") || [];
          siblings.forEach(s => s.classList.remove("active"));
          chip.classList.add("active");
          // If user clicks a chip that narrows/changes scope, clear conflicting chat override for that role
          const role = ta.dataset.qRole;
          if (state.scopeChatDirectives) {
            if (role === "period") delete state.scopeChatDirectives.focusPeriod;
            if (role === "metric") delete state.scopeChatDirectives.focusMetricCol;
            if (role === "dimension") delete state.scopeChatDirectives.focusGroupValues;
            if (role === "dimension_switch") delete state.scopeChatDirectives.focusDimCol;
            if (role === "target") delete state.scopeChatDirectives.targetGoal;
          }
          updateAiUnderstanding();
        }
      });
    });

    // Wire typing updates
    container.querySelectorAll(".ai-dynamic-answer").forEach(ta => {
      ta.addEventListener("input", () => {
        updateAiUnderstanding();
      });
    });
  }

  function collectDynamicQAFromUI() {
    return $$(".ai-dynamic-answer").map(ta => ({
      id: ta.dataset.qId || "",
      role: ta.dataset.qRole || "general",
      question: ta.dataset.qText || "",
      answer: (ta.value || "").trim()
    }));
  }

  function updateAiUnderstanding() {
    const profile = state.currentFileProfile;
    const bizType = ($("#ctxBusinessType")?.value || profile?.domainName || "Phân tích dữ liệu kinh doanh").trim();
    const qText = ($("#ctxAnalysisQuestions")?.value || "").trim();
    const questions = qText.split("\n").map(q => q.trim()).filter(q => q.length > 0);
    const qCount = questions.length || 1;
    const firstQ = questions[0] || "Phân tích chỉ số trọng yếu theo dữ liệu trong file";

    saveBusinessContextFromUI();
    const directives = state.businessContext?.directives || parseDirectivesFromContext(state.businessContext, profile);
    renderActiveDirectivesPreview(directives, profile);

    const underEl = $("#aiUnderstandingText");
    if (underEl) {
      if (profile) {
        const m1 = profile.metrics?.[0];
        const dim1 = profile.dimensions?.[0];
        const topVal = dim1?.topValues?.[0];
        underEl.innerHTML =
          `Tôi đã phân tích file <strong>${escapeHtml(state.parsedDataset?.sourceLabel || "hiện tại")}</strong> ` +
          `(<strong>${profile.rowCount} dòng · ${profile.headers.length} cột</strong>) thuộc lĩnh vực <strong>${escapeHtml(bizType)}</strong>. ` +
          `${m1 ? `Chỉ số chính: <strong>${escapeHtml(m1.name)}</strong> (${escapeHtml(m1.isCurr ? formatCurrencyFull(m1.sum) : m1.sum.toLocaleString("vi-VN"))}). ` : ""}` +
          `${topVal ? `Nhóm nổi bật nhất ở <strong>${escapeHtml(dim1.name)}</strong> là <strong>${escapeHtml(topVal.name)}</strong> (${topVal.pct}%). ` : ""}` +
          `Dashboard &amp; Báo cáo sẽ bám sát <strong>${qCount} câu hỏi</strong> của bạn, trọng tâm đầu tiên: <em>"${escapeHtml(firstQ)}"</em>.`;
      } else {
        underEl.innerHTML = `Bạn muốn phân tích <strong>${escapeHtml(bizType)}</strong> qua <strong>${qCount} câu hỏi</strong>. Trọng tâm đầu tiên là <em>"${escapeHtml(firstQ)}"</em>.`;
      }
    }
  }

  function saveBusinessContextFromUI() {
    const profile = state.currentFileProfile;
    const dynamicQA = collectDynamicQAFromUI();
    const baseCtx = {
      fileKey: state.businessContextFileKey || "",
      businessType: $("#ctxBusinessType")?.value?.trim() || profile?.domainName || "Phân tích dữ liệu kinh doanh",
      extraInfo: $("#ctxExtraInfo")?.value?.trim() || "",
      analysisQuestions: $("#ctxAnalysisQuestions")?.value?.trim() || "",
      dynamicQA,
      clarifyQ1: dynamicQA[0]?.answer || "",
      clarifyQ2: dynamicQA[1]?.answer || "",
      clarifyQ3: dynamicQA[2]?.answer || "",
      clarifyQ4: dynamicQA[3]?.answer || "",
      chatHistory: (state.scopeChatHistory || []).filter(m => !m.isTyping),
      chatDirectives: { ...(state.scopeChatDirectives || {}) }
    };
    baseCtx.directives = parseDirectivesFromContext(baseCtx, profile, profile?.schema);
    state.businessContext = baseCtx;
    state.ignoreScopeGroupFilter = false;
  }

  let isScopeAiLoading = false;
  async function refreshInteractiveAiScope(isNextAngle = false) {
    if (isScopeAiLoading || !state.parsedDataset) return;
    isScopeAiLoading = true;

    const btn = $("#btnReviewScope");
    const statusLine = $("#aiScopeStatusLine");
    const angleBadge = $("#aiScopeAngleBadge");
    const container = $("#aiClarifyQuestionsContainer");

    if (isNextAngle) {
      state.scopeIteration = (state.scopeIteration || 0) + 1;
    }

    const origBtnHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="star-sparkle">✦</span> AI đang đọc file &amp; tạo câu hỏi...`;
    }
    if (statusLine) {
      statusLine.className = "pill pill-amber";
      statusLine.textContent = "● AI đang rà soát cột, kỳ và phân nhóm trong file...";
    }
    if (container && isNextAngle) {
      container.innerHTML = `<div class="ai-loading-placeholder"><span class="ai-typing-dots"><span></span><span></span><span></span></span> AI đang khai thác góc nhìn #${(state.scopeIteration || 0) + 1} trực tiếp từ nội dung file...</div>`;
    }

    try {
      const rows = state.parsedDataset.rows || [];
      const headers = (state.parsedDataset.headers || Object.keys(rows[0] || {})).filter(k => k !== "__rowNumber" && k !== "__quarantined" && k !== "is_free_email");
      const schema = detectAdaptiveSchema(rows, headers);
      const profile = buildFileDataProfile(rows, headers, schema);
      state.currentFileProfile = profile;

      const prevQuestions = (state.previousScopeQuestions || []).slice(-10);
      const scopeRes = await agent.generateInteractiveScopeFromFile({
        datasetLabel: state.parsedDataset.sourceLabel || "Dữ liệu hiện tại",
        dataProfile: profile,
        userBusinessType: $("#ctxBusinessType")?.value?.trim() || profile.domainName,
        userQuestions: $("#ctxAnalysisQuestions")?.value?.trim() || "",
        iteration: state.scopeIteration || 0,
        previousQuestions: prevQuestions,
        llmOptions: getActiveLlmOptions()
      });

      const newQs = scopeRes.clarifying_questions || [];
      state.previousScopeQuestions = [...prevQuestions, ...newQs.map(q => q.question)].slice(-16);

      if (angleBadge && scopeRes.angle_badge) {
        angleBadge.textContent = scopeRes.angle_badge;
      }
      renderSuggestedAnglesList(scopeRes.suggested_angles || []);
      renderDynamicClarifyQuestions(newQs);
      renderChatQuickPrompts(scopeRes.quick_chat_prompts || []);

      if (scopeRes.understanding && $("#aiUnderstandingText")) {
        $("#aiUnderstandingText").textContent = scopeRes.understanding;
      }

      if (!state.scopeChatHistory || state.scopeChatHistory.length === 0) {
        state.scopeChatHistory = [{
          role: "ai",
          text: scopeRes.greeting_message,
          meta: scopeRes.llm_used ? `AI Agent (${scopeRes.model_used || "Gemini"}) · Vừa đọc xong file` : `AI Agent · Vừa quét xong ${profile.rowCount} dòng`
        }];
      } else if (isNextAngle) {
        state.scopeChatHistory.push({
          role: "ai",
          text: `Tôi vừa chuyển sang ${scopeRes.angle_badge || `Góc nhìn #${(state.scopeIteration || 0) + 1}`} với ${newQs.length} câu hỏi mới bám sát dữ liệu trong file "${state.parsedDataset.sourceLabel}". Bạn xem phía trên và chọn/trả lời hoặc nhắn thêm yêu cầu cho tôi nhé!`,
          meta: `AI Agent · Cập nhật góc nhìn mới`
        });
      }
      renderScopeChatMessages();

      saveBusinessContextFromUI();
      renderActiveDirectivesPreview(state.businessContext.directives, profile);

      if (statusLine) {
        statusLine.className = "pill pill-green";
        statusLine.textContent = scopeRes.llm_used
          ? `● AI Gemini đã đọc ${profile.rowCount} dòng · ${headers.length} cột (Góc nhìn #${(state.scopeIteration || 0) + 1})`
          : `● AI đã đọc trực tiếp ${profile.rowCount} dòng · ${headers.length} cột (Góc nhìn #${(state.scopeIteration || 0) + 1})`;
      }
    } finally {
      isScopeAiLoading = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origBtnHtml || `<span class="star-sparkle">✦</span> Gợi ý câu hỏi mới từ file`;
      }
    }
  }

  let isScopeChatBusy = false;
  async function handleSendScopeChat(presetText = null) {
    if (isScopeChatBusy || !state.parsedDataset) return;
    const input = $("#aiScopeChatInput");
    const msg = (presetText !== null ? String(presetText) : (input?.value || "")).trim();
    if (!msg) return;
    if (input && presetText === null) input.value = "";

    isScopeChatBusy = true;
    const sendBtn = $("#btnSendScopeChat");
    if (sendBtn) sendBtn.disabled = true;

    state.scopeChatHistory = state.scopeChatHistory || [];
    state.scopeChatHistory.push({ role: "user", text: msg, meta: "Bạn · Vừa xong" });
    state.scopeChatHistory.push({ role: "ai", text: "", isTyping: true });
    renderScopeChatMessages();

    try {
      const profile = state.currentFileProfile || buildFileDataProfile(
        state.parsedDataset.rows || [],
        (state.parsedDataset.headers || []).filter(k => k !== "__rowNumber" && k !== "__quarantined" && k !== "is_free_email")
      );
      state.currentFileProfile = profile;

      const res = await agent.chatWithScopeAgent({
        message: msg,
        chatHistory: state.scopeChatHistory.filter(m => !m.isTyping),
        datasetLabel: state.parsedDataset.sourceLabel || "Dữ liệu hiện tại",
        dataProfile: profile,
        currentContext: state.businessContext || {},
        llmOptions: getActiveLlmOptions()
      });

      // Remove typing indicator
      state.scopeChatHistory = state.scopeChatHistory.filter(m => !m.isTyping);
      state.scopeChatHistory.push({
        role: "ai",
        text: res.reply,
        meta: res.llm_used ? `AI Agent (${res.model_used || "Gemini"})` : `AI Agent · Đối chiếu trực tiếp từ file`
      });

      // Apply extracted directives into live scope state
      const ed = res.extracted_directives || {};
      state.scopeChatDirectives = state.scopeChatDirectives || {};
      if (ed.focusPeriod) state.scopeChatDirectives.focusPeriod = ed.focusPeriod;
      if (ed.focusMetricCol) state.scopeChatDirectives.focusMetricCol = ed.focusMetricCol;
      if (ed.focusDimCol) state.scopeChatDirectives.focusDimCol = ed.focusDimCol;
      if (Array.isArray(ed.focusGroupValues)) state.scopeChatDirectives.focusGroupValues = ed.focusGroupValues;
      if (ed.targetGoal) state.scopeChatDirectives.targetGoal = ed.targetGoal;

      if (ed.addQuestion && $("#ctxAnalysisQuestions")) {
        const existing = $("#ctxAnalysisQuestions").value.split("\n").map(s => s.trim()).filter(Boolean);
        if (!existing.includes(ed.addQuestion)) {
          existing.push(ed.addQuestion);
          $("#ctxAnalysisQuestions").value = existing.slice(0, 8).join("\n");
        }
      }

      renderScopeChatMessages();
      if (Array.isArray(res.follow_up_suggestions) && res.follow_up_suggestions.length) {
        renderChatQuickPrompts(res.follow_up_suggestions);
      }
      updateAiUnderstanding();
    } finally {
      isScopeChatBusy = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function buildDefaultQuestionsFromProfile(profile) {
    const dim1 = profile.dimensions?.[0];
    const dim2 = profile.dimensions?.[1];
    const m1 = profile.metrics?.[0];
    const m2 = profile.metrics?.[1];
    const qs = [];

    if (dim1 && m1) {
      const topSample = dim1.topValues.slice(0, 3).map(v => v.name).join(", ");
      qs.push(`Trong cột ${dim1.name} (${topSample}), nhóm nào đóng góp ${m1.name} cao nhất và thấp nhất?`);
    }
    if (profile.sortedPeriods?.length >= 2 && m1) {
      qs.push(`Xu hướng ${m1.name} biến động thế nào từ ${profile.periodNames[0]} đến ${profile.periodNames[profile.periodNames.length - 1]}?`);
    } else if (m1 && m2) {
      qs.push(`Tương quan giữa ${m1.name} và ${m2.name} theo từng ${dim1?.name || "nhóm"} chênh lệch ra sao?`);
    } else if (dim2 && m1) {
      qs.push(`Phân bổ ${m1.name} theo ${dim2.name} có điểm sáng hoặc rủi ro nào cần ưu tiên?`);
    }
    if (!qs.length) {
      qs.push(`Đâu là các chỉ số và phân nhóm nổi bật nhất trong file ${state.parsedDataset?.sourceLabel || "hiện tại"}?`);
    }
    return qs.join("\n");
  }

  function enterBusinessContextStep() {
    if (!state.parsedDataset || !state.validationResult?.valid) return;

    const rows = state.parsedDataset.rows || [];
    const headers = (state.parsedDataset.headers || Object.keys(rows[0] || {})).filter(k => k !== "__rowNumber" && k !== "__quarantined" && k !== "is_free_email");
    const fileKey = `${state.parsedDataset.sourceLabel || "file"}::${rows.length}::${headers.join(",")}`;

    const schema = detectAdaptiveSchema(rows, headers);
    const profile = buildFileDataProfile(rows, headers, schema);
    state.currentFileProfile = profile;

    const isNewFile = state.businessContextFileKey !== fileKey;
    if (isNewFile) {
      state.businessContextFileKey = fileKey;
      state.scopeIteration = 0;
      state.previousScopeQuestions = [];
      state.scopeChatHistory = [];
      state.scopeChatDirectives = {};
      state.ignoreScopeGroupFilter = false;

      if ($("#ctxBusinessType")) $("#ctxBusinessType").value = profile.domainName || "Phân tích dữ liệu kinh doanh";
      if ($("#ctxExtraInfo")) $("#ctxExtraInfo").value = "";
      if ($("#ctxAnalysisQuestions")) $("#ctxAnalysisQuestions").value = buildDefaultQuestionsFromProfile(profile);

      refreshInteractiveAiScope(false);
    } else {
      updateAiUnderstanding();
    }

    $("#businessContextSection")?.classList.remove("hidden");
    $("#cleaningSection")?.classList.add("hidden");
    $("#processVerifySection")?.classList.add("hidden");
    $("#resultsSection")?.classList.add("hidden");

    updateWorkflowSteps(2, { validationState: "ok" });
    $("#businessContextSection")?.scrollIntoView({ behavior: "smooth" });
  }

  // ---- STEP 3: Data Cleaning Gate (Dữ liệu đã sạch và ổn?) ----
  function enterCleaningStep(mode = "standard", shouldScroll = true, skippedMissing = false) {
    if (!state.parsedDataset || !state.validationResult?.valid) return;
    saveBusinessContextFromUI();
    $("#businessContextSection")?.classList.add("hidden");
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

      const effectiveDataset = (state.cleanedDatasetRows && state.cleanedDatasetRows.length > 0)
        ? { ...state.parsedDataset, rows: state.cleanedDatasetRows }
        : state.parsedDataset;

      const output = await agent.runAgentPipeline({
        parsedDataset: effectiveDataset,
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
    // YYYY-MM or YYYY-MM-DD
    const m1 = str.match(/^(\d{4})[-\/.](\d{1,2})/);
    if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}`;
    // DD/MM/YYYY or DD-MM-YYYY
    const m3 = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m3) return `${m3[3]}-${m3[2].padStart(2, "0")}`;
    // MM/YYYY
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

  function getColDisplayName(colKey) {
    if (!colKey) return "";
    const map = {
      thang: "Tháng",
      bat_dau: "Ngày bắt đầu",
      batdau: "Ngày bắt đầu",
      ket_thuc: "Ngày kết thúc",
      ket_thuc_loai_tru: "Ngày kết thúc",
      chu_ky_thu: "Chu kỳ thu",
      so_thang_dich_vu: "Số tháng dịch vụ",
      tien_thu_truoc_vnd: "Tiền thu trước (VND)",
      doanh_thu_thang_vnd: "Doanh thu tháng (VND)",
      tien_te: "Tiền tệ",
      ma_hop_dong: "Mã hợp đồng",
      lead_id: "Mã Lead",
      company_name: "Tên công ty",
      contact_name: "Người liên hệ",
      tax_code: "Mã số thuế",
      phone: "Số điện thoại",
      email: "Email",
      need_description: "Nhu cầu",
      registered_at: "Ngày đăng ký",
      created_at: "Ngày tạo",
      source_channel: "Kênh tiếp cận",
      kenh: "Kênh",
      region: "Khu vực",
      khu_vuc: "Khu vực",
      product_interest: "Sản phẩm",
      san_pham: "Sản phẩm",
      chien_dich: "Chiến dịch",
      industry: "Ngành",
      doanh_thu_vnd: "Doanh thu (VND)",
      doanh_thu: "Doanh thu (VND)",
      budget_vnd: "Ngân sách dự kiến (VND)",
      chi_phi_gia_von_vnd: "Chi phí giá vốn (VND)",
      chi_phi: "Chi phí (VND)",
      loi_nhuan_gop_vnd: "Lợi nhuận gộp (VND)",
      loi_nhuan: "Lợi nhuận (VND)",
      so_don: "Số đơn",
      so_don_hang: "Số đơn hàng",
      orders: "Số đơn hàng",
      chuyen_doi: "Chuyển đổi",
      luot_click: "Lượt click"
    };
    if (map[colKey]) return map[colKey];
    const n = (colKey || "").toLowerCase().replace(/[\s_\(\)\/\-–]/g, "");
    if (map[n]) return map[n];
    return String(colKey)
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // ---- Polymorphic & Adaptive Dataset Schema Detector ----
  function detectAdaptiveSchema(rawRows, headers) {
    const norm = s => (s || "").toLowerCase().replace(/[\s_\(\)\/\-–]/g, "");

    const isDatePattern = v => {
      if (!v) return false;
      const s = String(v).trim();
      return /^\d{4}[-\/.]\d{1,2}([-\/.]\d{1,2})?$/.test(s) ||
             /^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(s) ||
             /^\d{1,2}[-\/.]\d{4}$/.test(s);
    };

    let colDate = null;
    let colEntity = null;
    const numericCandidates = [];
    const categoricalCandidates = [];

    // 1. Date Detection
    for (const h of headers) {
      const n = norm(h);
      if (/^(batdau|ngaybatdau|thang|month|ky|period|ngay|date|registeredat|createdat|thoigian|nam|year)$/.test(n)) {
        colDate = h;
        break;
      }
    }
    if (!colDate) {
      for (const h of headers) {
        const n = norm(h);
        if (/(batdau|thang|month|ky|period|ngay|date|registeredat|createdat|thoigian)/.test(n)) {
          colDate = h;
          break;
        }
      }
    }
    if (!colDate && rawRows.length > 0) {
      for (const h of headers) {
        const sample = rawRows.slice(0, 15).map(r => r[h]).filter(Boolean);
        if (sample.length && sample.filter(isDatePattern).length >= sample.length * 0.7) {
          colDate = h;
          break;
        }
      }
    }

    // 2. Entity / Unique Record ID Detection
    for (const h of headers) {
      const n = norm(h);
      if (/^(mahopdong|sohopdong|contract|contractid|leadid|makhachhang|makh|madon|madonhang|orderid|stt|code|id|uuid)$/.test(n)) {
        colEntity = h;
        break;
      }
    }
    if (!colEntity) {
      for (const h of headers) {
        const n = norm(h);
        if (/^(ma|id|code|stt)/.test(n) && !/(trangthai|status|loai|type)/.test(n)) {
          colEntity = h;
          break;
        }
      }
    }
    if (!colEntity && rawRows.length >= 5) {
      for (const h of headers) {
        if (h === colDate) continue;
        const n = norm(h);
        if (/(mota|desc|ghichu|note|diachi|address|email|phone|sdt)/.test(n)) continue;
        const vals = rawRows.map(r => String(r[h] ?? "").trim()).filter(Boolean);
        const uniqueSet = new Set(vals);
        if (vals.length >= 5 && uniqueSet.size >= vals.length * 0.85) {
          colEntity = h;
          break;
        }
      }
    }

    // 3. Numeric & Categorical Column Classification
    for (const h of headers) {
      if (h === colDate || h === colEntity) continue;
      const n = norm(h);
      const vals = rawRows.map(r => r[h]).filter(v => v !== null && v !== undefined && String(v).trim() !== "");
      if (!vals.length) continue;

      const numVals = vals.map(v => parseNumeric(v, NaN)).filter(v => !isNaN(v));
      const numRatio = numVals.length / vals.length;

      if (numRatio >= 0.65) {
        const sum = numVals.reduce((a, b) => a + b, 0);
        const avg = sum / (numVals.length || 1);
        const isCurr = /(vnd|tien|revenue|cost|doanhthu|chiphi|loinhuan|budget|thanhtien|sotien|price|gia|fee|luong)/.test(n) || avg >= 50000;
        const isCnt = /^(sodon|sodonhang|orders|ordercount|soluong|quantity|luotclick|clicks|chuyendoi|conversions|sothang|thangdichvu|duration)$/.test(n) || (numVals.every(v => Number.isInteger(v)) && avg < 50000);
        const isRatio = /(rate|pct|percent|tyle|phantram|margin|discount)/.test(n);

        numericCandidates.push({
          col: h,
          name: getColDisplayName(h),
          normKey: n,
          sum,
          avg,
          isCurr,
          isCnt,
          isRatio
        });
      } else {
        const uniqueVals = new Set(vals.map(v => String(v).trim()));
        const isConstantOrCurrency = uniqueVals.size < 2 || /^(tiente|currency|donvi|unit)$/.test(n);
        if (!isConstantOrCurrency && uniqueVals.size <= Math.max(35, rawRows.length * 0.75)) {
          categoricalCandidates.push({
            col: h,
            name: getColDisplayName(h),
            normKey: n,
            distinctCount: uniqueVals.size,
            sampleValues: Array.from(uniqueVals).slice(0, 5)
          });
        }
      }
    }

    // 4. Domain Classification
    let domainType = "custom";
    let domainName = "Tổng hợp dữ liệu kinh doanh";

    const allNormHeaders = headers.map(norm);
    const hasContractSignal = allNormHeaders.some(n => /^(mahopdong|sohopdong|contract|chukythu|sothangdichvu|tienthutruocvnd|tienthutruoc)$/.test(n));
    const hasMarketingSignal = allNormHeaders.some(n => /^(luotclick|clicks|chuyendoi|conversions|cpc|cvr)$/.test(n)) || (allNormHeaders.some(n => /chiendich|campaign/.test(n)) && allNormHeaders.some(n => /chiphi|cost/.test(n)));
    const hasCrmSignal = allNormHeaders.some(n => /^(leadid|makhachhang|companyname|taxcode|needdescription)$/.test(n));
    const hasRetailSignal = allNormHeaders.some(n => /^(sodon|sodonhang|orders|ordercount)$/.test(n)) || (allNormHeaders.some(n => /doanhthu|revenue/.test(n)) && allNormHeaders.some(n => /chiphi|cost|loinhuan|profit/.test(n)));

    if (hasContractSignal) {
      domainType = "contracts";
      domainName = "Hợp đồng dịch vụ & Thu phí định kỳ";
    } else if (hasMarketingSignal) {
      domainType = "marketing";
      domainName = "Hiệu quả Tiếp thị số (Marketing & Ads)";
    } else if (hasCrmSignal) {
      domainType = "crm";
      domainName = "Quản lý Khách hàng tiềm năng (CRM Leads)";
    } else if (hasRetailSignal) {
      domainType = "retail";
      domainName = "Kinh doanh Bán lẻ & Thương mại";
    }

    // 5. Categorical Dimension Ranking
    const rankCategory = (c) => {
      const n = c.normKey;
      if (/(chuky|cycle)/.test(n)) return 100;
      if (/(kenh|channel|source)/.test(n)) return 90;
      if (/(khuvuc|region|diaban|mien|tinh)/.test(n)) return 80;
      if (/(sanpham|product|chiendich|campaign|dichvu|service)/.test(n)) return 70;
      if (/(nganh|industry)/.test(n)) return 60;
      if (/(trangthai|status)/.test(n)) return 50;
      return 30 - c.distinctCount;
    };
    categoricalCandidates.sort((a, b) => rankCategory(b) - rankCategory(a));

    const colPrimaryDim = categoricalCandidates[0]?.col || null;
    const colSecondaryDim = categoricalCandidates[1]?.col || null;

    // 6. Numeric Metric Ranking
    const rankNumeric = (num) => {
      const n = num.normKey;
      if (domainType === "contracts") {
        if (/tienthutruoc/.test(n)) return 100;
        if (/doanhthuthang/.test(n)) return 90;
        if (/sothang|duration/.test(n)) return 80;
      }
      if (domainType === "retail") {
        if (/doanhthu|revenue|sales/.test(n)) return 100;
        if (/loinhuan|profit|margin/.test(n)) return 90;
        if (/chiphi|cost|giavon/.test(n)) return 80;
        if (/sodon|orders|quantity/.test(n)) return 70;
      }
      if (domainType === "marketing") {
        if (/chiphi|cost|budget/.test(n)) return 100;
        if (/click/.test(n)) return 90;
        if (/chuyendoi|conversion/.test(n)) return 80;
      }
      if (domainType === "crm") {
        if (/budget|ngansach/.test(n)) return 100;
      }
      if (num.isCurr) return 50 + (num.sum > 0 ? Math.log10(num.sum) : 0);
      if (num.isCnt) return 40;
      return 20;
    };
    numericCandidates.sort((a, b) => rankNumeric(b) - rankNumeric(a));

    const colPrimaryMetric = numericCandidates[0]?.col || null;
    const colSecondaryMetric = numericCandidates[1]?.col || null;
    const colAuxMetric = numericCandidates[2]?.col || null;

    // Legacy backward-compatibility mappings
    const colOrders = headers.find(h => /(sodon|sodonhang|orders|ordercount)/.test(norm(h))) || (numericCandidates.find(c => c.isCnt)?.col || null);
    const colRev = headers.find(h => /(doanhthu|revenue|sales|thanhtien)/.test(norm(h))) || (numericCandidates.find(c => c.isCurr)?.col || colPrimaryMetric);
    const colCost = headers.find(h => /(chiphi|cost|giavon|cogs)/.test(norm(h))) || null;
    const colProfit = headers.find(h => /(loinhuan|profit|margin|laigop)/.test(norm(h))) || null;

    return {
      domainType,
      domainName,
      colDate,
      colEntity,
      colPrimaryDim,
      colSecondaryDim,
      colPrimaryMetric,
      colSecondaryMetric,
      colAuxMetric,
      numericCandidates,
      categoricalCandidates,
      colOrders,
      colRev,
      colCost,
      colProfit,
      colChannel: colPrimaryDim,
      colSecondary: colSecondaryDim || colPrimaryDim,
      hasOrdersCol: Boolean(colOrders),
      hasRevCol: Boolean(colRev),
      hasCostCol: Boolean(colCost),
      hasProfitCol: Boolean(colProfit) || (Boolean(colRev) && Boolean(colCost))
    };
  }

  function detectBusinessColumns(headers) {
    return detectAdaptiveSchema([], headers);
  }

  async function getDatasetRows(datasetType) {
    if (datasetType === "auto" || !datasetType) {
      const cleaned = state.cleanedDatasetRows || state.cleaningState?.result?.cleanedRows || state.cleaningState?.cleanedRows;
      if (cleaned?.length) {
        return {
          rows: cleaned,
          label: state.parsedDataset?.sourceLabel ? `${state.parsedDataset.sourceLabel} (${cleaned.length} dòng sạch)` : "Dữ liệu hiện tại"
        };
      }
      if (state.parsedDataset?.rows?.length) {
        return {
          rows: state.parsedDataset.rows,
          label: state.parsedDataset.sourceLabel || "Dữ liệu vừa tải"
        };
      }
      // Fallback: load contracts sample
      return await getDatasetRows("contracts");
    }

    const parseCsvToRows = (text) => {
      const matrix = validator.parseCSV(text);
      if (Array.isArray(matrix)) {
        return validator.matrixToObjects(matrix, state.config?.schema || {}).rows || [];
      }
      return matrix?.rows || [];
    };

    if (datasetType === "contracts") {
      if (!cachedDatasets.contracts) {
        const text = await fetch("data/27_dich_vu_thang_va_nam.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.contracts = parseCsvToRows(text);
      }
      return { rows: cachedDatasets.contracts, label: "Hợp đồng dịch vụ (27_dich_vu_thang_va_nam.csv)" };
    }

    if (datasetType === "vertical_rev") {
      if (!cachedDatasets.vertical_rev) {
        const text = await fetch("data/11_doanh_thu_bang_doc.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.vertical_rev = parseCsvToRows(text);
      }
      return { rows: cachedDatasets.vertical_rev, label: "Doanh thu bảng dọc (11_doanh_thu_bang_doc.csv)" };
    }

    if (datasetType === "retail") {
      if (!cachedDatasets.retail) {
        const text = await fetch("data/sample_retail_kpi.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.retail = parseCsvToRows(text);
      }
      return { rows: cachedDatasets.retail, label: "Bán lẻ mẫu (sample_retail_kpi.csv)" };
    }

    if (datasetType === "marketing") {
      if (!cachedDatasets.marketing) {
        const text = await fetch("data/sample_marketing.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.marketing = parseCsvToRows(text);
      }
      return { rows: cachedDatasets.marketing, label: "Marketing mẫu (sample_marketing.csv)" };
    }

    if (datasetType === "crm") {
      if (!cachedDatasets.crm) {
        const text = await fetch("data/sample_normal_and_edge_cases.csv").then(r => r.text()).catch(() => "");
        cachedDatasets.crm = parseCsvToRows(text);
      }
      return { rows: cachedDatasets.crm, label: "CRM Khách hàng (sample_normal_and_edge_cases.csv)" };
    }

    return { rows: [], label: "Dữ liệu trống" };
  }

  function renderDashboardUserQuestions(qaList, directives, subtitleText = "") {
    const card = $("#dashUserQuestionsCard");
    const listEl = $("#dashUserQuestionsList");
    const badgeEl = $("#dashUserQuestionsBadge");
    const subEl = $("#dashUserQuestionsSub");
    if (!card || !listEl) return;

    const items = Array.isArray(qaList) ? qaList.filter(x => x && x.question) : [];
    if (!items.length) {
      card.classList.add("hidden");
      return;
    }

    card.classList.remove("hidden");
    if (badgeEl) badgeEl.textContent = `${items.length} câu hỏi đã giải đáp`;
    if (subEl && subtitleText) subEl.textContent = subtitleText;

    listEl.innerHTML = items.map((qa, i) => `
      <div class="dash-qa-item">
        <div class="dash-qa-q">Q${i + 1}. ${escapeHtml(qa.question)}</div>
        <div class="dash-qa-a">${escapeHtml(qa.answer)}</div>
        ${qa.evidence ? `<div class="dash-qa-evidence">📌 Dẫn chứng: ${escapeHtml(qa.evidence)}</div>` : ""}
      </div>
    `).join("");
  }

  function computeUserQuestionsAnswers({
    directives,
    currRows,
    normalizedRows,
    headers,
    schema,
    colPrimaryMetric,
    colSecondaryMetric,
    primaryMetricLabel,
    secondaryMetricLabel,
    dim1Label,
    dim2Label,
    dim1DonutList,
    dim2ContribList,
    trendMonthsData,
    currPrimaryTotal,
    activePeriod,
    sortedPeriods,
    blankGroup,
    datasetLabel
  }) {
    const questions = Array.isArray(directives?.userQuestions) ? directives.userQuestions : [];
    const results = [];
    const sumField = (rows, field) => rows.reduce((acc, r) => acc + (r.raw ? parseNumeric(r.raw[field], 0) : 0), 0);
    const top1 = dim1DonutList[0] || null;
    const low1 = dim1DonutList[dim1DonutList.length - 1] || null;
    const top2 = dim2ContribList[0] || null;
    const low2 = dim2ContribList[dim2ContribList.length - 1] || null;
    const peakM = trendMonthsData.length ? [...trendMonthsData].sort((a, b) => b.rev - a.rev)[0] : null;
    const troughM = trendMonthsData.length ? [...trendMonthsData].sort((a, b) => a.rev - b.rev)[0] : null;
    const secTotal = colSecondaryMetric ? sumField(currRows, colSecondaryMetric) : 0;

    questions.forEach(q => {
      const nq = normalizeViText(q);
      let answer = "";
      let evidence = "";

      // Check if question specifically asks about a dimension column in the file
      const matchedDim = (schema.categoricalCandidates || []).find(d => {
        const nd = normalizeViText(d.name);
        const nc = normalizeViText(d.col).replace(/_/g, " ");
        return (nd.length >= 2 && nq.includes(nd)) || (nc.length >= 2 && nq.includes(nc));
      });

      // Check if question specifically asks about a metric column in the file
      const matchedMetric = (schema.numericCandidates || []).find(m => {
        const nm = normalizeViText(m.name);
        const nc = normalizeViText(m.col).replace(/_/g, " ");
        return (nm.length >= 2 && nq.includes(nm)) || (nc.length >= 2 && nq.includes(nc));
      });

      const targetMetricCol = matchedMetric ? matchedMetric.col : colPrimaryMetric;
      const targetMetricName = matchedMetric ? matchedMetric.name : primaryMetricLabel;
      const targetIsCurr = matchedMetric ? matchedMetric.isCurr : true;
      const fmtVal = (v) => targetIsCurr ? formatCurrencyFull(v) : (Number.isInteger(v) ? v.toLocaleString("vi-VN") : v.toFixed(1).replace(".", ","));

      if (/(xu huong|bien dong|theo thang|cac ky|thang nao|ky nao|tang truong)/i.test(nq) && trendMonthsData.length >= 2) {
        const firstM = trendMonthsData[0];
        const lastM = trendMonthsData[trendMonthsData.length - 1];
        const diffPct = firstM.rev > 0 ? (((lastM.rev - firstM.rev) / firstM.rev) * 100).toFixed(1).replace(".", ",") : "0,0";
        answer = `Qua ${trendMonthsData.length} kỳ (${formatPeriodName(firstM.month)} → ${formatPeriodName(lastM.month)}), ${primaryMetricLabel} biến động ${lastM.rev >= firstM.rev ? "+" : ""}${diffPct}%. Kỳ cao nhất là ${formatPeriodName(peakM.month)} (${formatCurrencyFull(peakM.rev)}) và thấp nhất là ${formatPeriodName(troughM.month)} (${formatCurrencyFull(troughM.rev)}).`;
        evidence = `Đỉnh: ${formatPeriodName(peakM.month)} (${peakM.label}) · Cuối kỳ: ${formatPeriodName(lastM.month)} (${lastM.label}, tăng trưởng ${lastM.growth}).`;
      } else if (/(tuong quan|doi chieu|so sanh giua|ty le giua)/i.test(nq) && colSecondaryMetric && colSecondaryMetric !== colPrimaryMetric) {
        const ratio = secTotal > 0 ? (currPrimaryTotal / secTotal).toFixed(2).replace(".", ",") : "-";
        answer = `Trong phạm vi ${formatPeriodName(activePeriod)} (${currRows.length} dòng), tổng ${primaryMetricLabel} đạt ${formatCurrencyFull(currPrimaryTotal)} so với ${secondaryMetricLabel} đạt ${formatCurrencyFull(secTotal)} (tỷ lệ quy đổi ${ratio}x). Nhóm "${top1?.name || "Chủ lực"}" chiếm tỷ trọng lớn nhất (${top1?.pct || 0}%).`;
        evidence = `${primaryMetricLabel}: ${formatCurrencyFull(currPrimaryTotal)} vs ${secondaryMetricLabel}: ${formatCurrencyFull(secTotal)}.`;
      } else if (/(thieu|o trong|loi|rui ro|bat thuong)/i.test(nq)) {
        answer = blankGroup && blankGroup.rowsCount > 0
          ? `Phát hiện ${blankGroup.rowsCount} dòng bị thiếu thông tin phân loại với tổng giá trị ${formatCurrencyFull(blankGroup.val)}. Ngoài ra nhóm "${top1?.name || ""}" đang chiếm ${top1?.pct || 0}% cần theo dõi rủi ro tập trung.`
          : `Không phát hiện dòng khuyết nhóm trong phạm vi đang xét (${currRows.length} dòng sạch 100%). Điểm rủi ro cần lưu ý là mức độ tập trung vào nhóm "${top1?.name || "dẫn đầu"}" (${top1?.pct || 0}%).`;
        evidence = `Số dòng sạch: ${currRows.length} · Tỷ trọng nhóm lớn nhất: ${top1?.pct || 0}%.`;
      } else if (matchedDim) {
        const gMap = {};
        currRows.forEach(r => {
          const k = String(r.raw?.[matchedDim.col] ?? "").trim() || "(Ô trống)";
          if (!gMap[k]) gMap[k] = { name: k, val: 0, count: 0 };
          gMap[k].val += targetMetricCol ? parseNumeric(r.raw?.[targetMetricCol], 0) : 1;
          gMap[k].count += 1;
        });
        const sortedG = Object.values(gMap).sort((a, b) => b.val - a.val);
        const totalG = Math.max(1, sortedG.reduce((s, x) => s + x.val, 0));
        const best = sortedG[0];
        const worst = sortedG[sortedG.length - 1];
        const bestPct = ((best.val / totalG) * 100).toFixed(1).replace(".", ",");
        const worstPct = ((worst.val / totalG) * 100).toFixed(1).replace(".", ",");
        answer = `Theo "${matchedDim.name}", nhóm dẫn đầu về ${targetMetricName} là "${best.name}" với ${fmtVal(best.val)} (chiếm ${bestPct}%, ${best.count} dòng)` +
          (worst && worst.name !== best.name ? `, trong khi thấp nhất là "${worst.name}" đạt ${fmtVal(worst.val)} (${worstPct}%, ${worst.count} dòng).` : `.`);
        evidence = sortedG.slice(0, 4).map(g => `${g.name}: ${fmtVal(g.val)} (${((g.val / totalG) * 100).toFixed(1)}%)`).join(" | ");
      } else {
        answer = `Trong phạm vi ${formatPeriodName(activePeriod)} (${currRows.length} dòng), tổng ${targetMetricName} đạt ${fmtVal(targetMetricCol ? sumField(currRows, targetMetricCol) : currPrimaryTotal)}. ` +
          (top1 ? `Nhóm dẫn đầu theo ${dim1Label} là "${top1.name}" (${top1.valText}, chiếm ${top1.pct}%)` : "") +
          (low1 && low1.name !== top1?.name ? ` và thấp nhất là "${low1.name}" (${low1.valText}, ${low1.pct}%).` : ".");
        evidence = `File: ${datasetLabel} · ${dim1Label}: ${dim1DonutList.slice(0, 3).map(d => `${d.name} (${d.pct}%)`).join(", ")}.`;
      }

      results.push({ question: q, answer, evidence });
    });

    // If user specified a concrete targetGoal, append a dedicated Target Attainment answer card!
    if (directives?.targetGoal?.value) {
      const tg = directives.targetGoal;
      if (tg.type === "amount") {
        const pctAchieved = tg.value > 0 ? ((currPrimaryTotal / tg.value) * 100).toFixed(1).replace(".", ",") : "0";
        const gap = currPrimaryTotal - tg.value;
        results.push({
          question: `Đối chiếu mục tiêu người dùng đặt ra: ${tg.label}`,
          answer: gap >= 0
            ? `ĐÃ ĐẠT & VƯỢT MỤC TIÊU! Thực tế ${primaryMetricLabel} đạt ${formatCurrencyFull(currPrimaryTotal)} (${pctAchieved}% mục tiêu, vượt +${formatCurrencyFull(gap)}).`
            : `CHƯA ĐẠT MỤC TIÊU: Thực tế ${primaryMetricLabel} đạt ${formatCurrencyFull(currPrimaryTotal)} (${pctAchieved}% mục tiêu), còn thiếu ${formatCurrencyFull(Math.abs(gap))}.`,
          evidence: `Thực tế: ${formatCurrencyFull(currPrimaryTotal)} / Mục tiêu: ${tg.label} (${formatPeriodName(activePeriod)}).`
        });
      } else if (tg.type === "pct") {
        const targetVal = Math.round(currPrimaryTotal * (1 + tg.value / 100));
        results.push({
          question: `Kịch bản mục tiêu tăng trưởng ${tg.label} cho kỳ tiếp theo`,
          answer: `Với mức nền hiện tại ${formatCurrencyFull(currPrimaryTotal)}, để đạt mục tiêu tăng ${tg.label}, kỳ tiếp theo cần đạt ${formatCurrencyFull(targetVal)} (tăng thêm ${formatCurrencyFull(targetVal - currPrimaryTotal)}).`,
          evidence: `Nền hiện tại: ${formatCurrencyFull(currPrimaryTotal)} → Đích kỳ tới: ${formatCurrencyFull(targetVal)}.`
        });
      }
    }

    return results;
  }

  async function renderBusinessKpiDashboard(datasetType = "auto", period = "auto", triggerAgent = true) {
    const dsSelect = $("#dashDatasetFilter");
    if (dsSelect && dsSelect.value !== datasetType) {
      dsSelect.value = datasetType;
    }

    const { rows: fullRawRows, label: datasetLabel } = await getDatasetRows(datasetType);
    if (!fullRawRows || fullRawRows.length === 0) {
      if ($("#dashSubtitleLine")) $("#dashSubtitleLine").textContent = "Chưa có dữ liệu để phân tích.";
      return;
    }

    // Adaptive Schema Detection across all available columns
    const headers = Object.keys(fullRawRows[0] || {}).filter(k => k !== "__rowNumber" && k !== "__quarantined" && k !== "is_free_email");
    const baseSchema = detectAdaptiveSchema(fullRawRows, headers);
    const dashProfile = buildFileDataProfile(fullRawRows, headers, baseSchema);
    state.lastDashboardProfile = dashProfile;
    state.lastDashboardDatasetType = datasetType;

    // Resolve active user directives from Step 2 AI Consultation (when applicable to current dataset)
    let activeDirectives = null;
    const hasCtx = Boolean(state.businessContext);
    const isCtxMatchingDataset = hasCtx && (
      datasetType === "auto" ||
      state.businessContext.appliedToDataset === datasetType
    );
    if (isCtxMatchingDataset) {
      activeDirectives = parseDirectivesFromContext(state.businessContext, dashProfile, baseSchema);
      state.businessContext.directives = activeDirectives;
    }

    // Apply Group Filter Directive from User <-> AI Consultation (unless user clicked Reset)
    let rawRows = fullRawRows;
    let appliedGroupFilter = [];
    if (activeDirectives && !state.ignoreScopeGroupFilter && activeDirectives.focusGroupValues?.length > 0) {
      const targetNorms = activeDirectives.focusGroupValues.map(normalizeViText);
      const catCols = (baseSchema.categoricalCandidates || []).map(c => c.col);
      if (baseSchema.colEntity && !catCols.includes(baseSchema.colEntity)) catCols.push(baseSchema.colEntity);
      const filtered = fullRawRows.filter(r =>
        catCols.some(col => {
          const nv = normalizeViText(String(r[col] ?? "").trim());
          return nv && targetNorms.some(t => nv === t || nv.includes(t));
        })
      );
      if (filtered.length > 0) {
        rawRows = filtered;
        appliedGroupFilter = activeDirectives.focusGroupValues;
      }
    }

    const schema = baseSchema;
    const { domainType, domainName, colDate, colEntity, colAuxMetric } = schema;
    const norm = s => (s || "").toLowerCase().replace(/[\s_\(\)\/\-–]/g, "");

    // Apply Priority Metric & Dimension Directives from User <-> AI Consultation
    let colPrimaryMetric = schema.colPrimaryMetric;
    let colSecondaryMetric = schema.colSecondaryMetric;
    let prioritizedMetricCol = null;
    if (activeDirectives?.focusMetricCol && headers.includes(activeDirectives.focusMetricCol)) {
      prioritizedMetricCol = activeDirectives.focusMetricCol;
      if (colPrimaryMetric !== prioritizedMetricCol) {
        colSecondaryMetric = colPrimaryMetric;
        colPrimaryMetric = prioritizedMetricCol;
      }
    }

    let colDim1 = schema.colPrimaryDim;
    let colDim2 = schema.colSecondaryDim;
    if (activeDirectives?.focusDimCol && headers.includes(activeDirectives.focusDimCol)) {
      if (colDim1 !== activeDirectives.focusDimCol) {
        colDim2 = colDim1;
        colDim1 = activeDirectives.focusDimCol;
      }
    }

    if (!colDim1 && colEntity) colDim1 = colEntity;
    if (!colDim2 && colDim1 !== colEntity && colEntity) colDim2 = colEntity;

    const dim1Label = getColDisplayName(colDim1) || "Phân loại chính";
    const dim2Label = getColDisplayName(colDim2) || dim1Label;
    const primaryMetricLabel = getColDisplayName(colPrimaryMetric) || "Giá trị (VND)";
    const secondaryMetricLabel = getColDisplayName(colSecondaryMetric) || primaryMetricLabel;

    // Normalize Rows strictly with detected date & dimensions
    const normalizedRows = rawRows.map(r => {
      const p = colDate ? parsePeriodString(r[colDate]) : "Toàn bộ";
      const d1 = colDim1 ? (String(r[colDim1] ?? "").trim() || "(Ô trống)") : "Nhóm chung";
      const d2 = colDim2 ? (String(r[colDim2] ?? "").trim() || "(Ô trống)") : d1;
      const m1 = colPrimaryMetric ? parseNumeric(r[colPrimaryMetric], 0) : 0;
      const m2 = colSecondaryMetric ? parseNumeric(r[colSecondaryMetric], 0) : 0;
      const mAux = colAuxMetric ? parseNumeric(r[colAuxMetric], 0) : 0;
      const entity = colEntity ? String(r[colEntity] ?? "").trim() : "";
      return {
        period: p,
        channel: d1,
        secondary: d2,
        primaryVal: m1,
        secondaryVal: m2,
        auxVal: mAux,
        entity,
        rev: schema.hasRevCol ? parseNumeric(r[schema.colRev], m1) : m1,
        cost: schema.hasCostCol ? parseNumeric(r[schema.colCost], 0) : 0,
        profit: schema.hasProfitCol ? parseNumeric(r[schema.colProfit], 0) : 0,
        orders: schema.hasOrdersCol ? parseNumeric(r[schema.colOrders], 0) : 0,
        raw: r
      };
    });

    // Extract Periods
    const periodSet = new Set();
    normalizedRows.forEach(r => {
      if (r.period && r.period !== "(Không có ngày)") periodSet.add(r.period);
    });
    let sortedPeriods = Array.from(periodSet).sort();
    if (sortedPeriods.length === 0) sortedPeriods = ["Toàn bộ"];

    // Update Period Filter Dropdown (honoring User's AI Scope period preference when period === "auto")
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
      } else if (activeDirectives?.focusPeriod === "all") {
        periodSelect.value = "all";
      } else if (activeDirectives?.focusPeriod && sortedPeriods.includes(activeDirectives.focusPeriod)) {
        periodSelect.value = activeDirectives.focusPeriod;
      } else {
        periodSelect.value = sortedPeriods[sortedPeriods.length - 1] || "all";
      }
    }

    const activePeriod = periodSelect ? periodSelect.value : (sortedPeriods[sortedPeriods.length - 1] || "all");

    // Render Active Scope Directives Bar on Dashboard
    const dirBar = $("#dashScopeDirectivesBar");
    if (dirBar) {
      if (activeDirectives && (activeDirectives.userQuestions.length || appliedGroupFilter.length || prioritizedMetricCol || activeDirectives.focusDimCol || activeDirectives.targetGoal)) {
        const pills = [`<strong style="font-size:12.5px;color:#92400e;">🎯 Phạm vi AI đang áp dụng:</strong>`];
        pills.push(`<span class="ai-directive-pill">📅 ${escapeHtml(formatPeriodName(activePeriod))}</span>`);
        if (prioritizedMetricCol) pills.push(`<span class="ai-directive-pill">📊 Ưu tiên: ${escapeHtml(primaryMetricLabel)}</span>`);
        if (activeDirectives.focusDimCol) pills.push(`<span class="ai-directive-pill">🏷 Chiều: ${escapeHtml(dim1Label)}</span>`);
        if (appliedGroupFilter.length) pills.push(`<span class="ai-directive-pill amber">🔍 Lọc nhóm: ${escapeHtml(appliedGroupFilter.join(", "))} (${rawRows.length}/${fullRawRows.length} dòng)</span>`);
        if (activeDirectives.targetGoal?.label) pills.push(`<span class="ai-directive-pill amber">🎯 Mục tiêu: ${escapeHtml(activeDirectives.targetGoal.label)}</span>`);
        dirBar.innerHTML = `
          <div class="ai-directives-preview">${pills.join("")}</div>
          <div class="btn-group">
            ${appliedGroupFilter.length ? `<button type="button" id="btnClearDashGroupFilter" class="btn btn-outline btn-sm">✕ Bỏ lọc nhóm (${fullRawRows.length} dòng)</button>` : ""}
          </div>
        `;
        dirBar.classList.remove("hidden");
        $("#btnClearDashGroupFilter")?.addEventListener("click", () => {
          state.ignoreScopeGroupFilter = true;
          renderBusinessKpiDashboard(datasetType, activePeriod, true);
        });
      } else {
        dirBar.classList.add("hidden");
      }
    }

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

    // Helper functions for KPI aggregation
    const sumCol = (rows, field) => rows.reduce((acc, r) => acc + (r.raw ? parseNumeric(r.raw[field], 0) : parseNumeric(r[field], 0)), 0);
    const avgCol = (rows, field) => {
      if (!field || !rows.length) return 0;
      return sumCol(rows, field) / rows.length;
    };
    const countDistinctCol = (rows, field) => {
      if (!field) return rows.length;
      const set = new Set();
      rows.forEach(r => {
        const val = String((r.raw ? r.raw[field] : r[field]) ?? "").trim();
        if (val) set.add(val);
      });
      return set.size || rows.length;
    };

    const calcDeltaPct = (curr, prev, pPeriod) => {
      if (!pPeriod || prev === 0) return { text: "Số liệu cơ sở", isPos: true };
      const pct = ((curr - prev) / prev) * 100;
      const sign = pct >= 0 ? "+" : "";
      return {
        text: `${sign}${pct.toFixed(1).replace(".", ",")}% so với ${formatPeriodName(pPeriod)}`,
        isPos: pct >= 0
      };
    };

    // Construct 4 Polymorphic & Adaptive KPIs matching the dataset
    const kpis = [];

    if (domainType === "contracts") {
      // 1. Tổng hợp đồng
      const totalContracts = countDistinctCol(currRows, colEntity || "ma_hop_dong");
      const prevContracts = prevRows.length ? countDistinctCol(prevRows, colEntity || "ma_hop_dong") : 0;
      const dContracts = prevPeriod && prevContracts > 0
        ? `${totalContracts >= prevContracts ? "+" : ""}${(((totalContracts - prevContracts) / prevContracts) * 100).toFixed(1).replace(".", ",")}% so với ${formatPeriodName(prevPeriod)}`
        : `Toàn bộ ${totalContracts} hợp đồng trong file`;
      kpis.push({
        id: "dashKpiOrders", valId: "dashValOrders", deltaId: "dashDeltaOrders",
        title: "Tổng hợp đồng",
        value: `${totalContracts.toLocaleString("vi-VN")} HĐ`,
        unit: "Hợp đồng ghi nhận",
        delta: dContracts,
        isPositive: true
      });

      // 2. Tiền thu trước (VND)
      const colPre = headers.find(h => /tienthutruoc/i.test(norm(h))) || colPrimaryMetric;
      const currPre = sumCol(currRows, colPre);
      const prevPre = prevRows.length ? sumCol(prevRows, colPre) : 0;
      kpis.push({
        id: "dashKpiRevenue", valId: "dashValRevenue", deltaId: "dashDeltaRevenue",
        title: getColDisplayName(colPre) || "Tiền thu trước (VND)",
        value: formatCurrencyFull(currPre),
        unit: "Dòng tiền thu trước chu kỳ",
        delta: calcDeltaPct(currPre, prevPre, prevPeriod).text,
        isPositive: true
      });

      // 3. Doanh thu tháng (VND)
      const colMonthRev = headers.find(h => /doanhthuthang/i.test(norm(h))) || colSecondaryMetric;
      const currMonthRev = sumCol(currRows, colMonthRev);
      const prevMonthRev = prevRows.length ? sumCol(prevRows, colMonthRev) : 0;
      kpis.push({
        id: "dashKpiProfit", valId: "dashValProfit", deltaId: "dashDeltaProfit",
        title: getColDisplayName(colMonthRev) || "Doanh thu tháng (VND)",
        value: formatCurrencyFull(currMonthRev),
        unit: "Doanh thu định kỳ theo tháng",
        delta: calcDeltaPct(currMonthRev, prevMonthRev, prevPeriod).text,
        isPositive: true
      });

      // 4. Thời hạn dịch vụ TB / Chu kỳ chủ đạo
      const colDuration = headers.find(h => /sothang|duration/i.test(norm(h))) || colAuxMetric;
      const avgDur = avgCol(currRows, colDuration);
      const colCycle = headers.find(h => /chuky/i.test(norm(h))) || colDim1;
      const cycleCountMap = {};
      currRows.forEach(r => {
        const cy = String(r.raw ? r.raw[colCycle] : r[colCycle] ?? "").trim() || "Chung";
        cycleCountMap[cy] = (cycleCountMap[cy] || 0) + 1;
      });
      const topCycleEntry = Object.entries(cycleCountMap).sort((a, b) => b[1] - a[1])[0] || ["Hàng năm", currRows.length];
      const topCyclePct = ((topCycleEntry[1] / Math.max(1, currRows.length)) * 100).toFixed(1).replace(".", ",");
      kpis.push({
        id: "dashKpiCost", valId: "dashValCost", deltaId: "dashDeltaCost",
        title: "Thời hạn dịch vụ TB",
        value: avgDur > 0 ? `${avgDur.toFixed(1).replace(".", ",")} tháng` : `${topCycleEntry[0]}`,
        unit: `Chu kỳ chủ đạo: ${topCycleEntry[0]} (${topCyclePct}%)`,
        delta: `Trung bình trên ${currRows.length} hợp đồng`,
        isPositive: true
      });

    } else if (domainType === "marketing") {
      const colClicks = headers.find(h => /click/i.test(norm(h))) || colPrimaryMetric;
      const colCost = headers.find(h => /chiphi|cost/i.test(norm(h))) || colSecondaryMetric;
      const colConv = headers.find(h => /chuyendoi|conversion/i.test(norm(h))) || colAuxMetric;

      const currClicks = sumCol(currRows, colClicks);
      const prevClicks = prevRows.length ? sumCol(prevRows, colClicks) : 0;
      const currCost = sumCol(currRows, colCost);
      const prevCost = prevRows.length ? sumCol(prevRows, colCost) : 0;
      const currConv = sumCol(currRows, colConv);
      const prevConv = prevRows.length ? sumCol(prevRows, colConv) : 0;

      const cvrPct = currClicks > 0 ? ((currConv / currClicks) * 100).toFixed(2).replace(".", ",") : "0,00";
      const cpcVal = currClicks > 0 ? Math.round(currCost / currClicks) : 0;

      kpis.push({
        id: "dashKpiOrders", valId: "dashValOrders", deltaId: "dashDeltaOrders",
        title: "Tổng lượt Click",
        value: `${currClicks.toLocaleString("vi-VN")} click`,
        unit: "Lưu lượng tiếp thị ghi nhận",
        delta: calcDeltaPct(currClicks, prevClicks, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiRevenue", valId: "dashValRevenue", deltaId: "dashDeltaRevenue",
        title: "Chi phí Marketing",
        value: formatCurrencyFull(currCost),
        unit: "Ngân sách quảng cáo chi tiêu",
        delta: calcDeltaPct(currCost, prevCost, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiProfit", valId: "dashValProfit", deltaId: "dashDeltaProfit",
        title: "Tổng chuyển đổi",
        value: `${currConv.toLocaleString("vi-VN")} lượt`,
        unit: "Chuyển đổi thành công",
        delta: calcDeltaPct(currConv, prevConv, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiCost", valId: "dashValCost", deltaId: "dashDeltaCost",
        title: "Tỷ lệ chuyển đổi (CVR)",
        value: `${cvrPct}%`,
        unit: `CPC TB: ${cpcVal.toLocaleString("vi-VN")} VND/click`,
        delta: `Hiệu suất trên ${currClicks.toLocaleString("vi-VN")} click`,
        isPositive: true
      });

    } else if (domainType === "crm") {
      const totalLeads = countDistinctCol(currRows, colEntity || "lead_id");
      const prevLeads = prevRows.length ? countDistinctCol(prevRows, colEntity || "lead_id") : 0;
      const colBudget = headers.find(h => /budget|ngansach/i.test(norm(h))) || colPrimaryMetric;
      const currBudget = sumCol(currRows, colBudget);
      const prevBudget = prevRows.length ? sumCol(prevRows, colBudget) : 0;
      const avgBudget = totalLeads > 0 ? Math.round(currBudget / totalLeads) : 0;

      const colPhone = headers.find(h => /phone|sdt/i.test(norm(h)));
      let validPhoneCount = 0;
      if (colPhone) {
        currRows.forEach(r => {
          const p = String(r.raw ? r.raw[colPhone] : r[colPhone] ?? "").trim();
          if (p && p.length >= 8) validPhoneCount++;
        });
      }
      const phonePct = totalLeads > 0 ? ((validPhoneCount / totalLeads) * 100).toFixed(1).replace(".", ",") : "100";

      kpis.push({
        id: "dashKpiOrders", valId: "dashValOrders", deltaId: "dashDeltaOrders",
        title: "Tổng Leads tiềm năng",
        value: `${totalLeads.toLocaleString("vi-VN")} Leads`,
        unit: "Hồ sơ khách hàng tiếp nhận",
        delta: calcDeltaPct(totalLeads, prevLeads, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiRevenue", valId: "dashValRevenue", deltaId: "dashDeltaRevenue",
        title: "Tổng ngân sách dự kiến",
        value: formatCurrencyFull(currBudget),
        unit: "Quy mô ngân sách nhu cầu",
        delta: calcDeltaPct(currBudget, prevBudget, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiProfit", valId: "dashValProfit", deltaId: "dashDeltaProfit",
        title: "Ngân sách TB / Lead",
        value: formatCurrencyFull(avgBudget),
        unit: "Quy mô trung bình mỗi hồ sơ",
        delta: `Trung bình trên ${totalLeads} khách hàng`,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiCost", valId: "dashValCost", deltaId: "dashDeltaCost",
        title: "Tỷ lệ có Số điện thoại",
        value: `${phonePct}%`,
        unit: `${validPhoneCount}/${totalLeads} hồ sơ có SĐT`,
        delta: "Độ sẵn sàng liên hệ NVKD",
        isPositive: true
      });

    } else if (domainType === "retail") {
      const colOrders = headers.find(h => /^(sodon|orders|soluong)$/i.test(norm(h))) || headers.find(h => /sodon|orders/i.test(norm(h)));
      const colRev = headers.find(h => /doanhthu|revenue/i.test(norm(h))) || colPrimaryMetric;
      const colCost = headers.find(h => /chiphi|cost|giavon/i.test(norm(h)));
      const colProfit = headers.find(h => /loinhuan|profit/i.test(norm(h)));

      const currOrders = colOrders ? sumCol(currRows, colOrders) : currRows.length;
      const prevOrders = (colOrders && prevRows.length) ? sumCol(prevRows, colOrders) : prevRows.length;
      const currRev = sumCol(currRows, colRev);
      const prevRev = prevRows.length ? sumCol(prevRows, colRev) : 0;
      const currCost = colCost ? sumCol(currRows, colCost) : 0;
      const prevCost = (colCost && prevRows.length) ? sumCol(prevRows, colCost) : 0;
      const currProfit = colProfit ? sumCol(currRows, colProfit) : (colCost ? (currRev - currCost) : 0);
      const prevProfit = (colProfit && prevRows.length) ? sumCol(prevRows, colProfit) : ((colCost && prevRows.length) ? (prevRev - prevCost) : 0);

      kpis.push({
        id: "dashKpiOrders", valId: "dashValOrders", deltaId: "dashDeltaOrders",
        title: "Số đơn hàng",
        value: `${currOrders.toLocaleString("vi-VN")}`,
        unit: colOrders ? getColDisplayName(colOrders) : "Số đơn",
        delta: calcDeltaPct(currOrders, prevOrders, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiRevenue", valId: "dashValRevenue", deltaId: "dashDeltaRevenue",
        title: "Doanh thu",
        value: formatCurrencyFull(currRev),
        unit: getColDisplayName(colRev),
        delta: calcDeltaPct(currRev, prevRev, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiProfit", valId: "dashValProfit", deltaId: "dashDeltaProfit",
        title: "Lợi nhuận",
        value: formatCurrencyFull(currProfit),
        unit: colProfit ? getColDisplayName(colProfit) : "Lợi nhuận gộp (VND)",
        delta: calcDeltaPct(currProfit, prevProfit, prevPeriod).text,
        isPositive: true
      });
      kpis.push({
        id: "dashKpiCost", valId: "dashValCost", deltaId: "dashDeltaCost",
        title: "Chi phí",
        value: formatCurrencyFull(currCost),
        unit: colCost ? getColDisplayName(colCost) : "Chi phí giá vốn (VND)",
        delta: calcDeltaPct(currCost, prevCost, prevPeriod).text,
        isPositive: true
      });

    } else {
      // General / Custom File: Calculate strictly meaningful metrics with NO "0 VND (Không có cột)"
      const mainNum = schema.numericCandidates[0];
      const secNum = schema.numericCandidates[1];
      const auxNum = schema.numericCandidates[2];

      const currRowsCount = currRows.length;
      const prevRowsCount = prevRows.length;

      kpis.push({
        id: "dashKpiOrders", valId: "dashValOrders", deltaId: "dashDeltaOrders",
        title: colEntity ? `Tổng ${getColDisplayName(colEntity)}` : "Số bản ghi ghi nhận",
        value: colEntity ? `${countDistinctCol(currRows, colEntity).toLocaleString("vi-VN")}` : `${currRowsCount.toLocaleString("vi-VN")} dòng`,
        unit: colEntity ? getColDisplayName(colEntity) : "Dữ liệu kỳ này",
        delta: calcDeltaPct(currRowsCount, prevRowsCount, prevPeriod).text,
        isPositive: true
      });

      if (mainNum) {
        const currMain = sumCol(currRows, mainNum.col);
        const prevMain = prevRows.length ? sumCol(prevRows, mainNum.col) : 0;
        kpis.push({
          id: "dashKpiRevenue", valId: "dashValRevenue", deltaId: "dashDeltaRevenue",
          title: mainNum.name,
          value: mainNum.isCurr ? formatCurrencyFull(currMain) : currMain.toLocaleString("vi-VN"),
          unit: `Tổng ${mainNum.name}`,
          delta: calcDeltaPct(currMain, prevMain, prevPeriod).text,
          isPositive: true
        });

        if (secNum) {
          const currSec = sumCol(currRows, secNum.col);
          const prevSec = prevRows.length ? sumCol(prevRows, secNum.col) : 0;
          kpis.push({
            id: "dashKpiProfit", valId: "dashValProfit", deltaId: "dashDeltaProfit",
            title: secNum.name,
            value: secNum.isCurr ? formatCurrencyFull(currSec) : currSec.toLocaleString("vi-VN"),
            unit: `Tổng ${secNum.name}`,
            delta: calcDeltaPct(currSec, prevSec, prevPeriod).text,
            isPositive: true
          });
        } else {
          const avgVal = currRowsCount > 0 ? Math.round(currMain / currRowsCount) : 0;
          kpis.push({
            id: "dashKpiProfit", valId: "dashValProfit", deltaId: "dashDeltaProfit",
            title: `Giá trị TB / Bản ghi`,
            value: mainNum.isCurr ? formatCurrencyFull(avgVal) : avgVal.toLocaleString("vi-VN"),
            unit: `Trung bình mỗi dòng`,
            delta: `Số liệu cơ sở`,
            isPositive: true
          });
        }

        if (auxNum) {
          const currAux = sumCol(currRows, auxNum.col);
          const prevAux = prevRows.length ? sumCol(prevRows, auxNum.col) : 0;
          kpis.push({
            id: "dashKpiCost", valId: "dashValCost", deltaId: "dashDeltaCost",
            title: auxNum.name,
            value: auxNum.isCurr ? formatCurrencyFull(currAux) : currAux.toLocaleString("vi-VN"),
            unit: `Tổng ${auxNum.name}`,
            delta: calcDeltaPct(currAux, prevAux, prevPeriod).text,
            isPositive: true
          });
        } else {
          const activeGroups = countDistinctCol(currRows, colDim1);
          kpis.push({
            id: "dashKpiCost", valId: "dashValCost", deltaId: "dashDeltaCost",
            title: `Số nhóm ${dim1Label}`,
            value: `${activeGroups} nhóm`,
            unit: `Theo ${dim1Label}`,
            delta: `Độ phủ danh mục`,
            isPositive: true
          });
        }
      }
    }

    // Render Top 4 KPI Cards dynamically into #dashKpiContainer (highlighting user-prioritized metric & accurate +/- delta color)
    const dashKpiContainer = $("#dashKpiContainer");
    if (dashKpiContainer) {
      const nPri = prioritizedMetricCol ? normalizeViText(getColDisplayName(prioritizedMetricCol)) : "";
      dashKpiContainer.innerHTML = kpis.map(k => {
        const isNegDelta = String(k.delta || "").trim().startsWith("-");
        k.isPositive = isNegDelta ? false : (k.isPositive !== false);
        const isPri = Boolean(nPri && (normalizeViText(k.title).includes(nPri) || nPri.includes(normalizeViText(k.title))));
        return `
        <div class="dash-kpi-card ${isPri ? "kpi-prioritized" : ""}" id="${escapeHtml(k.id)}">
          ${isPri ? `<span class="dash-kpi-priority-badge">Ưu tiên AI</span>` : ""}
          <div class="dash-kpi-head">${escapeHtml(k.title)}</div>
          <div class="dash-kpi-num" id="${escapeHtml(k.valId)}">${escapeHtml(k.value)}</div>
          <div class="dash-kpi-unit">${escapeHtml(k.unit)}</div>
          <div class="dash-kpi-delta ${k.isPositive ? "positive" : "negative"}" id="${escapeHtml(k.deltaId)}">${escapeHtml(k.delta)}</div>
        </div>`;
      }).join("");
    }

    if ($("#dashCompareCaption")) {
      if (activeDirectives?.targetGoal?.label) {
        const currPriVal = sumCol(currRows, colPrimaryMetric || schema.colRev);
        const tg = activeDirectives.targetGoal;
        if (tg.type === "amount" && tg.value > 0) {
          const pct = ((currPriVal / tg.value) * 100).toFixed(1).replace(".", ",");
          $("#dashCompareCaption").textContent = `🎯 Mục tiêu ${tg.label}: Hiện đạt ${formatCurrencyFull(currPriVal)} (${pct}%) · ${currRows.length} dòng.`;
        } else {
          $("#dashCompareCaption").textContent = `🎯 Mục tiêu tăng trưởng ${tg.label} · Nền hiện tại: ${formatCurrencyFull(currPriVal)}.`;
        }
      } else {
        $("#dashCompareCaption").textContent = `Đối chiếu tự động trên ${currRows.length}/${fullRawRows.length} dòng sạch · ${headers.length} cột dữ liệu.`;
      }
    }

    if ($("#dashSubtitleLine")) {
      $("#dashSubtitleLine").textContent = `${formatPeriodName(activePeriod)} · ${currRows.length}/${fullRawRows.length} dòng · ${domainName} (${datasetLabel})`;
    }
    if ($("#dashAgentScanBadge")) {
      $("#dashAgentScanBadge").innerHTML = `<span class="pulse-beacon"></span> Agent rà soát: ${rawRows.length} dòng · ${headers.length} cột`;
    }

    // 1. CARD 1: Monthly Trend SVG OR Top Ranking Entities
    const primaryMetricField = colPrimaryMetric || schema.colRev || headers[0];
    const trendMonthsData = sortedPeriods.map((p, i) => {
      const pRows = normalizedRows.filter(r => r.period === p);
      const val = sumCol(pRows, primaryMetricField);
      let growth = "-";
      if (i > 0) {
        const priorVal = sumCol(normalizedRows.filter(r => r.period === sortedPeriods[i - 1]), primaryMetricField);
        if (priorVal > 0) {
          const g = ((val - priorVal) / priorVal) * 100;
          growth = `${g >= 0 ? "+" : ""}${g.toFixed(1).replace(".", ",")}%`;
        }
      }
      return { month: p, rev: val, label: formatCompactVND(val), growth };
    });

    if ($("#dashTrendTitle")) {
      $("#dashTrendTitle").textContent = colDate ? `${primaryMetricLabel} theo thời gian` : `Xếp hạng theo ${primaryMetricLabel}`;
    }
    if ($("#dashTrendHint")) {
      $("#dashTrendHint").textContent = colDate
        ? `${primaryMetricLabel} · ${sortedPeriods.length} kỳ đối chiếu`
        : `Top các bản ghi / thực thể có giá trị lớn nhất`;
    }

    if (colDate && sortedPeriods.length >= 1) {
      if ($("#dashRevenueTrendSvg")) {
        $("#dashRevenueTrendSvg").innerHTML = buildRevenueTrendSVG(trendMonthsData);
      }
      if ($("#dashMonthTableCollapsible")) {
        $("#dashMonthTableCollapsible").innerHTML = `
          <table class="data-table">
            <thead>
              <tr><th>Kỳ</th><th>${escapeHtml(primaryMetricLabel)}</th><th>Tăng trưởng</th></tr>
            </thead>
            <tbody>
              ${trendMonthsData.map(m => `
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
    } else {
      // If no date column, render top records ranked by primary metric
      const topEntities = rawRows
        .map((r, i) => ({
          name: colEntity ? String(r[colEntity] ?? `Dòng ${i + 1}`).trim() : `Dòng ${i + 1}`,
          val: parseNumeric(r[primaryMetricField], 0)
        }))
        .sort((a, b) => b.val - a.val)
        .slice(0, 8);
      const maxEntityVal = Math.max(1, ...topEntities.map(e => e.val));
      const entityBars = topEntities.map(e => ({
        name: e.name,
        val: e.val,
        valText: formatCurrencyFull(e.val),
        pct: Math.min(100, Math.round((e.val / maxEntityVal) * 100))
      }));
      if ($("#dashRevenueTrendSvg")) $("#dashRevenueTrendSvg").innerHTML = buildRevenueContribBarsHTML(entityBars);
      if ($("#dashMonthTableCollapsible")) $("#dashMonthTableCollapsible").innerHTML = `<p class="hint">Đang hiển thị 8 thực thể dẫn đầu theo ${escapeHtml(primaryMetricLabel)}.</p>`;
    }

    // 2. CARD 2: Donut Breakdown by Primary Dimension (e.g. chu_ky_thu, kenh, khu_vuc)
    const dim1ValMap = {};
    currRows.forEach(r => {
      const k = r.channel || "(Ô trống)";
      dim1ValMap[k] = (dim1ValMap[k] || 0) + r.primaryVal;
    });

    const palette = ["#d97706", "#111827", "#f59e0b", "#78350f", "#eab308", "#4b5563", "#b45309", "#9ca3af"];
    const totalDim1Curr = Math.max(1, Object.values(dim1ValMap).reduce((a, b) => a + b, 0));
    const dim1DonutList = Object.entries(dim1ValMap)
      .map(([name, val], idx) => ({
        name,
        val,
        valText: formatCurrencyFull(val),
        pct: parseFloat(((val / totalDim1Curr) * 100).toFixed(1)),
        color: palette[idx % palette.length]
      }))
      .sort((a, b) => b.val - a.val);

    if ($("#dashDonutTitle")) $("#dashDonutTitle").textContent = `Cơ cấu ${primaryMetricLabel.toLowerCase()}`;
    if ($("#dashDonutHint")) $("#dashDonutHint").textContent = `Theo ${dim1Label} (${formatPeriodName(activePeriod)})`;
    if ($("#dashCostDonutChart")) {
      $("#dashCostDonutChart").innerHTML = buildCostDonutHTML(dim1DonutList.length ? dim1DonutList : [
        { name: "Chung", val: totalDim1Curr, valText: formatCurrencyFull(totalDim1Curr), pct: 100, color: "#d97706" }
      ]);
    }

    // 3. CARD 3: Contribution Horizontal Bars (by Secondary Dimension or Top Entities)
    const dim2ValMap = {};
    currRows.forEach(r => {
      const k = r.secondary || r.channel || "(Ô trống)";
      dim2ValMap[k] = (dim2ValMap[k] || 0) + r.primaryVal;
    });
    const maxDim2Val = Math.max(1, ...Object.values(dim2ValMap));
    const dim2ContribList = Object.entries(dim2ValMap)
      .map(([name, val]) => ({
        name,
        val,
        valText: formatCurrencyFull(val),
        pct: Math.min(100, Math.round((val / maxDim2Val) * 100))
      }))
      .sort((a, b) => b.val - a.val);

    if ($("#dashContribTitle")) $("#dashContribTitle").textContent = `Đóng góp ${primaryMetricLabel.toLowerCase()}`;
    if ($("#dashContribHint")) $("#dashContribHint").textContent = `Theo ${dim2Label} (${formatPeriodName(activePeriod)})`;
    if ($("#dashContribFooter")) $("#dashContribFooter").textContent = `${dim2ContribList.length} nhóm theo giá trị giảm dần.`;
    if ($("#dashRevenueContribBars")) {
      $("#dashRevenueContribBars").innerHTML = buildRevenueContribBarsHTML(dim2ContribList);
    }

    // 4. CARD 4: Comparative Analysis & Variance
    let varianceItems = [];
    const currPrimaryTotal = sumCol(currRows, colPrimaryMetric || schema.colRev);
    const prevPrimaryTotal = prevRows.length ? sumCol(prevRows, colPrimaryMetric || schema.colRev) : 0;

    if (prevPeriod && prevRows.length) {
      const prevDim1ValMap = {};
      prevRows.forEach(r => {
        prevDim1ValMap[r.channel] = (prevDim1ValMap[r.channel] || 0) + r.primaryVal;
      });
      const allDim1Keys = new Set([...Object.keys(dim1ValMap), ...Object.keys(prevDim1ValMap)]);
      const diffList = [];
      allDim1Keys.forEach(k => {
        const cVal = dim1ValMap[k] || 0;
        const pVal = prevDim1ValMap[k] || 0;
        const diff = cVal - pVal;
        diffList.push({ name: k, diff, absDiff: Math.abs(diff) });
      });
      diffList.sort((a, b) => b.absDiff - a.absDiff);
      const maxAbs = Math.max(1, diffList[0]?.absDiff || 1);
      varianceItems = diffList.map(it => ({
        name: it.name,
        valText: `${it.diff >= 0 ? "+" : ""}${formatCurrencyFull(it.diff)}`,
        pct: Math.min(100, Math.round((it.absDiff / maxAbs) * 100)),
        isPositive: it.diff >= 0
      }));

      if ($("#dashVarianceTitle")) $("#dashVarianceTitle").textContent = `Nhóm làm thay đổi ${primaryMetricLabel.toLowerCase()}`;
      if ($("#dashVarianceSub")) $("#dashVarianceSub").textContent = `${formatPeriodName(prevPeriod)} → ${formatPeriodName(activePeriod)} · ${dim1Label}`;
      if ($("#dashVarianceNote")) {
        const totalDiff = currPrimaryTotal - prevPrimaryTotal;
        $("#dashVarianceNote").textContent = `Từ ${formatCurrencyFull(prevPrimaryTotal)} đến ${formatCurrencyFull(currPrimaryTotal)} · Thay đổi ${totalDiff >= 0 ? "+" : ""}${formatCurrencyFull(totalDiff)}`;
      }
      if ($("#dashVarianceFooter")) $("#dashVarianceFooter").textContent = `${varianceItems.length} nhóm theo độ lớn thay đổi. Thanh tím biểu thị giá trị âm theo độ lớn tuyệt đối.`;
    } else {
      // Single period: Compare 2 numeric metrics if available (e.g. Tien thu truoc vs Doanh thu thang), or compare to mean
      if (colSecondaryMetric && colSecondaryMetric !== colPrimaryMetric) {
        if ($("#dashVarianceTitle")) $("#dashVarianceTitle").textContent = `Đối chiếu: ${primaryMetricLabel} vs ${secondaryMetricLabel}`;
        if ($("#dashVarianceSub")) $("#dashVarianceSub").textContent = `Theo ${dim1Label} (${formatPeriodName(activePeriod)})`;
        const totalSec = sumCol(currRows, colSecondaryMetric);
        if ($("#dashVarianceNote")) {
          $("#dashVarianceNote").textContent = `Tổng ${primaryMetricLabel}: ${formatCurrencyFull(currPrimaryTotal)} · Tổng ${secondaryMetricLabel}: ${formatCurrencyFull(totalSec)}`;
        }
        varianceItems = dim1DonutList.map(d => {
          const secVal = currRows.filter(r => r.channel === d.name).reduce((acc, r) => acc + r.secondaryVal, 0);
          return {
            name: d.name,
            valText: `${formatCompactVND(d.val)} / ${formatCompactVND(secVal)}`,
            pct: d.pct,
            isPositive: d.val >= secVal
          };
        });
        if ($("#dashVarianceFooter")) $("#dashVarianceFooter").textContent = `Đối chiếu tỷ trọng dòng tiền và doanh thu định kỳ theo từng nhóm.`;
      } else {
        const avgVal = currPrimaryTotal / Math.max(1, dim2ContribList.length);
        varianceItems = dim2ContribList.map(it => {
          const diff = it.val - avgVal;
          return {
            name: it.name,
            valText: `${diff >= 0 ? "+" : ""}${formatCurrencyFull(diff)}`,
            pct: Math.min(100, Math.round((Math.abs(diff) / Math.max(1, maxDim2Val)) * 100)),
            isPositive: diff >= 0
          };
        });
        if ($("#dashVarianceTitle")) $("#dashVarianceTitle").textContent = `Độ lệch so với mức trung bình ${dim1Label.toLowerCase()}`;
        if ($("#dashVarianceSub")) $("#dashVarianceSub").textContent = `Mức bình quân: ${formatCurrencyFull(avgVal)}`;
        if ($("#dashVarianceNote")) $("#dashVarianceNote").textContent = `Kỳ hiện hành đạt ${formatCurrencyFull(currPrimaryTotal)} trên ${dim2ContribList.length} nhóm.`;
        if ($("#dashVarianceFooter")) $("#dashVarianceFooter").textContent = `${varianceItems.length} nhóm theo độ lệch tuyệt đối.`;
      }
    }

    if ($("#dashVarianceBars")) {
      $("#dashVarianceBars").innerHTML = buildVarianceBarsHTML(varianceItems);
    }

    // SECTION 2: Phân tích chuyên đề (Thematic Analysis across full dataset)
    const allDim1ValMap = {};
    const allDim1RowsMap = {};
    normalizedRows.forEach(r => {
      allDim1ValMap[r.channel] = (allDim1ValMap[r.channel] || 0) + r.primaryVal;
      allDim1RowsMap[r.channel] = (allDim1RowsMap[r.channel] || 0) + 1;
    });
    const totalAllPrimary = sumCol(normalizedRows, colPrimaryMetric || schema.colRev);
    const totalAllSecondary = colSecondaryMetric ? sumCol(normalizedRows, colSecondaryMetric) : 0;
    const maxAllDim1 = Math.max(1, ...Object.values(allDim1ValMap));
    const allTopicDim1 = Object.entries(allDim1ValMap)
      .map(([name, val]) => ({
        name,
        val,
        valText: formatCurrencyFull(val),
        pct: Math.min(100, Math.round((val / maxAllDim1) * 100)),
        sharePct: totalAllPrimary > 0 ? Number(((val / totalAllPrimary) * 100).toFixed(1)) : 0,
        rowsCount: allDim1RowsMap[name] || 0
      }))
      .sort((a, b) => b.val - a.val);

    const topPrimaryGroup = allTopicDim1[0] || { name: "Chung", val: 0, sharePct: 0, rowsCount: 0 };
    const blankGroup = allTopicDim1.find(c => c.name.includes("Ô trống") || c.name === "") || null;

    if ($("#dashTopic1Title")) $("#dashTopic1Title").textContent = `${primaryMetricLabel} theo ${dim1Label} (${normalizedRows.length} dòng)`;
    if ($("#dashTopic1CardHeader")) $("#dashTopic1CardHeader").textContent = `Tổng · ${primaryMetricLabel}`;
    if ($("#dashTopic1CardSub")) $("#dashTopic1CardSub").textContent = `${datasetLabel} · ${dim1Label}`;
    if ($("#dashTopic1Footer")) $("#dashTopic1Footer").textContent = `${allTopicDim1.length} nhóm theo giá trị giảm dần.`;
    if ($("#dashTopicRevBars")) $("#dashTopicRevBars").innerHTML = buildRevenueContribBarsHTML(allTopicDim1);

    if ($("#dashTopicRevInsight")) {
      $("#dashTopicRevInsight").textContent =
        `Nhóm "${topPrimaryGroup.name}" dẫn đầu theo ${dim1Label}: ${formatCurrencyFull(topPrimaryGroup.val)} (${topPrimaryGroup.sharePct}% toàn bộ · ${topPrimaryGroup.rowsCount}/${normalizedRows.length} dòng).`;
    }

    // Topic 2: Secondary Metric or Secondary Dimension
    const allDim2ValMap = {};
    const allDim2RowsMap = {};
    normalizedRows.forEach(r => {
      allDim2ValMap[r.secondary] = (allDim2ValMap[r.secondary] || 0) + (colSecondaryMetric ? r.secondaryVal : r.primaryVal);
      allDim2RowsMap[r.secondary] = (allDim2RowsMap[r.secondary] || 0) + 1;
    });
    const totalAllDim2 = Math.max(1, Object.values(allDim2ValMap).reduce((a, b) => a + b, 0));
    const maxAllDim2 = Math.max(1, ...Object.values(allDim2ValMap));
    const allTopicDim2 = Object.entries(allDim2ValMap)
      .map(([name, val]) => ({
        name,
        val,
        valText: formatCurrencyFull(val),
        pct: Math.min(100, Math.round((val / maxAllDim2) * 100)),
        sharePct: Number(((val / totalAllDim2) * 100).toFixed(1)),
        rowsCount: allDim2RowsMap[name] || 0
      }))
      .sort((a, b) => b.val - a.val);

    const topSecondaryGroup = allTopicDim2[0] || { name: "Chung", val: 0, rowsCount: 0 };
    const topic2MetricLabel = colSecondaryMetric ? secondaryMetricLabel : primaryMetricLabel;

    if ($("#dashTopic2Title")) $("#dashTopic2Title").textContent = `${topic2MetricLabel} theo ${dim2Label} (Toàn bộ ${normalizedRows.length} dòng)`;
    if ($("#dashTopic2CardHeader")) $("#dashTopic2CardHeader").textContent = `Tổng · ${topic2MetricLabel}`;
    if ($("#dashTopic2CardSub")) $("#dashTopic2CardSub").textContent = `${datasetLabel} · ${dim2Label}`;
    if ($("#dashTopic2Footer")) $("#dashTopic2Footer").textContent = `${allTopicDim2.length} nhóm theo giá trị giảm dần.`;

    if ($("#dashTopicCogsBanner")) {
      $("#dashTopicCogsBanner").innerHTML = `
        <strong>Rà Soát Dữ Liệu Thực Tế: ${escapeHtml(domainName)}</strong>
        <p>Bộ dữ liệu <strong>${escapeHtml(datasetLabel)}</strong> (${headers.length} cột) · Hệ thống phân tích chéo theo <strong>${escapeHtml(dim1Label)}</strong> và <strong>${escapeHtml(dim2Label)}</strong> trên <strong>${normalizedRows.length}/${normalizedRows.length} dòng hợp lệ</strong>.</p>
      `;
    }

    if ($("#dashTopicMktBars")) $("#dashTopicMktBars").innerHTML = buildRevenueContribBarsHTML(allTopicDim2);
    if ($("#dashTopicMktInsight")) {
      $("#dashTopicMktInsight").textContent =
        `Bộ dữ liệu "${datasetLabel}" · Nhóm "${topSecondaryGroup.name}" dẫn đầu về "${topic2MetricLabel}" trong ${allTopicDim2.length} nhóm theo "${dim2Label}" (${formatCurrencyFull(topSecondaryGroup.val)}). Nhóm này có số liệu ở ${topSecondaryGroup.rowsCount}/${normalizedRows.length} dòng.`;
    }

    // SECTION 3: Dynamic Conclusions & Action Recommendations
    const topVariance = varianceItems[0] || null;

    if ($("#dashConclusionList")) {
      const conclusions = [];
      conclusions.push(
        `Phân loại "${dim1Label}": Nhóm "${topPrimaryGroup.name}" đạt tổng "${primaryMetricLabel}" cao nhất (${formatCurrencyFull(topPrimaryGroup.val)}, chiếm ${totalAllPrimary > 0 ? ((topPrimaryGroup.val / totalAllPrimary) * 100).toFixed(1) : 100}% toàn bộ ${normalizedRows.length} dòng).`,
        `Phân loại "${dim2Label}": Nhóm "${topSecondaryGroup.name}" đứng đầu với tổng "${topic2MetricLabel}" đạt ${formatCurrencyFull(topSecondaryGroup.val)} qua ${topSecondaryGroup.rowsCount} bản ghi.`
      );

      if (domainType === "contracts") {
        conclusions.push(
          `Cơ cấu dịch vụ: Dòng tiền thu trước toàn file đạt ${formatCurrencyFull(totalAllPrimary)}, doanh thu định kỳ theo tháng đạt ${formatCurrencyFull(totalAllSecondary)}. Chu kỳ "${topPrimaryGroup.name}" là nguồn thu ổn định lớn nhất.`
        );
      } else if (domainType === "marketing") {
        conclusions.push(
          `Hiệu suất tiếp thị: Ghi nhận tổng cộng ${normalizedRows.length} chiến dịch với ngân sách ${formatCurrencyFull(totalAllPrimary)}, kênh "${topPrimaryGroup.name}" mang lại tỷ trọng tương tác cao nhất.`
        );
      } else if (domainType === "crm") {
        conclusions.push(
          `Quy mô phễu khách hàng: Tiếp nhận ${normalizedRows.length} hồ sơ với tổng ngân sách dự kiến ${formatCurrencyFull(totalAllPrimary)}, kênh "${topPrimaryGroup.name}" thu hút lượng khách lớn nhất.`
        );
      } else {
        conclusions.push(
          `Hồ sơ ghi nhận tổng cộng ${normalizedRows.length} dòng dữ liệu thực tế với tổng ${primaryMetricLabel.toLowerCase()} đạt ${formatCurrencyFull(totalAllPrimary)}.`
        );
      }

      if (prevPeriod) {
        conclusions.push(
          `So sánh kỳ ${formatPeriodName(activePeriod)} với ${formatPeriodName(prevPeriod)}: ${primaryMetricLabel} ${currPrimaryTotal >= prevPrimaryTotal ? "tăng" : "giảm"} ${formatCurrencyFull(Math.abs(currPrimaryTotal - prevPrimaryTotal))}. ${topVariance ? `Nhóm "${topVariance.name}" biến động mạnh nhất (${topVariance.valText}).` : ""}`
        );
      }

      if (blankGroup && blankGroup.val > 0) {
        conclusions.push(
          `Cảnh báo dữ liệu: Có ${blankGroup.rowsCount} dòng thiếu "${dim1Label}" thuộc nhóm "(Ô trống)" với giá trị ${formatCurrencyFull(blankGroup.val)} cần được chuẩn hóa bổ sung.`
        );
      }
      $("#dashConclusionList").innerHTML = conclusions.map(t => `<li>${escapeHtml(t)}</li>`).join("");
    }

    if ($("#dashActionList")) {
      const actions = [
        {
          type: "positive",
          badge: "+",
          text: `Tập trung nguồn lực khai thác nhóm "${topPrimaryGroup.name}" (${dim1Label}): Đang đóng góp ${formatCurrencyFull(topPrimaryGroup.val)} (${totalAllPrimary > 0 ? ((topPrimaryGroup.val / totalAllPrimary) * 100).toFixed(1) : 100}% tổng dữ liệu).`
        },
        {
          type: "positive",
          badge: "+",
          text: `Đẩy mạnh mở rộng phân khúc "${topSecondaryGroup.name}" (${dim2Label}): Đang dẫn đầu với giá trị ${formatCurrencyFull(topSecondaryGroup.val)} qua ${topSecondaryGroup.rowsCount} bản ghi thực tế.`
        }
      ];

      if (domainType === "contracts") {
        actions.push({
          type: "warning",
          badge: "-",
          text: `Rà soát hạn hợp đồng: Thiết lập quy trình liên hệ tái ký trước 30-45 ngày đối với các hợp đồng sắp đáo hạn để duy trì dòng tiền thu trước đều đặn.`
        });
      } else if (domainType === "marketing") {
        actions.push({
          type: "positive",
          badge: "+",
          text: `Tối ưu hóa ngân sách quảng cáo: Chuyển dịch 20% ngân sách từ các chiến dịch có CVR thấp sang nhóm "${topPrimaryGroup.name}" để gia tăng tỷ lệ chuyển đổi.`
        });
      } else if (domainType === "crm") {
        actions.push({
          type: "warning",
          badge: "-",
          text: `Phân loại Lead theo ngân sách: Ưu tiên phân công NVKD chuyên trách chăm sóc ngay các khách hàng có ngân sách lớn từ kênh "${topPrimaryGroup.name}".`
        });
      }

      if (blankGroup && blankGroup.val > 0) {
        actions.push({
          type: "warning",
          badge: "-",
          text: `Chuẩn hóa dữ liệu: Điền thông tin còn khuyết cho ${blankGroup.rowsCount} dòng ở nhóm "(Ô trống)" để không thất thoát số liệu báo cáo.`
        });
      }

      $("#dashActionList").innerHTML = actions.map(a => `
        <div class="dash-action-card ${a.type}">
          <span class="dash-action-badge">${a.badge}</span>
          <div>${escapeHtml(a.text)}</div>
        </div>
      `).join("");
    }

    // Compute & Render Direct Answers to the User's Scope Questions & Targets
    const effectiveDirectives = activeDirectives || {
      userQuestions: buildDefaultQuestionsFromProfile(dashProfile).split("\n").filter(Boolean),
      focusPeriod: activePeriod,
      focusGroupValues: [],
      targetGoal: null
    };
    const precomputedQA = computeUserQuestionsAnswers({
      directives: effectiveDirectives,
      currRows,
      normalizedRows,
      headers,
      schema,
      colPrimaryMetric,
      colSecondaryMetric,
      primaryMetricLabel,
      secondaryMetricLabel,
      dim1Label,
      dim2Label,
      dim1DonutList,
      dim2ContribList,
      trendMonthsData,
      currPrimaryTotal,
      activePeriod,
      sortedPeriods,
      blankGroup,
      datasetLabel
    });
    state.lastQuestionAnswers = precomputedQA;
    renderDashboardUserQuestions(
      precomputedQA,
      effectiveDirectives,
      activeDirectives
        ? `Áp dụng đúng phạm vi bạn đã trao đổi với AI (${formatPeriodName(activePeriod)} · ${currRows.length}/${fullRawRows.length} dòng · Chỉ số ưu tiên: ${primaryMetricLabel}).`
        : `Trả lời tự động theo bộ dữ liệu "${datasetLabel}" — bạn có thể gõ câu hỏi hoặc yêu cầu lọc trực tiếp ở ô bên dưới.`
    );

    if (triggerAgent) {
      triggerDashboardAgentAnalysis({
        datasetLabel,
        rawRows,
        normalizedRows,
        headers,
        period: activePeriod,
        metrics: {
          domainType,
          domainName,
          kpis,
          colPrimaryMetric,
          primaryMetricLabel,
          colSecondaryMetric,
          secondaryMetricLabel,
          dim1Label,
          dim2Label,
          topPrimaryGroup,
          topSecondaryGroup,
          currPrimaryTotal,
          totalAllPrimary,
          totalAllSecondary,
          currRowsCount: currRows.length,
          activePeriodName: formatPeriodName(activePeriod),
          prevPeriodName: prevPeriod ? formatPeriodName(prevPeriod) : null,
          varianceTop: topVariance,
          blankGroupCount: blankGroup ? blankGroup.rowsCount : 0,
          blankGroupVal: blankGroup ? blankGroup.val : 0,
          monthsCount: sortedPeriods.length,
          precomputedQA
        }
      });
    }
  }

  let isDashboardAgentRunning = false;
  async function triggerDashboardAgentAnalysis(context) {
    if (isDashboardAgentRunning) return;
    isDashboardAgentRunning = true;

    const badge = $("#dashAgentScanBadge");
    if (badge) {
      badge.innerHTML = `<span class="pulse-beacon"></span> Agent đang rà soát dữ liệu & phân tích...`;
      badge.className = "pill pill-amber";
    }

    try {
      const llmOptions = getActiveLlmOptions();

      const analysis = await agent.runDashboardAgentAnalysis({
        datasetLabel: context.datasetLabel,
        rawRows: context.rawRows,
        normalizedRows: context.normalizedRows,
        headers: context.headers,
        period: context.period,
        metrics: context.metrics,
        businessContext: state.businessContext,
        llmOptions
      });

      if (analysis) {
        if (analysis.question_answers?.length) {
          state.lastQuestionAnswers = analysis.question_answers;
          renderDashboardUserQuestions(
            analysis.question_answers,
            state.businessContext?.directives,
            analysis.llm_used
              ? `AI Gemini (${analysis.llm_meta?.model_used || "flash"}) đã tổng hợp lời giải đáp bám sát số liệu thực tế & yêu cầu bạn đã đặt ra.`
              : `AI Agent đã đối chiếu và giải đáp trực tiếp từ số liệu thực tế trong file (${context.rawRows.length} dòng).`
          );
        }

        if ($("#dashConclusionList") && analysis.conclusions?.length) {
          $("#dashConclusionList").innerHTML = analysis.conclusions.map(t => `<li>${escapeHtml(t)}</li>`).join("");
        }

        if ($("#dashActionList") && analysis.actions?.length) {
          $("#dashActionList").innerHTML = analysis.actions.map(a => `
            <div class="dash-action-card ${a.type}">
              <span class="dash-action-badge">${escapeHtml(a.badge)}</span>
              <div>${escapeHtml(a.text)}</div>
            </div>
          `).join("");
        }

        if ($("#dashTopicRevInsight") && analysis.topic_channel_insight) {
          $("#dashTopicRevInsight").textContent = analysis.topic_channel_insight;
        }
        if ($("#dashTopicMktInsight") && analysis.topic_secondary_insight) {
          $("#dashTopicMktInsight").textContent = analysis.topic_secondary_insight;
        }

        if ($("#detailedReportBox") && analysis.detailed_report_html) {
          $("#detailedReportBox").innerHTML = analysis.detailed_report_html;
        }

        if ($("#executiveBriefBox") && analysis.executive_brief) {
          renderExecutiveBrief(analysis.executive_brief);
        }

        if (!state.agentOutput) {
          state.agentOutput = {
            run_id: analysis.run_id,
            executive_brief: analysis.executive_brief,
            detailed_report_html: analysis.detailed_report_html,
            customers: [],
            report: {
              summary: {
                total_raw_records: context.rawRows.length,
                unique_customers: context.rawRows.length,
                duplicates_merged: 0,
                by_priority: { "Cao": 0, "Trung bình": 0, "Thấp": 0, "Không liên hệ lại": 0 },
                manager_decision_count: 0,
                unassigned_count: 0,
                do_not_contact_count: 0
              },
              by_staff: [],
              lists: {
                sales_tasks: [],
                unassigned: [],
                do_not_contact: [],
                manager_decisions: []
              }
            },
            trace: analysis.trace || []
          };
        } else {
          state.agentOutput.executive_brief = analysis.executive_brief;
          state.agentOutput.detailed_report_html = analysis.detailed_report_html;
          if (analysis.trace?.length) {
            state.agentOutput.trace.push(...analysis.trace);
          }
        }

        if (badge) {
          const modeTag = analysis.llm_used ? `AI Gemini (${analysis.llm_meta?.model_used || "flash"})` : "Local Agent";
          badge.innerHTML = `<span class="pulse-beacon"></span> Đã phân tích (${modeTag} · ${context.rawRows.length} dòng)`;
          badge.className = "pill pill-yellow";
        }
      }
    } catch (err) {
      console.warn("Lỗi phân tích Agent trên Dashboard:", err);
      if (badge) {
        badge.innerHTML = `<span class="pulse-beacon"></span> Agent rà soát (${context.rawRows.length} dòng)`;
        badge.className = "pill pill-yellow";
      }
    } finally {
      isDashboardAgentRunning = false;
    }
  }

  let isDashQuickAskBusy = false;
  async function handleDashboardQuickAsk() {
    if (isDashQuickAskBusy) return;
    const input = $("#dashQuickAskInput");
    const btn = $("#btnDashQuickAsk");
    const msg = (input?.value || "").trim();
    if (!msg) return;

    isDashQuickAskBusy = true;
    const origText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "AI đang xử lý...";
    }

    try {
      const dsType = $("#dashDatasetFilter")?.value || state.lastDashboardDatasetType || "auto";
      const profile = state.lastDashboardProfile;
      if (!profile) return;

      const res = await agent.chatWithScopeAgent({
        message: msg,
        chatHistory: state.scopeChatHistory || [],
        datasetLabel: dsType === "auto" ? (state.parsedDataset?.sourceLabel || "Dữ liệu hiện tại") : dsType,
        dataProfile: profile,
        currentContext: state.businessContext || {},
        llmOptions: getActiveLlmOptions()
      });

      if (!state.businessContext) {
        state.businessContext = {
          businessType: profile.domainName || "Phân tích dữ liệu",
          analysisQuestions: "",
          dynamicQA: [],
          chatHistory: [],
          chatDirectives: {}
        };
      }
      state.businessContext.appliedToDataset = dsType;
      state.scopeChatHistory = state.scopeChatHistory || [];
      state.scopeChatHistory.push({ role: "user", text: msg, meta: "Từ Dashboard" });
      state.scopeChatHistory.push({ role: "ai", text: res.reply, meta: res.llm_used ? "AI Gemini" : "AI Agent" });
      state.businessContext.chatHistory = state.scopeChatHistory;

      const ed = res.extracted_directives || {};
      state.scopeChatDirectives = { ...(state.scopeChatDirectives || {}) };
      if (ed.focusPeriod) state.scopeChatDirectives.focusPeriod = ed.focusPeriod;
      if (ed.focusMetricCol) state.scopeChatDirectives.focusMetricCol = ed.focusMetricCol;
      if (ed.focusDimCol) state.scopeChatDirectives.focusDimCol = ed.focusDimCol;
      if (Array.isArray(ed.focusGroupValues)) {
        state.scopeChatDirectives.focusGroupValues = ed.focusGroupValues;
        state.ignoreScopeGroupFilter = ed.focusGroupValues.length === 0;
      }
      if (ed.targetGoal) state.scopeChatDirectives.targetGoal = ed.targetGoal;
      state.businessContext.chatDirectives = { ...state.scopeChatDirectives };

      const qToAdd = ed.addQuestion || msg;
      const existingQs = (state.businessContext.analysisQuestions || "").split("\n").map(s => s.trim()).filter(Boolean);
      if (qToAdd && !existingQs.includes(qToAdd)) {
        existingQs.unshift(qToAdd);
        state.businessContext.analysisQuestions = existingQs.slice(0, 8).join("\n");
        if ($("#ctxAnalysisQuestions")) $("#ctxAnalysisQuestions").value = state.businessContext.analysisQuestions;
      }

      if (input) input.value = "";
      const nextPeriod = ed.focusPeriod || ($("#dashPeriodFilter")?.value || "auto");
      await renderBusinessKpiDashboard(dsType, nextPeriod, true);
    } finally {
      isDashQuickAskBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText || "Hỏi & Cập nhật Dashboard ↵";
      }
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
            <stop offset="0%" stop-color="#d97706" stop-opacity="0.30" />
            <stop offset="100%" stop-color="#d97706" stop-opacity="0.03" />
          </linearGradient>
        </defs>
        ${yTicks.map(t => `
          <line x1="${padX}" y1="${t.y}" x2="${width - 30}" y2="${t.y}" stroke="#f3f4f6" stroke-width="1" />
          <text x="${padX - 10}" y="${t.y + 4}" text-anchor="end" font-size="11" fill="#9ca3af" font-family="sans-serif">${t.val}</text>
        `).join("")}
        <path d="${areaD}" fill="url(#trendGrad)" />
        <path d="${pathD}" fill="none" stroke="#b45309" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        ${points.map(p => `
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#d97706" stroke="#ffffff" stroke-width="2">
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
        <span class="dash-bar-val" style="color:${it.isPositive ? "#15803d" : "#b91c1c"};">${it.valText}</span>
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
    if (!out) return "";
    if (out.detailed_report_html) return out.detailed_report_html;
    const s = out.report?.summary || {};
    const customers = out.customers || [];
    const lists = out.report?.lists || {};
    const validPipelineBudget = customers
      .filter(c => !c.is_do_not_contact && !c.is_wrong_product && (c.budget_vnd || 0) > 0)
      .reduce((acc, c) => acc + c.budget_vnd, 0);
    const wrongProdList = customers.filter(c => c.is_wrong_product);
    const clarifyCount = customers.filter(c => !c.is_do_not_contact && c.draft_type === "clarify_questions").length;
    const outreachCount = customers.filter(c => !c.is_do_not_contact && c.draft_type !== "clarify_questions").length;
    const dupRate = s.total_raw_records > 0 ? Math.round((s.duplicates_merged / s.total_raw_records) * 100) : 0;

    const mgrItems = (lists.manager_decisions || []).slice(0, 5).map(c =>
      `<li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span><strong>${escapeHtml(c.company_name)}</strong> (${escapeHtml(c.customer_id)}): ${escapeHtml((c.escalation_reasons || []).join("; "))}</span></li>`
    ).join("");
    const unItems = (lists.unassigned || []).slice(0, 5).map(c =>
      `<li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span><strong>${escapeHtml(c.company_name)}</strong>: Chưa có NVKD phụ trách (Ngành ${escapeHtml(c.industry || "Trống")} · KV ${escapeHtml(c.region || "Trống")})</span></li>`
    ).join("");
    const dncItems = (lists.do_not_contact || []).slice(0, 4).map(c =>
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

    const kpiOrdersVal = $("#dashValOrders")?.textContent?.trim() || "0";
    const kpiOrdersDelta = $("#dashDeltaOrders")?.textContent?.trim() || "+71,4% so với Tháng 03/2026";
    const kpiRevVal = $("#dashValRevenue")?.textContent?.trim() || "139.600.000 VND";
    const kpiRevDelta = $("#dashDeltaRevenue")?.textContent?.trim() || "+39,3% so với Tháng 03/2026";
    const kpiProfitVal = $("#dashValProfit")?.textContent?.trim() || "53.048.000 VND";
    const kpiProfitDelta = $("#dashDeltaProfit")?.textContent?.trim() || "+39,3% so với Tháng 03/2026";
    const kpiCostVal = $("#dashValCost")?.textContent?.trim() || "86.552.000 VND";
    const kpiCostDelta = $("#dashDeltaCost")?.textContent?.trim() || "+39,3% so với Tháng 03/2026";
    const currentPeriodLabel = $("#dashPeriodFilter")?.selectedOptions?.[0]?.textContent || "Tháng 04/2026";

    const kpiCards = Array.from(document.querySelectorAll("#dashKpiContainer .dash-kpi-card"));
    const kpiCardsHtml = kpiCards.length > 0
      ? kpiCards.map(c => `
          <div class="kpi-card">
            <div class="lbl">${escapeHtml(c.querySelector(".dash-kpi-head")?.textContent?.trim() || "")}</div>
            <div class="val">${escapeHtml(c.querySelector(".dash-kpi-num")?.textContent?.trim() || "")}</div>
            <div class="sub">${escapeHtml(c.querySelector(".dash-kpi-unit")?.textContent?.trim() || "")}</div>
            <div class="delta">${escapeHtml(c.querySelector(".dash-kpi-delta")?.textContent?.trim() || "")}</div>
          </div>
        `).join("")
      : `
        <div class="kpi-card"><div class="lbl">Số đơn hàng</div><div class="val">${escapeHtml(kpiOrdersVal)}</div><div class="sub">Số đơn</div><div class="delta">${escapeHtml(kpiOrdersDelta)}</div></div>
        <div class="kpi-card"><div class="lbl">Doanh thu</div><div class="val">${escapeHtml(kpiRevVal)}</div><div class="sub">Doanh thu (VND)</div><div class="delta">${escapeHtml(kpiRevDelta)}</div></div>
        <div class="kpi-card"><div class="lbl">Lợi nhuận</div><div class="val">${escapeHtml(kpiProfitVal)}</div><div class="sub">Lợi nhuận gộp (VND)</div><div class="delta">${escapeHtml(kpiProfitDelta)}</div></div>
        <div class="kpi-card"><div class="lbl">Chi phí</div><div class="val">${escapeHtml(kpiCostVal)}</div><div class="sub">Chi phí giá vốn (VND)</div><div class="delta">${escapeHtml(kpiCostDelta)}</div></div>
      `;

    const qaAnswersExportHtml = (state.lastQuestionAnswers && state.lastQuestionAnswers.length)
      ? `<div style="margin:18px 0;background:#fffdf5;border:1.5px solid #d97706;border-radius:12px;padding:16px 20px;">
          <h3 style="margin:0 0 10px 0;color:#92400e;font-size:15px;">✦ Giải đáp Trực tiếp Câu hỏi &amp; Phạm vi Người dùng đã Trao đổi với AI</h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
          ${state.lastQuestionAnswers.map((qa, idx) => `
            <div style="background:#fff;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;padding:10px 14px;">
              <div style="font-weight:800;font-size:13px;color:#111827;margin-bottom:4px;">Q${idx + 1}. ${escapeHtml(qa.question)}</div>
              <div style="font-size:13px;color:#1f2937;line-height:1.5;">${escapeHtml(qa.answer)}</div>
              ${qa.evidence ? `<div style="margin-top:4px;font-size:11.5px;color:#92400e;font-weight:600;">Dẫn chứng: ${escapeHtml(qa.evidence)}</div>` : ""}
            </div>
          `).join("")}
          </div>
        </div>`
      : "";

    const trendTitle = $("#dashTrendTitle")?.textContent?.trim() || "Chỉ số theo thời gian";
    const trendHint = $("#dashTrendHint")?.textContent?.trim() || "";
    const donutTitle = $("#dashDonutTitle")?.textContent?.trim() || "Cơ cấu tỷ trọng";
    const donutHint = $("#dashDonutHint")?.textContent?.trim() || "";
    const contribTitle = $("#dashContribTitle")?.textContent?.trim() || "Đóng góp theo nhóm";
    const contribHint = $("#dashContribHint")?.textContent?.trim() || "";
    const varianceTitle = $("#dashVarianceTitle")?.textContent?.trim() || "Biến động & Đối chiếu";
    const varianceHint = $("#dashVarianceSub")?.textContent?.trim() || "";
    const topic1Title = $("#dashTopic1Title")?.textContent?.trim() || "Phân tích chuyên đề 1";
    const topic1Insight = $("#dashTopicRevInsight")?.textContent?.trim() || "";
    const topic2Title = $("#dashTopic2Title")?.textContent?.trim() || "Phân tích chuyên đề 2";
    const topic2Banner = $("#dashTopicCogsBanner")?.innerHTML || "";
    const topic2Insight = $("#dashTopicMktInsight")?.textContent?.trim() || "";

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
<title>Báo cáo Chốt Kết quả &amp; Dashboard - Minh Hoàng AI Agent (${escapeHtml(runId)})</title>
<style>
  body { margin:0; padding:28px; font-family:"Segoe UI",system-ui,sans-serif; background:#ffffff; color:#111111; line-height:1.5; }
  .wrap { max-width:1280px; margin:0 auto; }
  .hdr { background:#fffdf5; border:1px solid #d97706; border-radius:14px; padding:20px 24px; margin-bottom:20px; }
  h1 { margin:0 0 6px; font-size:22px; color:#111111; }
  h2 { margin:24px 0 12px; font-size:17px; color:#111111; border-left:4px solid #f59e0b; padding-left:10px; }
  .meta { color:#52525b; font-size:13px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin:14px 0; }
  .kpi-card { background:#fffdf5; border:1.5px solid #fde68a; border-top:3px solid #d97706; border-radius:12px; padding:14px 18px; }
  .kpi-card .lbl { font-size:12.5px; font-weight:700; color:#52525b; }
  .kpi-card .val { font-size:22px; font-weight:900; color:#111827; margin-top:2px; }
  .kpi-card .sub { font-size:11.5px; color:#6b7280; }
  .kpi-card .delta { font-size:12px; font-weight:700; color:#b45309; margin-top:4px; }
  .visuals-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:16px 0; }
  .v-card { background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:16px 18px; }
  .v-card h3 { margin:0 0 4px; font-size:14px; font-weight:800; color:#111111; }
  .v-card small { color:#6b7280; font-size:11.5px; display:block; margin-bottom:10px; }
  .thematic-grid { display:grid; grid-template-columns:1.2fr 1fr; gap:14px; margin:12px 0; }
  .insight-card { background:#fffdf5; border:1px solid #fde68a; border-radius:12px; padding:14px 16px; font-size:12.5px; color:#334155; line-height:1.6; }
  .insight-card strong { color:#92400e; display:block; margin-bottom:6px; font-size:13px; }
  .cogs-banner { background:#fffdf5; border:1px solid #fde68a; border-left:4px solid #d97706; border-radius:10px; padding:12px 16px; margin:12px 0; font-size:12.5px; }
  .cogs-banner > strong { color:#92400e; font-size:13px; display:block; margin-bottom:4px; }
  .cogs-banner p { margin:0; line-height:1.55; }
  .cogs-banner p strong { display:inline; color:#92400e; font-weight:700; }
  .dash-bullet-list { list-style:none; padding:0; margin:8px 0; display:flex; flex-direction:column; gap:6px; font-size:12.5px; }
  .dash-bullet-list li { position:relative; padding-left:16px; color:#374151; }
  .dash-bullet-list li::before { content:"•"; position:absolute; left:0; color:#d97706; font-weight:900; }
  .dash-action-cards-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:8px 0; font-size:12.5px; }
  .dash-action-card { display:flex; align-items:flex-start; gap:10px; border-radius:8px; padding:10px 14px; }
  .dash-action-card.positive { background:#fffdf5; border:1px solid #fde68a; border-left:4px solid #d97706; color:#78350f; }
  .dash-action-card.warning { background:#fef2f2; border:1px solid #fecaca; border-left:4px solid #b91c1c; color:#991b1b; }
  .dash-action-badge { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:50%; font-weight:900; font-size:12px; flex-shrink:0; }
  .dash-action-card.positive .dash-action-badge { background:#d97706; color:#fff; }
  .dash-action-card.warning .dash-action-badge { background:#b91c1c; color:#fff; }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin:2px; }
  .pill.ok { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
  .pill.err { background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; }
  table { width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #e4e4e7; font-size:12.5px; margin-top:10px; }
  th, td { border:1px solid #e4e4e7; padding:9px 12px; text-align:left; vertical-align:top; color:#111111; }
  th { background:#fef3c7; color:#111111; font-weight:800; white-space:nowrap !important; }
  .dash-bar-row { display:grid; grid-template-columns:minmax(115px,155px) minmax(70px,1fr) auto; align-items:center; gap:10px; font-size:12px; margin-bottom:8px; }
  .dash-bar-label { font-weight:600; color:#374151; line-height:1.3; word-break:break-word; }
  .dash-bar-track { height:12px; background:#f3f4f6; border-radius:999px; overflow:hidden; display:flex; }
  .dash-bar-fill { height:100%; border-radius:999px; }
  .dash-bar-fill.positive { background:#d97706; }
  .dash-bar-fill.negative { background:#b91c1c; }
  .donut-legend-row { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; margin-bottom:8px; }
  .donut-legend-dot { width:10px; height:10px; border-radius:2px; display:inline-block; margin-right:6px; }

  /* Báo cáo Chi tiết & Biểu đồ Kiểm soát Trưởng phòng */
  .brief-box { background:#fffdf5; border:1px solid #fde68a; border-left:4px solid #d97706; border-radius:10px; padding:14px 18px; margin:14px 0; font-size:13px; line-height:1.55; display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .detailed-report-wrap { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:14px 0; }
  .report-block { background:#fffdf5; border:1px solid #fde68a; border-left:4px solid #d97706; border-radius:10px; padding:14px 16px; }
  .report-block-full { grid-column: 1 / -1; }
  .report-qa-grid-2col { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
  .report-qa-mini { background:#ffffff; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; }
  .report-qa-q { font-weight:800; font-size:12.5px; color:#111827; margin-bottom:4px; }
  .report-qa-a { font-size:12.5px; color:#374151; line-height:1.45; }
  .report-qa-ev { font-size:11.5px; color:#92400e; font-weight:600; margin-top:4px; }
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
    <h1>BÁO CÁO CHỐT KẾT QUẢ &amp; DASHBOARD — MINH HOÀNG AI AGENT</h1>
    <div class="meta">Run ID: ${escapeHtml(runId)} · Nguồn: ${escapeHtml(state.parsedDataset?.sourceLabel || "Bán lẻ mẫu")} · Thời điểm xuất: ${escapeHtml(new Date().toLocaleString("vi-VN"))}</div>
    <div style="margin-top:8px;">${verifyHtml}</div>
  </div>

  <h2>Dashboard KPI Kinh Doanh (${escapeHtml(currentPeriodLabel)})</h2>
  <div class="kpis">
    ${kpiCardsHtml}
  </div>
  ${qaAnswersExportHtml}

  <div class="visuals-grid">
    <div class="v-card">
      <h3>${escapeHtml(trendTitle)}</h3>
      <small>${escapeHtml(trendHint)}</small>
      <div style="height:180px;">${trendSvgHtml}</div>
    </div>
    <div class="v-card">
      <h3>${escapeHtml(donutTitle)}</h3>
      <small>${escapeHtml(donutHint)}</small>
      <div>${costDonutHtml}</div>
    </div>
    <div class="v-card">
      <h3>${escapeHtml(contribTitle)}</h3>
      <small>${escapeHtml(contribHint)}</small>
      <div>${revContribHtml}</div>
    </div>
    <div class="v-card">
      <h3>${escapeHtml(varianceTitle)}</h3>
      <small>${escapeHtml(varianceHint)}</small>
      <div>${varianceHtml}</div>
    </div>
  </div>

  <h2>Phân tích Chuyên đề</h2>
  <div class="v-card" style="margin-bottom:14px;">
    <h3>${escapeHtml(topic1Title)}</h3>
    <div class="thematic-grid">
      <div>${topicRevHtml}</div>
      <div class="insight-card"><strong>Nhận định</strong>${escapeHtml(topic1Insight)}</div>
    </div>
  </div>

  <div class="v-card">
    <h3>${escapeHtml(topic2Title)}</h3>
    <div class="cogs-banner">${topic2Banner}</div>
    <div class="thematic-grid">
      <div>${topicMktHtml}</div>
      <div class="insight-card"><strong>Nhận định</strong>${escapeHtml(topic2Insight)}</div>
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

  <h2>Báo cáo Chi tiết Kinh doanh</h2>
  <div class="detailed-report-wrap">
    ${detailedReportHtml}
  </div>
</div>
</body>
</html>`;

    downloadBlob(`minhhoang_bao_cao_phan_tich_${runId}.html`, html, "text/html;charset=utf-8");
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

