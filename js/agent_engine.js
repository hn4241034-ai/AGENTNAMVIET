// agent_engine.js - Tool-Calling AI Agent Orchestrator & Audit Logger

window.NamVietAgent = (() => {
  const skills = window.NamVietSkills;
  const validator = window.NamVietValidator;

  const AGENT_TOOLS_SPEC = [
    {
      name: "validate_input_schema",
      description: "Kiểm tra cấu trúc cột, kiểu dữ liệu, trùng lead_id và tính hợp lệ của dữ liệu đầu vào.",
      skill_group: "Gatekeeper"
    },
    {
      name: "normalize_and_deduplicate_leads",
      description: "Skill 1: Chuẩn hóa tên công ty/viết tắt/SĐT/email/MST và gom nhóm hồ sơ trùng cùng doanh nghiệp.",
      skill_group: "Skill 1 - Deduplication"
    },
    {
      name: "analyze_needs_history_and_missing",
      description: "Skill 2: Đối chiếu lịch sử liên hệ, nhận diện sản phẩm Minh Hoàng phù hợp, phát hiện sai sản phẩm và liệt kê thông tin còn thiếu.",
      skill_group: "Skill 2 - Enrichment & History"
    },
    {
      name: "score_customer_priority",
      description: "Skill 3: Chấm điểm ưu tiên (0-100) và phân loại Cao/Trung bình/Thấp/Không liên hệ lại kèm căn cứ chi tiết.",
      skill_group: "Skill 3 - Priority Scoring"
    },
    {
      name: "assign_salesperson_and_draft_outreach",
      description: "Skill 4: Đối chiếu 8 NVKD (ngành, khu vực, sản phẩm, tải tuần), kiểm tra vượt thẩm quyền/tranh chấp và tạo bản nháp tiếp cận/câu hỏi bổ sung.",
      skill_group: "Skill 4 - Routing & Drafting"
    },
    {
      name: "compile_manager_report_and_stats",
      description: "Skill 5: Tổng hợp thống kê không đếm lặp, lập danh sách công việc NVKD, khách chưa có người phù hợp, khách ngừng liên hệ và ca cần Trưởng phòng duyệt.",
      skill_group: "Skill 5 - Reporting"
    }
  ];

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeParseJson(rawText) {
    if (!rawText) return null;
    let cleaned = String(rawText).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (m) {
        try { return JSON.parse(m[1]); } catch { return null; }
      }
      return null;
    }
  }

  function formatMetricNum(val, isCurr = true) {
    const n = Number(val) || 0;
    if (isCurr) return `${Math.round(n).toLocaleString("vi-VN")} VND`;
    return Number.isInteger(n) ? n.toLocaleString("vi-VN") : n.toFixed(1).replace(".", ",");
  }

  async function callLLM({ messages, temperature = 0.2, llmOptions = {} }) {
    // If user explicitly entered a custom key in the UI, route via /api/llm-proxy
    if (llmOptions.apiKey && llmOptions.endpoint) {
      const payload = {
        model: llmOptions.model || "gemini-3.5-flash-lite",
        temperature,
        messages
      };
      const res = await fetch("/api/llm-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: llmOptions.endpoint, apiKey: llmOptions.apiKey, payload })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error("Phản hồi LLM tùy chỉnh không có nội dung.");
      return {
        content: text.replace(/<thought>[\s\S]*?<\/thought>\s*/g, "").trim(),
        brain_id: "custom_ui_key",
        brain_label: "Custom Key",
        model_used: payload.model,
        usage: data.usage || null
      };
    }

    // Default: use Server Dual-Brain Failover (/api/agent-llm)
    const res = await fetch("/api/agent-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function enrichEdgeLeadsWithLLM(customers, llmOptions, feedback = "") {
    const targets = customers
      .filter(c => !c.is_do_not_contact && (c.missing_fields.length > 0 || c.needs_manager_decision || c.is_wrong_product))
      .slice(0, 8);
    if (targets.length === 0) return null;

    const compact = targets.map(c => ({
      customer_id: c.customer_id,
      company_name: c.company_name,
      industry: c.industry,
      region: c.region,
      merged_needs: c.merged_needs,
      missing_fields: c.missing_fields,
      priority_level: c.priority_level,
      assigned_salesperson: c.assigned_salesperson
    }));

    const feedbackNote = feedback ? `\nLưu ý phản hồi từ bước Verify cần ưu tiên áp dụng: "${feedback}"\n` : "";
    const prompt =
      `Bạn là AI Agent tư vấn B2B của Công ty Phần mềm Minh Hoàng (sản phẩm: NV-ERP, NV-CRM, NV-HRM, NV-POS).\n` +
      feedbackNote +
      `Hãy phân tích nhanh danh sách ${compact.length} khách hàng có hồ sơ thiếu thông tin hoặc cần lưu ý dưới đây và trả về JSON array (CHỈ TRẢ VỀ JSON thuần, không markdown \`\`\`):\n` +
      `Mỗi phần tử gồm: {"customer_id":"...","ai_insight":"1 câu nhận định rủi ro/cơ hội cốt lõi","improved_draft":"bản nháp email/tin nhắn tiếng Việt tự nhiên, chuyên nghiệp, hỏi đúng thông tin thiếu hoặc chốt demo"}.\n\n` +
      `Dữ liệu:\n${JSON.stringify(compact)}`;

    const llmRes = await callLLM({
      messages: [
        { role: "system", content: "Bạn trả về JSON hợp lệ 100%, không thêm text giải thích ngoài JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      llmOptions
    });

    let raw = llmRes.content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const map = new Map(parsed.map(item => [item.customer_id, item]));
      for (const c of customers) {
        const hit = map.get(c.customer_id);
        if (hit) {
          if (hit.ai_insight) {
            c.priority_rationale = `${c.priority_rationale} | [AI Insight]: ${hit.ai_insight}`;
          }
          if (hit.improved_draft && hit.improved_draft.length > 25) {
            c.draft_message = hit.improved_draft;
          }
        }
      }
    }
    return {
      enriched_count: Array.isArray(parsed) ? parsed.length : 0,
      brain_id: llmRes.brain_id,
      model_used: llmRes.model_used,
      latency_ms: llmRes.latency_ms,
      usage: llmRes.usage
    };
  }

  async function callLLMExecutiveReview({ summaryStats, edgeCases, llmOptions, feedback = "" }) {
    const feedbackNote = feedback ? `\nPhản hồi Verify đã áp dụng trong lượt chạy lại: ${feedback}\n` : "";
    const prompt =
      `Bạn là Trợ lý AI điều phối kinh doanh của Công ty Phần mềm Minh Hoàng.\n` +
      `Dưới đây là kết quả sau khi các công cụ nghiệp vụ xử lý xong:\n` +
      `- Tổng hồ sơ gốc: ${summaryStats.total_raw_records}\n` +
      `- Số khách hàng duy nhất sau gộp trùng: ${summaryStats.unique_customers}\n` +
      `- Phân bổ ưu tiên: ${JSON.stringify(summaryStats.by_priority)}\n` +
      `- Số ca cần Trưởng phòng quyết định: ${summaryStats.manager_decision_count}\n` +
      `- Số khách chưa có NVKD phù hợp: ${summaryStats.unassigned_count}\n` +
      `- Số khách ngừng liên hệ: ${summaryStats.do_not_contact_count}\n` +
      `Các ca nổi bật cần lưu ý: ${JSON.stringify(edgeCases.slice(0, 6))}\n` +
      feedbackNote + `\n` +
      `Hãy viết một đoạn tóm tắt điều hành (Executive Brief) ngắn gọn bằng tiếng Việt (4–5 dòng súc tích, chỉ rõ việc cần làm ngay cho Trưởng phòng Kinh doanh).\n` +
      `QUY TẮC BẮT BUỘC ĐỊNH DẠNG: Tuyệt đối không dùng dấu chấm tròn (•). Đầu mỗi câu BẮT BUỘC phải dùng ký tự "+" (cho các kết quả tích cực, đã xử lý xong) hoặc ký tự "-" (cho cảnh báo, ca tranh chấp hoặc việc cần Trưởng phòng quyết định).`;

    return await callLLM({
      messages: [
        { role: "system", content: "Bạn là AI Agent phân tích điều phối bán hàng B2B tại Việt Nam." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      llmOptions
    });
  }

  async function runAgentPipeline({
    parsedDataset,
    config,
    llmOptions = {},
    feedback = "",
    cleaningMeta = null,
    onStepProgress = () => {}
  }) {
    const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const trace = [];
    let stepNum = 0;

    // Clone config locally if feedback adjusts thresholds dynamically
    const runtimeConfig = JSON.parse(JSON.stringify(config || {}));
    const fbLower = String(feedback || "").toLowerCase();
    if (fbLower.includes("siết") || fbLower.includes("chặt trùng") || fbLower.includes("ngưỡng trùng")) {
      runtimeConfig.deduplication_rules = runtimeConfig.deduplication_rules || {};
      runtimeConfig.deduplication_rules.fuzzy_company_similarity_threshold = 0.85;
    }

    function recordTrace(thought, toolName, inputSummary, rulesApplied, outputSummary, extra = {}) {
      stepNum += 1;
      const evt = {
        run_id: runId,
        step: stepNum,
        timestamp: new Date().toISOString(),
        thought,
        tool_called: toolName,
        input_summary: inputSummary,
        rules_applied: rulesApplied,
        output_summary: outputSummary,
        ...extra
      };
      trace.push(evt);
      onStepProgress(evt, trace);
      return evt;
    }

    // STEP 1: Mandatory Schema & Format Validation Gate
    const valResult = validator.validateDataset(parsedDataset, runtimeConfig.schema || {});
    recordTrace(
      "Kiểm tra định dạng và tính hợp lệ của toàn bộ dữ liệu đầu vào trước khi chạy quy trình nghiệp vụ.",
      "validate_input_schema",
      { total_rows: parsedDataset.rows.length, headers: parsedDataset.headers },
      ["required_columns_check", "unique_lead_id_check", "phone_email_regex", "numeric_budget_check", "date_format_check"],
      { valid: valResult.valid, error_count: valResult.errors.length, warning_count: valResult.warnings.length }
    );

    if (!valResult.valid) {
      throw new Error(`Dữ liệu không đạt chuẩn định dạng (${valResult.errors.length} lỗi). Phải chỉnh sửa trước khi Agent chạy tiếp.`);
    }

    if (cleaningMeta) {
      recordTrace(
        "Dữ liệu đã hoàn tất bước Làm sạch & Chuẩn hóa trước khi chuyển qua Process.",
        "data_cleaning_gate",
        { passes: cleaningMeta.passes || 1, mode: cleaningMeta.mode || "standard" },
        ["trim_whitespace", "normalize_phone_email_date", "standardize_region_product"],
        { normalized_cells: cleaningMeta.normalizedCells || 0, stable: true }
      );
    }

    if (feedback && feedback.trim()) {
      recordTrace(
        "Nhận Feedback từ bước Verify để điều chỉnh và chạy lại Process.",
        "apply_verify_feedback",
        { feedback_text: feedback.trim() },
        ["human_or_verify_feedback_loop"],
        { adjusted_fuzzy_threshold: runtimeConfig.deduplication_rules?.fuzzy_company_similarity_threshold }
      );
    }

    // STEP 2: Skill 1 - Normalize & Deduplicate
    let processRows = parsedDataset.rows || [];
    if (parsedDataset.isRetailDataset) {
      const segIndexMap = new Map();
      processRows = (parsedDataset.rows || []).map((r, idx) => {
        const ch = r.source_channel || r["Kênh"] || r.kenh || "Website";
        const reg = r.region || r["Khu vực"] || r.khu_vuc || "TP.HCM";
        const prodRaw = r.product_interest || r["Sản phẩm"] || r.san_pham || r.chien_dich || "";
        const monthVal = r.thang || r["Tháng"] || r.registered_at || "2026-06";
        const revVal = String(r.doanh_thu_vnd || r["Doanh thu (VND)"] || r.doanh_thu || r.budget_vnd || r.chi_phi_gia_von_vnd || r.chi_phi || "0").replace(/[,\s._]/g, "");
        const ordersVal = r.so_don || r["Số đơn"] || r.orders || null;
        const segKey = `${reg}||${ch}||${prodRaw}`;
        if (!segIndexMap.has(segKey)) segIndexMap.set(segKey, segIndexMap.size + 1);
        const segId = segIndexMap.get(segKey);

        let mappedProd = "NV-POS";
        if (/pro|enterprise|erp/i.test(prodRaw) || /sàn|thương mại/i.test(ch)) mappedProd = "NV-ERP";
        else if (/growth|crm|website/i.test(prodRaw) || /website/i.test(ch)) mappedProd = "NV-CRM";

        const orderPart = ordersVal !== null && ordersVal !== undefined && String(ordersVal).trim() !== ""
          ? `, Số đơn: ${ordersVal}`
          : "";

        return {
          lead_id: `R${String(idx + 1).padStart(3, "0")}`,
          company_name: `Đơn vị Kinh doanh ${reg} – Kênh ${ch}${prodRaw ? ` (${prodRaw})` : ""}`,
          tax_code: `0318800${String(segId).padStart(3, "0")}`,
          contact_name: `Phụ trách ${ch} (${reg})`,
          phone: `0908000${String(segId).padStart(3, "0")}`,
          email: `kinhdoanh.seg${segId}@namviet.vn`,
          industry: "Bán lẻ",
          region: reg,
          product_interest: mappedProd,
          need_description: `[Kỳ ${monthVal}] Kênh ${ch} tại ${reg}${prodRaw ? ` (${prodRaw})` : ""}: Doanh thu đạt ${Number(revVal || 0).toLocaleString("vi-VN")} VND${orderPart}`,
          budget_vnd: revVal || "0",
          source_channel: ch,
          registered_at: /^\d{4}-\d{2}$/.test(String(monthVal).trim()) ? `${String(monthVal).trim()}-01` : String(monthVal)
        };
      });
    }
    const dedupResult = skills.toolNormalizeAndDeduplicate(processRows, runtimeConfig);
    recordTrace(
      "Phát hiện cùng một doanh nghiệp có thể đăng ký nhiều lần với tên viết tắt hoặc kênh khác nhau. Gọi công cụ chuẩn hóa và gom nhóm hồ sơ trùng.",
      "normalize_and_deduplicate_leads",
      { raw_lead_count: parsedDataset.rows.length },
      [
        "exact_match: tax_code -> phone -> email",
        `fuzzy_company_similarity >= ${runtimeConfig.deduplication_rules?.fuzzy_company_similarity_threshold ?? 0.78}`,
        `ambiguous_review_band: [${runtimeConfig.deduplication_rules?.ambiguous_similarity_low ?? 0.62}, ${runtimeConfig.deduplication_rules?.ambiguous_similarity_high ?? 0.78})`
      ],
      {
        unique_customers: dedupResult.unique_customer_count,
        merged_duplicates: dedupResult.merged_duplicates_count,
        ambiguous_cases: dedupResult.ambiguous_count,
        sample_merges: dedupResult.rules_triggered.slice(0, 6)
      }
    );

    // STEP 3: Skill 2 - History, Product Fit & Missing Info
    const analyzed = skills.toolAnalyzeNeedsHistoryAndMissing(dedupResult.customers, runtimeConfig);
    const dncMatches = analyzed.filter(c => c.is_do_not_contact).map(c => c.company_name);
    const wrongProdMatches = analyzed.filter(c => c.is_wrong_product).map(c => c.company_name);
    const incompleteCount = analyzed.filter(c => c.missing_fields.length > 0).length;

    recordTrace(
      "Đối chiếu từng khách hàng duy nhất với lịch sử liên hệ (tránh gọi lại khách đã từ chối/opt-out), kiểm tra khớp sản phẩm Minh Hoàng và trích xuất thông tin còn thiếu.",
      "analyze_needs_history_and_missing",
      { unique_customers: analyzed.length, history_records: (runtimeConfig.contact_history || []).length },
      ["contact_history_optout_check", "namviet_product_keyword_match", "wrong_product_guard", "missing_fields_extraction"],
      {
        do_not_contact_detected: dncMatches,
        wrong_product_detected: wrongProdMatches,
        profiles_with_missing_info: incompleteCount
      }
    );

    // STEP 4: Skill 3 - Priority Scoring
    const scored = skills.toolScorePriority(analyzed, runtimeConfig);
    const highCount = scored.filter(c => c.priority_level === "Cao").length;
    const medCount = scored.filter(c => c.priority_level === "Trung bình").length;
    const lowCount = scored.filter(c => c.priority_level === "Thấp").length;

    recordTrace(
      "Chấm điểm ưu tiên dựa trên độ phù hợp sản phẩm, độ rõ nhu cầu, ngân sách và kênh tiếp nhận; chặn bẫy ngân sách lớn nhưng sai sản phẩm và không bỏ sót hồ sơ thiếu ngân sách ban đầu.",
      "score_customer_priority",
      { customers_to_score: scored.length },
      [
        `weights: product_fit=${runtimeConfig.priority_rules?.weights?.product_fit}, need=${runtimeConfig.priority_rules?.weights?.need_clarity}, budget=${runtimeConfig.priority_rules?.weights?.budget_fit}, urgency=${runtimeConfig.priority_rules?.weights?.urgency_and_channel}`,
        `thresholds: Cao>=${runtimeConfig.priority_rules?.high_score_min}, Trung bình>=${runtimeConfig.priority_rules?.medium_score_min}`
      ],
      { Cao: highCount, "Trung bình": medCount, "Thấp": lowCount, "Không liên hệ lại": dncMatches.length }
    );

    // STEP 5: Skill 4 - Assignment & Outreach Drafting
    const assignResult = skills.toolAssignAndDraftOutreach(scored, runtimeConfig);
    const escalationCount = assignResult.customers.filter(c => c.needs_manager_decision).length;
    const unassignedCount = assignResult.customers.filter(c => c.assignment_status.startsWith("unassigned")).length;

    recordTrace(
      "Phân công cho 8 Nhân viên Kinh doanh theo nhóm ngành, khu vực, sản phẩm và định mức tải tuần; đánh dấu ca vượt thẩm quyền/tranh chấp cho Trưởng phòng và sinh bản nháp tiếp cận hoặc câu hỏi bổ sung.",
      "assign_salesperson_and_draft_outreach",
      { staff_count: (runtimeConfig.sales_staff || []).length, customers: assignResult.customers.length },
      [
        "domain_match: region + industry + product_group",
        "weekly_capacity_load_balancing",
        `vip_threshold >= ${runtimeConfig.priority_rules?.vip_budget_threshold_vnd}`,
        "ambiguous_duplicate_and_history_conflict_escalation",
        "contextual_outreach_or_clarifying_questions_draft"
      ],
      {
        escalated_to_manager: escalationCount,
        unassigned_no_domain_match: unassignedCount,
        drafts_generated: assignResult.customers.filter(c => !c.is_do_not_contact).length
      }
    );

    // STEP 6: Skill 5 - Compile Deduplicated Reports & Manager Tasks
    const report = skills.toolCompileReportsAndStats(assignResult.customers, assignResult.updatedStaffPool, parsedDataset.rows || []);
    recordTrace(
      "Tổng hợp số lượng khách hàng duy nhất theo mức ưu tiên và theo nhân viên (không đếm lặp hồ sơ trùng), lập danh sách công việc cho đội Kinh doanh và Trưởng phòng.",
      "compile_manager_report_and_stats",
      { deduplicated_customers: assignResult.customers.length },
      ["deduplicated_counting_only", "split_unassigned_dnc_manager_queues"],
      report.summary
    );

    // STEP 7: Dual-Brain Gemini LLM Semantic Enrichment & Executive Brief
    let executiveBrief = buildDeterministicExecutiveBrief(report, assignResult.customers);
    let llmUsed = false;
    let llmMeta = null;

    if (llmOptions && llmOptions.enabled) {
      try {
        const enrichInfo = await enrichEdgeLeadsWithLLM(assignResult.customers, llmOptions, feedback);
        if (enrichInfo) {
          llmUsed = true;
          llmMeta = enrichInfo;
          recordTrace(
            "Sử dụng Bộ não LLM Gemini để phân tích sâu các hồ sơ thiếu thông tin / ca ngoại lệ và nâng cấp bản nháp tiếp cận tiếng Việt.",
            "llm_semantic_enrichment",
            { edge_profiles_analyzed: enrichInfo.enriched_count },
            ["dual_brain_failover", "json_structured_enrichment"],
            {
              status: "success",
              brain_used: enrichInfo.brain_id,
              model_used: enrichInfo.model_used,
              latency_ms: enrichInfo.latency_ms,
              usage: enrichInfo.usage
            }
          );
        }

        const edgeCases = assignResult.customers
          .filter(c => c.needs_manager_decision || c.is_wrong_product || c.assignment_status === "unassigned")
          .map(c => ({
            id: c.customer_id,
            company: c.company_name,
            priority: c.priority_level,
            reasons: c.escalation_reasons
          }));
        const briefRes = await callLLMExecutiveReview({
          summaryStats: report.summary,
          edgeCases,
          llmOptions,
          feedback
        });
        executiveBrief = briefRes.content;
        llmUsed = true;
        llmMeta = briefRes;
        recordTrace(
          "Gọi Bộ não LLM Gemini tổng hợp Executive Brief điều hành cho Trưởng phòng Kinh doanh.",
          "llm_executive_synthesis",
          { summary: report.summary },
          ["dual_brain_failover", "executive_brief_synthesis"],
          {
            status: "success",
            brain_used: briefRes.brain_id,
            model_used: briefRes.model_used,
            latency_ms: briefRes.latency_ms,
            usage: briefRes.usage,
            brief_length: executiveBrief.length
          }
        );
      } catch (err) {
        recordTrace(
          "Bộ não LLM gặp lỗi mạng/giới hạn tạm thời, tự động giữ bản tổng hợp nội bộ an toàn của Agent.",
          "llm_executive_synthesis",
          { mode: llmOptions.apiKey ? "custom_key" : "server_dual_brain" },
          ["graceful_fallback"],
          { status: "fallback", error: err.message }
        );
      }
    }

    // STEP 8: Verify Output Quality Gate
    const interimOutput = { customers: assignResult.customers, report, trace };
    const verification = skills.toolVerifyPipelineOutput(interimOutput, parsedDataset, runtimeConfig);
    recordTrace(
      "Kiểm chứng (Verify) chất lượng đầu ra của Process trước khi chuyển sang Báo cáo & Dashboard.",
      "verify_pipeline_output",
      { customers: assignResult.customers.length },
      ["integrity_no_double_count", "wrong_product_guard", "dnc_guard", "vip_escalation_guard", "draft_and_trace_check"],
      { passed: verification.passed, summary: verification.summary }
    );

    // Persist JSONL Audit Log to local server if available
    let savedLogFile = null;
    try {
      const saveRes = await fetch("/api/save-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId, events: trace })
      });
      if (saveRes.ok) {
        const saveData = await saveRes.json();
        savedLogFile = saveData.file || null;
      }
    } catch {
      // Static file mode fallback
    }

    return {
      run_id: runId,
      llm_used: llmUsed,
      llm_meta: llmMeta,
      saved_log_file: savedLogFile,
      executive_brief: executiveBrief,
      customers: assignResult.customers,
      report,
      verification,
      trace
    };
  }

  function buildDeterministicExecutiveBrief(report, customers) {
    const s = report.summary;
    const wrongProdCount = customers.filter(c => c.is_wrong_product).length;
    const incompleteCount = customers.filter(c => !c.is_do_not_contact && c.missing_fields.length > 0).length;
    return [
      `+ Đã tiếp nhận ${s.total_raw_records} hồ sơ gốc và gộp trùng thành ${s.unique_customers} khách hàng duy nhất (loại bỏ ${s.duplicates_merged} bản ghi trùng lặp giữa các kênh/tên viết tắt).`,
      `+ Phân bổ ưu tiên (không đếm lặp): ${s.by_priority["Cao"]} Cao, ${s.by_priority["Trung bình"]} Trung bình, ${s.by_priority["Thấp"]} Thấp, và ${s.do_not_contact_count} khách bị chặn theo lịch sử (Không liên hệ lại).`,
      `- Có ${s.manager_decision_count} trường hợp cần Trưởng phòng Kinh doanh quyết định (trùng tên mơ hồ, vượt ngưỡng VIP, tranh chấp người phụ trách cũ hoặc NVKD quá tải tuần).`,
      `- Phát hiện ${s.unassigned_count} khách chưa có NVKD khớp khu vực/ngành và ${wrongProdCount} hồ sơ sai sản phẩm (đã hạ ưu tiên dù ngân sách lớn).`,
      `+ Đã tạo sẵn bản nháp tiếp cận / bộ câu hỏi bổ sung cho ${incompleteCount} khách hàng thiếu thông tin ban đầu để NVKD không bỏ sót cơ hội.`
    ].join("\n");
  }

  async function runDashboardAgentAnalysis({
    datasetLabel = "Dữ liệu hiện tại",
    rawRows = [],
    normalizedRows = [],
    headers = [],
    period = "all",
    metrics = {},
    businessContext = null,
    llmOptions = {}
  }) {
    const runId = "AGENT-DASH-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const trace = [];

    const formatVNDText = (v) => Math.round(v || 0).toLocaleString("vi-VN") + " VND";

    // 1. Trace Step: Scan File & Column Schema
    trace.push({
      run_id: runId,
      step: 1,
      timestamp: new Date().toISOString(),
      thought: `Agent rà soát cấu trúc file '${datasetLabel}' (${rawRows.length} dòng · ${headers.length} cột · ${metrics.domainName || "Kinh doanh"}).`,
      tool_called: "scan_file_and_schema",
      input_summary: { total_rows: rawRows.length, headers, domain: metrics.domainType },
      rules_applied: ["schema_header_detection", "data_type_verification", "domain_classification"],
      output_summary: {
        domain_type: metrics.domainType,
        domain_name: metrics.domainName,
        kpi_count: (metrics.kpis || []).length,
        primary_metric: metrics.primaryMetricLabel,
        primary_dimension: metrics.dim1Label
      }
    });

    // 2. Trace Step: KPI Computation & Cross-Dimensional Verification
    trace.push({
      run_id: runId,
      step: 2,
      timestamp: new Date().toISOString(),
      thought: "Tính toán chính xác tổng các chỉ số KPI theo dữ liệu file (không bịa số liệu khi file thiếu cột).",
      tool_called: "compute_strict_kpis",
      input_summary: { period, filtered_rows: metrics.currRowsCount || rawRows.length },
      rules_applied: ["polymorphic_kpi_computation", "dynamic_dimensional_aggregation", "strict_data_truthfulness"],
      output_summary: {
        kpis: (metrics.kpis || []).map(k => `${k.title}: ${k.value}`),
        top_primary: metrics.topPrimaryGroup?.name,
        top_secondary: metrics.topSecondaryGroup?.name
      }
    });

    // 3. Formulate Analysis Context for AI Synthesis (including User Scope, Q&A & Chat Directives)
    const userQuestionsList = (businessContext?.analysisQuestions || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
    const dynamicQA = Array.isArray(businessContext?.dynamicQA) ? businessContext.dynamicQA : [];
    const userChatLog = Array.isArray(businessContext?.chatHistory)
      ? businessContext.chatHistory.filter(m => m.role === "user").slice(-6).map(m => m.text)
      : [];
    const directives = businessContext?.directives || {};
    const precomputedQA = Array.isArray(metrics.precomputedQA) ? metrics.precomputedQA : [];

    const promptData = {
      dataset_name: datasetLabel,
      domain_type: metrics.domainType || "custom",
      domain_name: metrics.domainName || "Tổng hợp dữ liệu kinh doanh",
      total_rows: rawRows.length,
      filtered_rows: metrics.currRowsCount || rawRows.length,
      headers: headers,
      period: metrics.activePeriodName || period,
      kpis: (metrics.kpis || []).map(k => `${k.title}: ${k.value} (${k.unit}) [${k.delta}]`),
      primary_metric: metrics.primaryMetricLabel || "Giá trị chính",
      secondary_metric: metrics.secondaryMetricLabel || "Giá trị phụ",
      primary_dimension: metrics.dim1Label || "Phân loại chính",
      top_primary_group: `${metrics.topPrimaryGroup?.name || "Chủ lực"} (${formatVNDText(metrics.topPrimaryGroup?.val)}, ${metrics.topPrimaryGroup?.sharePct ?? metrics.topPrimaryGroup?.pct ?? 0}%)`,
      secondary_dimension: metrics.dim2Label || "Phân loại thứ 2",
      top_secondary_group: `${metrics.topSecondaryGroup?.name || "Chủ lực"} (${formatVNDText(metrics.topSecondaryGroup?.val)})`,
      variance_summary: metrics.varianceTop ? `${metrics.varianceTop.name} (${metrics.varianceTop.valText})` : "Ổn định",
      missing_data_warning: metrics.blankGroupCount > 0 ? `Có ${metrics.blankGroupCount} dòng thiếu nhóm (${formatVNDText(metrics.blankGroupVal)})` : "Không có dòng trống",
      business_context: businessContext?.businessType || metrics.domainName || "Doanh nghiệp phân tích kinh doanh",
      extra_info: businessContext?.extraInfo || "",
      user_questions: userQuestionsList,
      user_clarification_answers: dynamicQA.map(q => ({ q: q.question, a: q.answer })).filter(x => x.a),
      user_chat_requests: userChatLog,
      active_directives: {
        focus_period: directives.focusPeriod || "auto",
        focus_metric: directives.focusMetricCol || metrics.colPrimaryMetric || "",
        focus_dimension: directives.focusDimCol || "",
        focus_groups: directives.focusGroupValues || [],
        target_goal: directives.targetGoal || null
      },
      precomputed_facts: precomputedQA.map(item => ({ q: item.question, fact: item.answer, evidence: item.evidence }))
    };

    let aiResult = null;
    let llmUsed = false;
    let llmMeta = null;

    try {
      const prompt =
        `Bạn là AI Agent Trợ lý Phân tích Kinh doanh & Báo cáo cấp cao của Minh Hoàng Software.\n` +
        `QUAN TRỌNG: Bạn BẮT BUỘC phải trả lời ĐÚNG các câu hỏi (user_questions), câu trả lời làm rõ (user_clarification_answers) và yêu cầu trao đổi (user_chat_requests) mà người dùng đã cung cấp trước đó, sử dụng CHÍNH XÁC số liệu thực tế trong dữ liệu dưới đây (không bịa số liệu).\n` +
        `Lĩnh vực: ${promptData.domain_name}\n` +
        `${JSON.stringify(promptData, null, 2)}\n\n` +
        `Yêu cầu cấu trúc JSON thuần trả về (CHỈ TRẢ VỀ JSON, không bọc markdown \`\`\`):\n` +
        `{\n` +
        `  "executive_brief": "Đoạn 4-6 dòng, mỗi dòng BẮT BUỘC bắt đầu bằng '+' cho điểm sáng/kết quả trả lời đúng trọng tâm người dùng hoặc '-' cho rủi ro/cảnh báo/hành động cần làm",\n` +
        `  "question_answers": [\n` +
        `    {"question": "Câu hỏi người dùng đặt ra", "answer": "Câu trả lời trực diện, sắc sảo dựa trên số liệu thật trong file (2-3 câu)", "evidence": "Dẫn chứng số liệu cụ thể"}\n` +
        `  ],\n` +
        `  "conclusions": ["3-4 kết luận quản trị bám sát trực tiếp các câu hỏi và chỉ tiêu người dùng đã yêu cầu"],\n` +
        `  "actions": [\n` +
        `    {"type": "positive", "badge": "+", "text": "Hành động chiến lược 1 phục vụ đúng quyết định người dùng nêu..."},\n` +
        `    {"type": "positive", "badge": "+", "text": "Hành động mở rộng 2..."},\n` +
        `    {"type": "warning", "badge": "-", "text": "Kiểm soát rủi ro hoặc đạt mục tiêu 3..."}\n` +
        `  ],\n` +
        `  "topic_channel_insight": "1-2 câu nhận định chuyên sâu về đóng góp của ${promptData.primary_dimension} gắn với mục tiêu người dùng",\n` +
        `  "topic_secondary_insight": "1-2 câu nhận định chuyên sâu về đóng góp của ${promptData.secondary_dimension}",\n` +
        `  "strategic_recommendation": "1 đoạn khuyến nghị điều hành 2-3 câu giải quyết trực tiếp bài toán người dùng đã trao đổi"\n` +
        `}`;

      const res = await callLLM({
        messages: [
          { role: "system", content: "Bạn là chuyên gia phân tích dữ liệu kinh doanh B2B chính xác, tương tác chân thật, trả lời đúng câu hỏi người dùng đặt ra. Trả về JSON 100% hợp lệ." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        llmOptions
      });

      const parsed = safeParseJson(res.content);
      if (!parsed || typeof parsed !== "object") throw new Error("JSON không hợp lệ từ LLM");
      aiResult = parsed;
      llmUsed = true;
      llmMeta = {
        brain_id: res.brain_id,
        model_used: res.model_used,
        latency_ms: res.latency_ms
      };

      trace.push({
        run_id: runId,
        step: 3,
        timestamp: new Date().toISOString(),
        thought: "Bộ não AI Gemini đã đối chiếu toàn bộ yêu cầu & câu hỏi của người dùng với số liệu thực tế trong file để lập báo cáo.",
        tool_called: "llm_business_analysis",
        input_summary: { model: res.model_used, brain: res.brain_id, user_questions_count: userQuestionsList.length },
        rules_applied: ["gemini_thematic_synthesis", "user_scope_alignment", "executive_brief_formatting"],
        output_summary: { status: "success", latency_ms: res.latency_ms }
      });
    } catch {
      // Deterministic Local Agent Fallback if API offline or limit reached
      trace.push({
        run_id: runId,
        step: 3,
        timestamp: new Date().toISOString(),
        thought: "Chạy chế độ Local Agent đối chiếu trực tiếp câu hỏi người dùng với số liệu thực tế trong file.",
        tool_called: "local_agent_synthesis",
        input_summary: { mode: "deterministic_rules", domain: metrics.domainType, user_questions_count: userQuestionsList.length },
        rules_applied: ["local_adaptive_synthesis", "user_scope_alignment"],
        output_summary: { status: "local_fallback" }
      });

      const topCh = metrics.topPrimaryGroup?.name || "Chủ lực";
      const topChShare = metrics.topPrimaryGroup?.sharePct ?? metrics.topPrimaryGroup?.pct ?? 0;
      const topSec = metrics.topSecondaryGroup?.name || "Phân loại chính";
      const primaryMetricLabel = metrics.primaryMetricLabel || "Giá trị chính";
      const dim1Label = metrics.dim1Label || "Phân loại chính";
      const dim2Label = metrics.dim2Label || "Phân loại thứ 2";
      const coreQ = userQuestionsList[0] || "Động lực tăng trưởng và cơ cấu đóng góp chính?";

      // Crisp, high-signal 4-bullet Executive Brief (fits cleanly in 2x2 grid, zero redundancy)
      const briefBullets = [];
      briefBullets.push(`+ Phạm vi: ${promptData.period} (${metrics.currRowsCount || rawRows.length}/${rawRows.length} dòng) · ${primaryMetricLabel}: ${formatVNDText(metrics.currPrimaryTotal)}.`);
      briefBullets.push(`+ Dẫn đầu (${dim1Label}): "${topCh}" đóng góp ${formatVNDText(metrics.topPrimaryGroup?.val)} (${topChShare}% toàn bộ).`);
      if (metrics.varianceTop) {
        const sign = metrics.varianceTop.isPositive ? "+" : "-";
        briefBullets.push(`${sign} Biến động mạnh nhất: "${metrics.varianceTop.name}" (${metrics.varianceTop.valText}).`);
      } else if (directives.targetGoal?.label) {
        briefBullets.push(`- Mục tiêu người dùng (${directives.targetGoal.label}): Hiện đạt ${formatVNDText(metrics.currPrimaryTotal)}.`);
      } else {
        briefBullets.push(`+ Phân khúc thứ 2 (${dim2Label}): "${topSec}" dẫn đầu (${formatVNDText(metrics.topSecondaryGroup?.val)}).`);
      }
      if (metrics.blankGroupCount > 0) {
        briefBullets.push(`- Cảnh báo: ${metrics.blankGroupCount} dòng thiếu phân loại (${formatVNDText(metrics.blankGroupVal)}) cần chuẩn hóa.`);
      } else {
        briefBullets.push(`+ Chất lượng dữ liệu sạch 100%, đã đối chiếu theo đúng câu hỏi người dùng.`);
      }

      const decisionAnswer = dynamicQA.find(q => q.role === "decision" || q.role === "target")?.answer;

      aiResult = {
        executive_brief: briefBullets.join("\n"),
        question_answers: precomputedQA.length ? precomputedQA : [{
          question: coreQ,
          answer: `"${topCh}" dẫn đầu theo ${dim1Label} với ${formatVNDText(metrics.topPrimaryGroup?.val)} (${topChShare}%).`,
          evidence: `${promptData.period} · ${metrics.currRowsCount || rawRows.length} dòng.`
        }],
        conclusions: [
          `Dẫn đầu ${dim1Label}: "${topCh}" đạt ${formatVNDText(metrics.topPrimaryGroup?.val)} (${topChShare}%).`,
          `Dẫn đầu ${dim2Label}: "${topSec}" đạt ${formatVNDText(metrics.topSecondaryGroup?.val)}.`,
          metrics.varianceTop ? `Biến động lớn nhất: "${metrics.varianceTop.name}" (${metrics.varianceTop.valText}).` : `Số liệu ổn định qua ${metrics.monthsCount || 1} kỳ.`,
          decisionAnswer ? `Định hướng trọng tâm: ${decisionAnswer}` : `100% số liệu trích trực tiếp từ ${rawRows.length} dòng sạch.`
        ],
        actions: [
          {
            type: "positive",
            badge: "+",
            text: `Mở rộng nhóm chủ lực "${topCh}" (${dim1Label}): đang dẫn đầu với ${formatVNDText(metrics.topPrimaryGroup?.val)} (${topChShare}%).`
          },
          {
            type: "positive",
            badge: "+",
            text: decisionAnswer
              ? `Ưu tiên thực thi "${decisionAnswer}" dựa trên kết quả của "${topCh}" và "${topSec}".`
              : `Đẩy mạnh khai thác phân khúc "${topSec}" (${dim2Label}) để mở rộng tăng trưởng.`
          },
          {
            type: "warning",
            badge: "-",
            text: metrics.blankGroupCount > 0
              ? `Bổ sung phân loại cho ${metrics.blankGroupCount} dòng trống (${formatVNDText(metrics.blankGroupVal)}).`
              : `Kiểm soát sát nhóm biến động "${metrics.varianceTop?.name || topCh}" ở kỳ kế tiếp.`
          }
        ],
        topic_channel_insight: `"${topCh}" dẫn đầu theo ${dim1Label} với ${formatVNDText(metrics.topPrimaryGroup?.val)} (${topChShare}% · ${metrics.topPrimaryGroup?.rowsCount || 0}/${rawRows.length} dòng).`,
        topic_secondary_insight: `"${topSec}" dẫn đầu theo ${dim2Label} với ${formatVNDText(metrics.topSecondaryGroup?.val)}.`,
        strategic_recommendation: `Tập trung mở rộng "${topCh}" và tối ưu "${topSec}", đồng thời bám sát biến động ${metrics.varianceTop?.name || "kỳ tiếp theo"} để nâng cao ${primaryMetricLabel}.`
      };
    }

    const finalQuestionAnswers = (Array.isArray(aiResult.question_answers) && aiResult.question_answers.length > 0)
      ? aiResult.question_answers
      : precomputedQA;

    const topShareDisplay = metrics.topPrimaryGroup?.sharePct ?? metrics.topPrimaryGroup?.pct ?? 0;

    // 4. Build Balanced 2-Column Detailed Report HTML (Zero Empty Space, High Signal)
    const qaHtmlBlock = finalQuestionAnswers.length > 0 ? `
      <div class="report-block report-block-full interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> 0. Giải đáp Trọng tâm theo Yêu cầu Người dùng</strong>
        <div class="report-qa-grid-2col">
          ${finalQuestionAnswers.map((qa, idx) => `
            <div class="report-qa-mini">
              <div class="report-qa-q">Q${idx + 1}. ${escapeHtml(qa.question)}</div>
              <div class="report-qa-a">${escapeHtml(qa.answer)}</div>
              ${qa.evidence ? `<div class="report-qa-ev">${escapeHtml(qa.evidence)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    ` : "";

    const detailedReportHtml = `
      ${qaHtmlBlock}
      <div class="report-block interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> I. Tổng quan Chỉ số KPI (${escapeHtml(metrics.activePeriodName || period)})</strong>
        <ul class="report-sign-list">
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span><strong>Phạm vi:</strong> ${escapeHtml(metrics.domainName || "Kinh doanh")} · ${metrics.currRowsCount || rawRows.length}/${rawRows.length} dòng.</span></li>
          ${(metrics.kpis || []).map(k => {
            const isNeg = String(k.delta || "").trim().startsWith("-") || k.isPositive === false;
            return `
            <li class="sign-item ${isNeg ? "sign-neg" : "sign-pos"}">
              <span class="sign-tag ${isNeg ? "sign-minus" : "sign-plus"}">${isNeg ? "-" : "+"}</span>
              <span><strong>${escapeHtml(k.title)}:</strong> <strong style="color:#92400e;">${escapeHtml(k.value)}</strong> · <em>${escapeHtml(k.delta)}</em></span>
            </li>`;
          }).join("")}
        </ul>
      </div>
      <div class="report-block interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> II. Cơ cấu Chiều Phân loại &amp; Địa bàn</strong>
        <ul class="report-sign-list">
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span><strong>Dẫn đầu (${escapeHtml(metrics.dim1Label || "Nhóm 1")}):</strong> ${escapeHtml(metrics.topPrimaryGroup?.name || "Chung")} — <strong style="color:#92400e;">${formatVNDText(metrics.topPrimaryGroup?.val)}</strong> (${topShareDisplay}%).</span></li>
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span><strong>Dẫn đầu (${escapeHtml(metrics.dim2Label || "Nhóm 2")}):</strong> ${escapeHtml(metrics.topSecondaryGroup?.name || "Chung")} — <strong style="color:#92400e;">${formatVNDText(metrics.topSecondaryGroup?.val)}</strong>.</span></li>
          ${metrics.varianceTop ? `<li class="sign-item ${metrics.varianceTop.isPositive ? "sign-pos" : "sign-neg"}"><span class="sign-tag ${metrics.varianceTop.isPositive ? "sign-plus" : "sign-minus"}">${metrics.varianceTop.isPositive ? "+" : "-"}</span> <span><strong>Biến động mạnh nhất:</strong> ${escapeHtml(metrics.varianceTop.name)} (${escapeHtml(metrics.varianceTop.valText)}).</span></li>` : ""}
        </ul>
      </div>
      <div class="report-block interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> III. Rủi ro &amp; Khuyến nghị Điều hành</strong>
        <ul class="report-sign-list">
          ${metrics.blankGroupCount > 0 ? `<li class="sign-item sign-neg"><span class="sign-tag sign-minus">-</span> <span><strong>Khuyết dữ liệu:</strong> ${metrics.blankGroupCount} dòng trống (${formatVNDText(metrics.blankGroupVal)}).</span></li>` : `<li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span><strong>Chất lượng dữ liệu:</strong> Đầy đủ 100%, không khuyết nhóm phân loại.</span></li>`}
          <li class="sign-item sign-pos"><span class="sign-tag sign-plus">+</span> <span>${escapeHtml(aiResult.strategic_recommendation || "Duy trì rà soát định kỳ trước khi chốt kỳ báo cáo.")}</span></li>
        </ul>
      </div>
      <div class="report-block interactive-panel">
        <strong class="rb-title"><span class="star-yellow">✳</span> IV. Kế hoạch Hành động Ưu tiên</strong>
        <ul class="report-sign-list">
          ${(aiResult.actions || []).map(a => `
            <li class="sign-item ${a.type === "positive" ? "sign-pos" : "sign-neg"}">
              <span class="sign-tag ${a.badge === "+" ? "sign-plus" : "sign-minus"}">${escapeHtml(a.badge)}</span>
              <span>${escapeHtml(a.text)}</span>
            </li>
          `).join("")}
        </ul>
      </div>
    `;

    return {
      run_id: runId,
      executive_brief: aiResult.executive_brief,
      question_answers: finalQuestionAnswers,
      conclusions: aiResult.conclusions || [],
      actions: aiResult.actions || [],
      topic_channel_insight: aiResult.topic_channel_insight,
      topic_secondary_insight: aiResult.topic_secondary_insight,
      detailed_report_html: detailedReportHtml,
      llm_used: llmUsed,
      llm_meta: llmMeta,
      trace
    };
  }

  // =========================================================================
  // INTERACTIVE AI SCOPE GENERATOR (100% DATA-DRIVEN FROM UPLOADED FILE)
  // =========================================================================
  function buildLocalInteractiveScope({ datasetLabel, dataProfile, userBusinessType, userQuestions, iteration = 0 }) {
    const p = dataProfile || {};
    const domainName = userBusinessType || p.domainName || "Phân tích dữ liệu kinh doanh";
    const rowCount = p.rowCount || 0;
    const colCount = (p.headers || []).length;
    const periods = p.sortedPeriods || [];
    const firstP = p.periodNames?.[0] || periods[0] || "";
    const lastP = p.periodNames?.[p.periodNames.length - 1] || periods[periods.length - 1] || "";
    const prevP = p.periodNames?.length >= 2 ? p.periodNames[p.periodNames.length - 2] : "";
    const dim1 = p.dimensions?.[0] || null;
    const dim2 = p.dimensions?.[1] || null;
    const m1 = p.metrics?.[0] || null;
    const m2 = p.metrics?.[1] || null;
    const m3 = p.metrics?.[2] || null;

    const topDim1Val = dim1?.topValues?.[0] || null;
    const lowDim1Val = dim1?.topValues?.[dim1.topValues.length - 1] || null;
    const topDim1ListStr = dim1?.topValues?.slice(0, 4).map(v => `${v.name} (${v.count} dòng)`).join(", ") || "";
    const dim2ListStr = dim2?.topValues?.slice(0, 4).map(v => v.name).join(", ") || "";
    const peakP = p.peakPeriod || null;
    const troughP = p.troughPeriod || null;

    const angleIdx = iteration % 3;
    const angleTitles = [
      "Góc nhìn #1 · Phạm vi thời gian, Phân nhóm & Chỉ số ưu tiên",
      "Góc nhìn #2 · Đào sâu nhóm dẫn đầu, Độ tập trung & Bất thường",
      "Góc nhìn #3 · Đối chiếu chéo chỉ số & Đặt mục tiêu hành động"
    ];

    // Suggested angles (clickable to add to user questions)
    const suggestedAngles = [];
    if (dim1 && m1) {
      suggestedAngles.push({
        label: `Xếp hạng đóng góp ${m1.name} theo từng nhóm trong "${dim1.name}" (${dim1.topValues.slice(0, 3).map(v => v.name).join(", ")})`,
        question: `Trong cột ${dim1.name}, nhóm nào đóng góp ${m1.name} cao nhất và thấp nhất?`
      });
    }
    if (periods.length >= 2 && m1) {
      suggestedAngles.push({
        label: `Đánh giá xu hướng tăng/giảm ${m1.name} qua ${periods.length} kỳ (${firstP} → ${lastP}), đặc biệt đỉnh ${peakP?.label || lastP}`,
        question: `Xu hướng ${m1.name} biến động thế nào từ ${firstP} đến ${lastP} và nhóm nào tạo ra thay đổi lớn nhất?`
      });
    }
    if (m1 && m2) {
      suggestedAngles.push({
        label: `Đối chiếu tương quan giữa "${m1.name}" (${formatMetricNum(m1.sum, m1.isCurr)}) và "${m2.name}" (${formatMetricNum(m2.sum, m2.isCurr)})`,
        question: `Tỷ lệ đối chiếu giữa ${m1.name} và ${m2.name} theo từng ${dim1?.name || "nhóm"} chênh lệch ra sao?`
      });
    }
    if (dim2 && m1) {
      suggestedAngles.push({
        label: `Phân tích chéo "${dim1?.name || "Nhóm chính"}" kết hợp "${dim2.name}" (${dim2ListStr})`,
        question: `Nếu phân tích theo ${dim2.name} (${dim2ListStr}), đâu là điểm sáng và điểm nghẽn?`
      });
    }
    if (p.blankCount > 0) {
      suggestedAngles.push({
        label: `Rà soát ${p.blankCount} ô/dòng bị khuyết thông tin trong file để tránh sai lệch tổng hợp`,
        question: `Các dòng bị thiếu dữ liệu ảnh hưởng thế nào đến tổng ${m1?.name || "chỉ số chính"}?`
      });
    }

    // Build genuinely DIFFERENT clarifying questions per angle, 100% grounded in actual file contents!
    const questions = [];

    if (angleIdx === 0) {
      // ANGLE 0: Core Scope (Periods, Primary Dimension Groups, Priority Metric, Decision)
      if (periods.length >= 2) {
        questions.push({
          id: "q_period",
          role: "period",
          source_fact: `Cột ${p.dateColLabel || p.dateCol} · ${periods.length} kỳ (${firstP} – ${lastP})`,
          question: `File "${datasetLabel}" có dữ liệu trải dài ${periods.length} kỳ từ ${firstP} đến ${lastP} (cao nhất là ${peakP?.label || lastP} đạt ${formatMetricNum(peakP?.val || 0, m1?.isCurr !== false)}). Bạn muốn Dashboard hiển thị toàn bộ ${periods.length} kỳ hay tập trung vào kỳ cụ thể nào?`,
          quick_chips: [
            `Xem toàn bộ ${periods.length} kỳ (${firstP} – ${lastP})`,
            `Tập trung kỳ mới nhất: ${lastP}`,
            prevP ? `So sánh ${lastP} với ${prevP}` : `Tập trung kỳ đỉnh: ${peakP?.label || lastP}`
          ],
          default_answer: `Xem toàn bộ ${periods.length} kỳ (${firstP} – ${lastP}) và đối chiếu xu hướng qua từng tháng.`
        });
      } else {
        questions.push({
          id: "q_period",
          role: "period",
          source_fact: `File có ${rowCount} dòng · ${colCount} cột`,
          question: `File "${datasetLabel}" gồm ${rowCount} bản ghi (không chia nhiều kỳ tháng). Bạn muốn đánh giá tổng thể toàn bộ ${rowCount} dòng hay chỉ tập trung Top bản ghi giá trị lớn nhất?`,
          quick_chips: [`Phân tích toàn bộ ${rowCount} dòng`, `Tập trung Top 10 bản ghi giá trị cao nhất`],
          default_answer: `Phân tích toàn bộ ${rowCount} dòng dữ liệu trong file.`
        });
      }

      if (dim1) {
        const groupChips = [`So sánh tất cả ${dim1.distinctCount} nhóm ${dim1.name}`];
        dim1.topValues.slice(0, 3).forEach(v => {
          groupChips.push(`Chỉ tập trung nhóm "${v.name}"`);
        });
        questions.push({
          id: "q_dimension",
          role: "dimension",
          source_fact: `Cột ${dim1.name} · ${dim1.distinctCount} phân nhóm`,
          question: `Trong cột "${dim1.name}", file chứa các nhóm: ${topDim1ListStr}. Bạn muốn so sánh toàn bộ các nhóm này hay lọc riêng một nhóm cụ thể trên Dashboard?`,
          quick_chips: groupChips,
          default_answer: `So sánh tất cả ${dim1.distinctCount} nhóm ${dim1.name} để thấy rõ đóng góp của "${topDim1Val?.name || ""}".`
        });
      }

      if (m1) {
        const metricChips = [];
        p.metrics.slice(0, 3).forEach(m => {
          metricChips.push(`Ưu tiên ${m.name}`);
        });
        if (m1 && m2) metricChips.push(`Đối chiếu cả ${m1.name} & ${m2.name}`);
        const metricSummary = p.metrics.slice(0, 3).map(m => `${m.name} (${formatMetricNum(m.sum, m.isCurr)})`).join(", ");
        questions.push({
          id: "q_metric",
          role: "metric",
          source_fact: `Các cột số đo trong file (${p.metrics.length} chỉ số)`,
          question: `Tôi phát hiện các chỉ số chính trong file gồm: ${metricSummary}. Bạn muốn Dashboard lấy chỉ số nào làm trục biểu đồ chính để ra quyết định?`,
          quick_chips: metricChips,
          default_answer: `Ưu tiên ${m1.name}${m2 ? ` kết hợp đối chiếu với ${m2.name}` : ""}.`
        });
      }

      questions.push({
        id: "q_target",
        role: "target",
        source_fact: `Ngưỡng & Mục tiêu điều hành`,
        question: `Với quy mô hiện tại (${m1 ? `${m1.name} đạt ${formatMetricNum(m1.sum, m1.isCurr)}` : `${rowCount} bản ghi`}), bạn có đặt chỉ tiêu mục tiêu cụ thể nào (VD: tăng trưởng +15% hoặc mốc doanh thu/ngân sách mục tiêu) để AI đối chiếu trên báo cáo không?`,
        quick_chips: [
          `Đặt mục tiêu tăng trưởng +10% kỳ tới`,
          m1 ? `Đặt mục tiêu ${m1.name} đạt ${formatMetricNum(Math.round((m1.sum * 1.15) / 1000000) * 1000000 || Math.round(m1.sum * 1.15), m1.isCurr)}` : `Đánh giá theo thực tế không áp KPI cứng`,
          `Cảnh báo nếu 1 nhóm chiếm > 50% tổng quy mô`
        ],
        default_answer: `Đánh giá thực tế theo số liệu file và đặt mục tiêu tăng trưởng +10% cho kỳ tiếp theo.`
      });

    } else if (angleIdx === 1) {
      // ANGLE 1: Segment Concentration, Risk & Cross-Dimension Deep Dive
      if (dim1 && topDim1Val) {
        questions.push({
          id: "q_concentration",
          role: "dimension",
          source_fact: `Rủi ro tập trung · ${topDim1Val.name} chiếm ${topDim1Val.pct}%`,
          question: `Dữ liệu cho thấy nhóm "${topDim1Val.name}" (${dim1.name}) đang chiếm tới ${topDim1Val.pct}% tổng ${m1?.name || "giá trị"} (${formatMetricNum(topDim1Val.val, m1?.isCurr !== false)}), trong khi nhóm nhỏ nhất "${lowDim1Val?.name || ""}" chỉ chiếm ${lowDim1Val?.pct || 0}%. Bạn muốn AI tập trung khai thác sâu nhóm dẫn đầu hay tìm phương án kéo nhóm thấp lên?`,
          quick_chips: [
            `Chỉ tập trung nhóm "${topDim1Val.name}"`,
            lowDim1Val && lowDim1Val.name !== topDim1Val.name ? `Chỉ tập trung nhóm "${lowDim1Val.name}"` : `Đánh giá rủi ro phụ thuộc vào ${topDim1Val.name}`,
            `So sánh khoảng cách giữa nhóm cao nhất & thấp nhất`
          ],
          default_answer: `So sánh khoảng cách giữa "${topDim1Val.name}" và "${lowDim1Val?.name || "các nhóm còn lại"}" để đề xuất phân bổ nguồn lực.`
        });
      }

      if (dim2) {
        questions.push({
          id: "q_dim2",
          role: "dimension_switch",
          source_fact: `Chiều phân loại thứ 2: ${dim2.name} (${dim2.distinctCount} nhóm)`,
          question: `Ngoài "${dim1?.name || "nhóm chính"}", file còn có cột "${dim2.name}" (${dim2ListStr}). Bạn có muốn đổi chiều phân tích chính của biểu đồ Donut & Báo cáo sang "${dim2.name}" không?`,
          quick_chips: [
            `Phân tích chính theo ${dim2.name}`,
            `Giữ phân tích chính theo ${dim1?.name || "nhóm chính"}`,
            `Kết hợp cả ${dim1?.name || "nhóm 1"} và ${dim2.name}`
          ],
          default_answer: `Kết hợp cả ${dim1?.name || "phân loại chính"} và ${dim2.name} trong báo cáo chuyên đề.`
        });
      }

      if (peakP && troughP && peakP.period !== troughP.period) {
        questions.push({
          id: "q_peak_trough",
          role: "period",
          source_fact: `Đỉnh: ${peakP.label} vs Đáy: ${troughP.label}`,
          question: `Giữa kỳ cao điểm nhất (${peakP.label}: ${formatMetricNum(peakP.val, m1?.isCurr !== false)}) và kỳ thấp nhất (${troughP.label}: ${formatMetricNum(troughP.val, m1?.isCurr !== false)}), bạn muốn AI mổ xẻ nguyên nhân chênh lệch ở kỳ nào trước?`,
          quick_chips: [
            `Tập trung kỳ cao điểm: ${peakP.label}`,
            `Tập trung kỳ thấp điểm: ${troughP.label}`,
            `So sánh toàn bộ ${periods.length} kỳ để thấy rõ xu hướng`
          ],
          default_answer: `So sánh toàn bộ ${periods.length} kỳ và giải thích rõ động lực tăng ở ${peakP.label}.`
        });
      }

      questions.push({
        id: "q_decision_angle1",
        role: "decision",
        source_fact: `Hành động quản trị · ${domainName}`,
        question: `Sau khi có kết quả báo cáo cho ${domainName}, quyết định hành động nào bạn dự kiến triển khai ngay trong tuần/tháng tới?`,
        quick_chips: [
          p.domainType === "contracts" ? `Tăng tỷ lệ chuyển đổi từ gói tháng/quý sang Hàng năm & nhắc tái ký sớm` : `Tái phân bổ nguồn lực sang nhóm hiệu quả cao nhất`,
          `Cắt giảm điểm kém hiệu quả & kiểm soát rủi ro`,
          `Trình bày báo cáo tổng hợp cho Ban Giám đốc`
        ],
        default_answer: p.domainType === "contracts"
          ? `Ưu tiên chăm sóc tái ký hợp đồng Hàng năm và thúc đẩy nâng cấp gói từ Hàng tháng/quý.`
          : `Tái phân bổ nguồn lực vào nhóm dẫn đầu và rà soát các nhóm tăng trưởng chậm.`
      });

    } else {
      // ANGLE 2: Cross-Metric Tradeoff, Secondary Metric Focus & Concrete Goals
      if (m2) {
        questions.push({
          id: "q_metric_swap",
          role: "metric",
          source_fact: `Đối chiếu ${m1?.name} vs ${m2.name}`,
          question: `Hiện tại "${m1?.name}" có tổng ${formatMetricNum(m1?.sum, m1?.isCurr)} còn "${m2.name}" đạt ${formatMetricNum(m2.sum, m2.isCurr)} (TB ${formatMetricNum(m2.avg, m2.isCurr)}/dòng). Bạn có muốn đảo trọng tâm Dashboard sang ưu tiên theo dõi "${m2.name}" thay vì "${m1?.name}" không?`,
          quick_chips: [
            `Ưu tiên ${m2.name}`,
            `Giữ ưu tiên ${m1?.name}`,
            `Đối chiếu song song ${m1?.name} và ${m2.name}`
          ],
          default_answer: `Đối chiếu song song ${m1?.name} và ${m2.name} để đánh giá đồng bộ hiệu quả.`
        });
      }

      if (m3) {
        questions.push({
          id: "q_aux_metric",
          role: "metric",
          source_fact: `Chỉ số phụ: ${m3.name} (TB ${formatMetricNum(m3.avg, m3.isCurr)})`,
          question: `Cột "${m3.name}" đang có giá trị trung bình ${formatMetricNum(m3.avg, m3.isCurr)} (tổng ${formatMetricNum(m3.sum, m3.isCurr)}). Bạn cần AI đưa ra cảnh báo hoặc phân nhóm sâu theo "${m3.name}" không?`,
          quick_chips: [
            `Có, phân tích sâu tác động của ${m3.name}`,
            `Chỉ cần hiển thị tóm tắt trên thẻ KPI`
          ],
          default_answer: `Có, phân tích sâu tác động của ${m3.name} đến kết quả chung.`
        });
      }

      questions.push({
        id: "q_entity_focus",
        role: "deepdive",
        source_fact: `Thực thể nổi bật (${p.entityColLabel || "Dòng dữ liệu"})`,
        question: `Trong ${rowCount} bản ghi của file, bạn muốn AI liệt kê chi tiết danh sách Top nhóm/bản ghi đóng góp lớn nhất hay tập trung cảnh báo các điểm bất thường / thiếu dữ liệu (${p.blankCount || 0} ô trống)?`,
        quick_chips: [
          `Liệt kê Top dẫn đầu & cơ hội mở rộng`,
          `Tập trung phát hiện rủi ro & bất thường`,
          `Cân bằng cả điểm sáng (+) và cảnh báo (-)`
        ],
        default_answer: `Cân bằng cả điểm sáng (+) và cảnh báo rủi ro (-) kèm hành động cụ thể.`
      });

      questions.push({
        id: "q_target_numeric",
        role: "target",
        source_fact: `Chỉ tiêu định lượng`,
        question: `Nếu cần gắn 1 con số mục tiêu cụ thể lên Dashboard (VD: mục tiêu ${m1?.name || "doanh thu"} đạt bao nhiêu VND hoặc mức tăng trưởng bao nhiêu %), bạn muốn nhập mức nào?`,
        quick_chips: [
          m1 ? `Mục tiêu ${formatMetricNum(Math.round((m1.sum * 1.1) / 1000000) * 1000000 || Math.round(m1.sum * 1.1), m1.isCurr)}` : `Mục tiêu tăng +10%`,
          m1 ? `Mục tiêu ${formatMetricNum(Math.round((m1.sum * 1.2) / 1000000) * 1000000 || Math.round(m1.sum * 1.2), m1.isCurr)}` : `Mục tiêu tăng +20%`,
          `Không đặt mục tiêu cứng, so sánh theo thực tế`
        ],
        default_answer: m1
          ? `Mục tiêu tăng trưởng +10% (hướng tới ${formatMetricNum(Math.round((m1.sum * 1.1) / 1000000) * 1000000 || Math.round(m1.sum * 1.1), m1.isCurr)}).`
          : `So sánh theo số liệu thực tế.`
      });
    }

    const qLines = (userQuestions || "").split("\n").map(s => s.trim()).filter(Boolean);
    const firstQ = qLines[0] || suggestedAngles[0]?.question || `Phân tích hiệu quả ${m1?.name || "chỉ số chính"}`;

    const understanding = `Tôi đã đọc trực tiếp file "${datasetLabel}" (${rowCount} dòng · ${colCount} cột), nhận diện lĩnh vực ${domainName}${periods.length >= 2 ? ` qua ${periods.length} kỳ (${firstP} – ${lastP})` : ""}. ` +
      `${m1 ? `Chỉ số nổi bật là ${m1.name} (${formatMetricNum(m1.sum, m1.isCurr)})` : ""}${topDim1Val ? ` với nhóm dẫn đầu "${topDim1Val.name}" chiếm ${topDim1Val.pct}%` : ""}. ` +
      `Trọng tâm hiện tại của bạn gồm ${qLines.length || 1} câu hỏi, bắt đầu với: "${firstQ}".`;

    const greeting = `Chào bạn! Tôi vừa quét xong file "${datasetLabel}" (${rowCount} dòng, ${colCount} cột — lĩnh vực ${domainName}).\n` +
      `• Điểm nổi bật đầu tiên: ${m1 ? `${m1.name} đạt tổng ${formatMetricNum(m1.sum, m1.isCurr)}` : `${rowCount} bản ghi hợp lệ`}` +
      `${topDim1Val ? `, trong đó "${topDim1Val.name}" (${dim1.name}) dẫn đầu với ${topDim1Val.pct}% tỷ trọng` : ""}.\n` +
      `${periods.length >= 2 ? `• Dữ liệu trải dài ${periods.length} kỳ (${firstP} → ${lastP}), cao điểm nhất tại ${peakP?.label || lastP}.\n` : ""}` +
      `Bạn có thể chọn nhanh câu trả lời ở các câu hỏi phía trên hoặc nhắn trực tiếp cho tôi ở đây (VD: "Chỉ xem nhóm ${topDim1Val?.name || "..."}", "Ưu tiên ${m2?.name || m1?.name || "chỉ số khác"}", hoặc hỏi số liệu bất kỳ trong file)!`;

    const quickChatPrompts = [
      topDim1Val ? `Chỉ tập trung phân tích nhóm ${topDim1Val.name}` : `Tóm tắt điểm nổi bật nhất trong file`,
      m2 ? `Ưu tiên phân tích ${m2.name} làm chỉ số chính` : `Kỳ nào có kết quả cao nhất?`,
      dim2 ? `Chuyển biểu đồ chính sang phân tích theo ${dim2.name}` : `Có rủi ro hay dữ liệu thiếu nào không?`,
      m1 ? `Đặt mục tiêu ${m1.name} tăng +15% so với hiện tại` : `Đề xuất hành động ưu tiên`
    ];

    return {
      angle_badge: angleTitles[angleIdx],
      understanding,
      suggested_angles: suggestedAngles.slice(0, 4),
      clarifying_questions: questions.slice(0, 4),
      greeting_message: greeting,
      quick_chat_prompts: quickChatPrompts,
      llm_used: false
    };
  }

  async function generateInteractiveScopeFromFile({
    datasetLabel = "Dữ liệu hiện tại",
    dataProfile = {},
    userBusinessType = "",
    userQuestions = "",
    iteration = 0,
    previousQuestions = [],
    llmOptions = {}
  }) {
    const localPack = buildLocalInteractiveScope({
      datasetLabel,
      dataProfile,
      userBusinessType,
      userQuestions,
      iteration
    });

    if (llmOptions && llmOptions.enabled === false) {
      return localPack;
    }

    try {
      const compactProfile = {
        file_name: datasetLabel,
        domain_name: dataProfile.domainName,
        row_count: dataProfile.rowCount,
        headers: dataProfile.headers,
        periods: dataProfile.periodNames,
        peak_period: dataProfile.peakPeriod,
        trough_period: dataProfile.troughPeriod,
        metrics: (dataProfile.metrics || []).slice(0, 4).map(m => ({
          col: m.col, name: m.name, sum: Math.round(m.sum), avg: Number(m.avg.toFixed(2)), isCurr: m.isCurr
        })),
        dimensions: (dataProfile.dimensions || []).slice(0, 3).map(d => ({
          col: d.col, name: d.name, distinct: d.distinctCount,
          top_values: d.topValues.slice(0, 4)
        })),
        blank_count: dataProfile.blankCount || 0,
        user_business_type: userBusinessType,
        user_questions: userQuestions,
        iteration_number: iteration + 1,
        avoid_repeating_previous_questions: previousQuestions.slice(-8)
      };

      const prompt =
        `Bạn là AI Agent Chuyên gia Tư vấn Dữ liệu & BI của Minh Hoàng Software đang trao đổi trực tiếp với người dùng trước khi dựng Dashboard.\n` +
        `BẠN ĐÃ ĐỌC XONG FILE THỰC TẾ dưới đây:\n${JSON.stringify(compactProfile, null, 2)}\n\n` +
        `YÊU CẦU BẮT BUỘC:\n` +
        `1. TUYỆT ĐỐI KHÔNG dùng câu hỏi mẫu chung chung dập khuôn! Mọi câu hỏi PHẢI trích dẫn trực tiếp tên cột, giá trị nhóm, khoảng thời gian hoặc con số thực tế có trong file trên.\n` +
        `2. Đây là lượt gợi ý thứ ${iteration + 1}. Hãy tạo bộ câu hỏi KHÁC BIỆT, khám phá góc nhìn mới so với danh sách avoid_repeating_previous_questions.\n` +
        `3. Mỗi câu hỏi cần có 2-4 "quick_chips" (gợi ý trả lời ngắn gọn lấy từ giá trị thực trong file để người dùng bấm chọn ngay) và "role" thuộc một trong: "period", "dimension", "metric", "target", "decision", "deepdive".\n` +
        `4. Chỉ trả về JSON thuần (KHÔNG bọc markdown \`\`\`):\n` +
        `{\n` +
        `  "angle_badge": "Góc nhìn #${iteration + 1} · Tiêu đề ngắn gọn góc phân tích này",\n` +
        `  "understanding": "2 câu tự nhiên chứng minh AI đã hiểu đúng file & số liệu thực tế và yêu cầu của người dùng",\n` +
        `  "suggested_angles": [\n` +
        `    {"label": "Mô tả ngắn góc nhìn từ số liệu thật trong file", "question": "1 câu hỏi phân tích cụ thể có thể bấm thêm ngay"}\n` +
        `  ],\n` +
        `  "clarifying_questions": [\n` +
        `    {\n` +
        `      "id": "q1",\n` +
        `      "role": "period|dimension|metric|target|decision",\n` +
        `      "source_fact": "Tên cột/dữ liệu kích hoạt câu hỏi (VD: Cột chu_ky_thu · 3 nhóm)",\n` +
        `      "question": "Câu hỏi tự nhiên, sắc sảo, trích dẫn đúng dữ liệu trong file",\n` +
        `      "quick_chips": ["Lựa chọn 1 từ file", "Lựa chọn 2 từ file", "Lựa chọn 3"],\n` +
        `      "default_answer": "Câu trả lời gợi ý hợp lý nhất"\n` +
        `    }\n` +
        `  ],\n` +
        `  "greeting_message": "Lời chào thân thiện, chân thật từ AI Agent nêu 2 phát hiện thú vị vừa đọc trong file và mời người dùng trao đổi thêm",\n` +
        `  "quick_chat_prompts": ["3-4 câu nhắn nhanh người dùng có thể bấm gửi ngay cho AI dựa trên file này"]\n` +
        `}`;

      const res = await callLLM({
        messages: [
          { role: "system", content: "Bạn là chuyên gia phân tích dữ liệu tương tác chân thật, luôn trích dẫn chính xác cột và số liệu từ file người dùng cung cấp. Chỉ trả về JSON hợp lệ 100%." },
          { role: "user", content: prompt }
        ],
        temperature: iteration > 0 ? 0.55 : 0.3,
        llmOptions
      });

      const parsed = safeParseJson(res.content);
      if (parsed && Array.isArray(parsed.clarifying_questions) && parsed.clarifying_questions.length >= 2) {
        return {
          angle_badge: parsed.angle_badge || localPack.angle_badge,
          understanding: parsed.understanding || localPack.understanding,
          suggested_angles: (Array.isArray(parsed.suggested_angles) && parsed.suggested_angles.length) ? parsed.suggested_angles : localPack.suggested_angles,
          clarifying_questions: parsed.clarifying_questions.slice(0, 4),
          greeting_message: parsed.greeting_message || localPack.greeting_message,
          quick_chat_prompts: (Array.isArray(parsed.quick_chat_prompts) && parsed.quick_chat_prompts.length) ? parsed.quick_chat_prompts : localPack.quick_chat_prompts,
          llm_used: true,
          model_used: res.model_used
        };
      }
      return localPack;
    } catch {
      return localPack;
    }
  }

  // =========================================================================
  // INTERACTIVE HUMAN <-> AI CHAT AGENT FOR FILE SCOPING & LIVE DATA Q&A
  // =========================================================================
  function buildLocalChatResponse({ message, datasetLabel, dataProfile }) {
    const p = dataProfile || {};
    const msg = String(message || "").trim();
    const low = msg.toLowerCase();
    const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    const nMsg = norm(msg);

    const m1 = p.metrics?.[0] || null;
    const dim1 = p.dimensions?.[0] || null;
    const dim2 = p.dimensions?.[1] || null;
    const extracted = {};
    const updatesText = [];
    const answers = [];

    // 1. Detect period intent
    if (/(toan bo|tat ca cac thang|tat ca ky|ca nam|all)/i.test(nMsg)) {
      extracted.focusPeriod = "all";
      updatesText.push(`Kỳ hiển thị: Toàn bộ ${p.sortedPeriods?.length || 1} kỳ`);
    } else if (p.sortedPeriods?.length) {
      for (let i = 0; i < p.sortedPeriods.length; i++) {
        const per = p.sortedPeriods[i]; // YYYY-MM
        const parts = per.split("-");
        const mm = parts[1];
        const mmInt = String(parseInt(mm, 10));
        if (nMsg.includes(per) || new RegExp(`thang\\s*0?${mmInt}\\b`).test(nMsg) || nMsg.includes(`${mm}/${parts[0]}`)) {
          extracted.focusPeriod = per;
          updatesText.push(`Kỳ tập trung: ${p.periodNames?.[i] || per}`);
          break;
        }
      }
      if (!extracted.focusPeriod && /(thang gan nhat|ky moi nhat|thang cuoi)/i.test(nMsg)) {
        const lastP = p.sortedPeriods[p.sortedPeriods.length - 1];
        extracted.focusPeriod = lastP;
        updatesText.push(`Kỳ tập trung: ${p.periodNames?.[p.periodNames.length - 1] || lastP}`);
      }
    }

    // 2. Detect metric priority
    if (p.metrics?.length) {
      for (const m of p.metrics) {
        const nm = norm(m.name);
        const nc = norm(m.col).replace(/_/g, " ");
        if ((nm && nMsg.includes(nm)) || (nc && nMsg.includes(nc))) {
          if (/(uu tien|tap trung|chinh|chon|doi sang|chuyen sang|xem|phan tich|muc tieu)/i.test(nMsg)) {
            extracted.focusMetricCol = m.col;
            updatesText.push(`Chỉ số ưu tiên: ${m.name}`);
            answers.push(`• Tổng "${m.name}" trong file là ${formatMetricNum(m.sum, m.isCurr)} (trung bình ${formatMetricNum(m.avg, m.isCurr)}/dòng).`);
            break;
          }
        }
      }
    }

    // 3. Detect dimension switch
    if (p.dimensions?.length) {
      for (const d of p.dimensions) {
        const nd = norm(d.name);
        const nc = norm(d.col).replace(/_/g, " ");
        if ((nd && nMsg.includes(nd)) || (nc && nMsg.includes(nc))) {
          if (/(theo|chuyen|doi sang|phan tich|chia theo)/i.test(nMsg)) {
            extracted.focusDimCol = d.col;
            updatesText.push(`Chiều phân tích chính: ${d.name}`);
            const breakdown = d.topValues.slice(0, 4).map(v => `${v.name}: ${formatMetricNum(v.val, m1?.isCurr !== false)} (${v.pct}%)`).join("; ");
            answers.push(`• Cơ cấu theo "${d.name}": ${breakdown}.`);
            break;
          }
        }
      }
    }

    // 4. Detect specific group filter (only if narrowing or naming specific value)
    if (/(bo loc|xem tat ca|tat ca nhom|so sanh tat ca)/i.test(nMsg)) {
      extracted.focusGroupValues = [];
      updatesText.push("Bộ lọc nhóm: Đã mở lại tất cả các nhóm");
    } else if (p.dimensions?.length) {
      const matchedGroups = [];
      for (const d of p.dimensions) {
        for (const v of d.topValues) {
          const nv = norm(v.name);
          if (nv.length >= 2 && nMsg.includes(nv)) {
            matchedGroups.push({ dim: d.name, ...v });
          }
        }
      }
      if (matchedGroups.length > 0 && /(chi |rieng |loc |tap trung |nhom )/i.test(nMsg)) {
        extracted.focusGroupValues = matchedGroups.map(g => g.name);
        updatesText.push(`Lọc tập trung nhóm: ${extracted.focusGroupValues.join(", ")}`);
      }
      if (matchedGroups.length > 0) {
        matchedGroups.forEach(g => {
          answers.push(`• Nhóm "${g.name}" (${g.dim}) có ${g.count} dòng, đạt ${formatMetricNum(g.val, m1?.isCurr !== false)} (${g.pct}% tổng ${m1?.name || "giá trị"}).`);
        });
      }
    }

    // 5. Detect target goal
    const goalTri = nMsg.match(/(\d+(?:[.,]\d+)?)\s*(trieu|tr\b)/i);
    const goalTy = nMsg.match(/(\d+(?:[.,]\d+)?)\s*(ty|ti\b)/i);
    const goalPct = nMsg.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
    if (goalTy) {
      const val = parseFloat(goalTy[1].replace(",", ".")) * 1e9;
      extracted.targetGoal = { type: "amount", value: val, label: formatMetricNum(val, true) };
      updatesText.push(`Mục tiêu định lượng: ${extracted.targetGoal.label}`);
    } else if (goalTri) {
      const val = parseFloat(goalTri[1].replace(",", ".")) * 1e6;
      extracted.targetGoal = { type: "amount", value: val, label: formatMetricNum(val, true) };
      updatesText.push(`Mục tiêu định lượng: ${extracted.targetGoal.label}`);
    } else if (goalPct && /(muc tieu|tang truong|dat|canh bao)/i.test(nMsg)) {
      const pctVal = parseFloat(goalPct[1].replace(",", "."));
      extracted.targetGoal = { type: "pct", value: pctVal, label: `${pctVal >= 0 ? "+" : ""}${pctVal}%` };
      updatesText.push(`Mục tiêu tăng trưởng: ${extracted.targetGoal.label}`);
    }

    // 6. Direct factual Q&A about file
    if (/(cao nhat|lon nhat|dan dau|top)/i.test(nMsg)) {
      if (/(thang|ky)/i.test(nMsg) && p.peakPeriod) {
        answers.push(`• Kỳ cao nhất trong file là ${p.peakPeriod.label} với ${formatMetricNum(p.peakPeriod.val, m1?.isCurr !== false)}.`);
      } else if (dim1?.topValues?.[0]) {
        const top = dim1.topValues[0];
        answers.push(`• Nhóm dẫn đầu theo "${dim1.name}" là "${top.name}" với ${formatMetricNum(top.val, m1?.isCurr !== false)} (${top.pct}%, ${top.count} dòng).`);
      }
    }
    if (/(thap nhat|it nhat|kem nhat)/i.test(nMsg)) {
      if (/(thang|ky)/i.test(nMsg) && p.troughPeriod) {
        answers.push(`• Kỳ thấp nhất trong file là ${p.troughPeriod.label} với ${formatMetricNum(p.troughPeriod.val, m1?.isCurr !== false)}.`);
      } else if (dim1?.topValues?.length) {
        const lowV = dim1.topValues[dim1.topValues.length - 1];
        answers.push(`• Nhóm thấp nhất theo "${dim1.name}" là "${lowV.name}" với ${formatMetricNum(lowV.val, m1?.isCurr !== false)} (${lowV.pct}%, ${lowV.count} dòng).`);
      }
    }
    if (/(thieu|trong|loi|rui ro|bat thuong)/i.test(nMsg)) {
      answers.push(p.blankCount > 0
        ? `• Tôi phát hiện ${p.blankCount} ô bị trống trong file "${datasetLabel}" cần lưu ý khi làm sạch.`
        : `• File "${datasetLabel}" hiện đầy đủ dữ liệu (${p.rowCount} dòng), không có ô phân loại bị trống.`);
    }

    // Treat genuine question marks as questions to add to the user's analysis list
    if (msg.includes("?") && msg.length >= 10) {
      extracted.addQuestion = msg;
    }

    let reply = "";
    if (answers.length > 0) {
      reply += `Dựa trên dữ liệu thực tế từ file "${datasetLabel}":\n${answers.join("\n")}\n`;
    }
    if (updatesText.length > 0) {
      reply += `${reply ? "\n" : ""}✓ Tôi đã cập nhật phạm vi cho Dashboard & Báo cáo phía sau:\n• ${updatesText.join("\n• ")}`;
    }
    if (!reply) {
      const top = dim1?.topValues?.[0];
      reply = `Tôi đã ghi nhận yêu cầu "${msg}" của bạn vào phạm vi phân tích cho file "${datasetLabel}" (${p.rowCount || 0} dòng).\n` +
        `${m1 ? `Hiện tại tổng ${m1.name} là ${formatMetricNum(m1.sum, m1.isCurr)}` : ""}${top ? ` và nhóm "${top.name}" đang dẫn đầu (${top.pct}%)` : ""}.\n` +
        `Khi bạn chuyển sang Dashboard KPI & Báo cáo, tôi sẽ giải đáp trực tiếp nội dung này bằng số liệu chi tiết!`;
      if (msg.length >= 8) extracted.addQuestion = msg;
    }

    const followUps = [
      dim2 ? `Thử phân tích theo ${dim2.name}` : `So sánh kỳ mới nhất với kỳ trước`,
      p.metrics?.[1] ? `Ưu tiên ${p.metrics[1].name} thay cho ${m1?.name || "chỉ số 1"}` : `Xem toàn bộ các kỳ`,
      `Nhóm nào đang tăng trưởng chậm nhất cần cải thiện?`
    ];

    return {
      reply,
      extracted_directives: extracted,
      follow_up_suggestions: followUps,
      llm_used: false
    };
  }

  async function chatWithScopeAgent({
    message = "",
    chatHistory = [],
    datasetLabel = "Dữ liệu hiện tại",
    dataProfile = {},
    currentContext = {},
    llmOptions = {}
  }) {
    const localRes = buildLocalChatResponse({ message, datasetLabel, dataProfile });
    if (llmOptions && llmOptions.enabled === false) {
      return localRes;
    }

    try {
      const snapshot = {
        file: datasetLabel,
        domain: dataProfile.domainName,
        rows: dataProfile.rowCount,
        periods: dataProfile.sortedPeriods,
        period_names: dataProfile.periodNames,
        peak_period: dataProfile.peakPeriod,
        trough_period: dataProfile.troughPeriod,
        metrics: (dataProfile.metrics || []).slice(0, 4).map(m => ({ col: m.col, name: m.name, sum: Math.round(m.sum), avg: Number(m.avg.toFixed(2)), isCurr: m.isCurr })),
        dimensions: (dataProfile.dimensions || []).slice(0, 3).map(d => ({ col: d.col, name: d.name, values: d.topValues.slice(0, 5) })),
        blank_count: dataProfile.blankCount || 0,
        current_directives: currentContext?.directives || {}
      };

      const recentHistory = (chatHistory || []).slice(-6).map(h => `${h.role === "user" ? "Người dùng" : "AI"}: ${h.text}`).join("\n");

      const prompt =
        `Bạn là AI Agent Phân tích Dữ liệu trực tiếp của Minh Hoàng Software đang trò chuyện với người dùng về file "${datasetLabel}".\n` +
        `SỐ LIỆU THẬT TRONG FILE:\n${JSON.stringify(snapshot, null, 2)}\n\n` +
        `Lịch sử trao đổi gần đây:\n${recentHistory || "(Bắt đầu hội thoại)"}\n\n` +
        `Tin nhắn mới nhất của người dùng: "${message}"\n\n` +
        `Hãy trả lời chân thật, tự nhiên, chính xác 100% theo số liệu thật trong file (không bịa số) và trích xuất chỉ thị điều khiển Dashboard (nếu người dùng có yêu cầu đổi kỳ, đổi chỉ số ưu tiên, đổi chiều phân tích, lọc nhóm, đặt mục tiêu, hoặc hỏi một câu hỏi mới cần đưa vào báo cáo).\n` +
        `CHỈ TRẢ VỀ JSON THUẦN (không markdown \`\`\`):\n` +
        `{\n` +
        `  "reply": "Câu trả lời trực tiếp, tự nhiên, có dẫn chứng số liệu từ file và xác nhận những thay đổi sẽ áp dụng cho Dashboard",\n` +
        `  "extracted_directives": {\n` +
        `    "focusPeriod": "null hoặc 'all' hoặc mã kỳ 'YYYY-MM' khớp chính xác trong snapshot.periods",\n` +
        `    "focusMetricCol": "null hoặc tên cột chính xác trong snapshot.metrics[].col nếu người dùng muốn ưu tiên cột đó",\n` +
        `    "focusDimCol": "null hoặc tên cột chính xác trong snapshot.dimensions[].col nếu người dùng muốn đổi chiều phân tích",\n` +
        `    "focusGroupValues": "null hoặc mảng tên nhóm chính xác trong dimensions[].values[].name NẾU người dùng yêu cầu LỌC riêng nhóm đó (trả mảng rỗng [] nếu muốn bỏ lọc)",\n` +
        `    "targetGoal": "null hoặc {type: 'amount'|'pct', value: number, label: string} nếu người dùng đặt mục tiêu",\n` +
        `    "addQuestion": "null hoặc câu hỏi phân tích cụ thể nếu người dùng đặt câu hỏi cần giải đáp trên Dashboard"\n` +
        `  },\n` +
        `  "follow_up_suggestions": ["2-3 gợi ý hỏi tiếp ngắn gọn dựa trên file"]\n` +
        `}`;

      const res = await callLLM({
        messages: [
          { role: "system", content: "Bạn là chuyên gia AI tương tác trực tiếp với người dùng dựa trên số liệu thực tế. Chỉ trả về JSON hợp lệ 100%." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        llmOptions
      });

      const parsed = safeParseJson(res.content);
      if (parsed && parsed.reply) {
        // Merge LLM directives safely with local deterministic detection so nothing is missed
        const mergedDir = { ...(localRes.extracted_directives || {}) };
        const ed = parsed.extracted_directives || {};
        if (ed.focusPeriod && ed.focusPeriod !== "null") mergedDir.focusPeriod = ed.focusPeriod;
        if (ed.focusMetricCol && ed.focusMetricCol !== "null" && (dataProfile.headers || []).includes(ed.focusMetricCol)) mergedDir.focusMetricCol = ed.focusMetricCol;
        if (ed.focusDimCol && ed.focusDimCol !== "null" && (dataProfile.headers || []).includes(ed.focusDimCol)) mergedDir.focusDimCol = ed.focusDimCol;
        if (Array.isArray(ed.focusGroupValues)) mergedDir.focusGroupValues = ed.focusGroupValues;
        if (ed.targetGoal && typeof ed.targetGoal === "object" && ed.targetGoal.value) mergedDir.targetGoal = ed.targetGoal;
        if (ed.addQuestion && ed.addQuestion !== "null") mergedDir.addQuestion = ed.addQuestion;

        return {
          reply: parsed.reply,
          extracted_directives: mergedDir,
          follow_up_suggestions: (Array.isArray(parsed.follow_up_suggestions) && parsed.follow_up_suggestions.length) ? parsed.follow_up_suggestions : localRes.follow_up_suggestions,
          llm_used: true,
          model_used: res.model_used
        };
      }
      return localRes;
    } catch {
      return localRes;
    }
  }

  return {
    AGENT_TOOLS_SPEC,
    runAgentPipeline,
    runDashboardAgentAnalysis,
    generateInteractiveScopeFromFile,
    chatWithScopeAgent
  };
})();
