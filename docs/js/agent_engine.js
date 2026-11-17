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
      description: "Skill 2: Đối chiếu lịch sử liên hệ, nhận diện sản phẩm Nam Việt phù hợp, phát hiện sai sản phẩm và liệt kê thông tin còn thiếu.",
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
      `Bạn là AI Agent tư vấn B2B của Công ty Phần mềm Nam Việt (sản phẩm: NV-ERP, NV-CRM, NV-HRM, NV-POS).\n` +
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
      `Bạn là Trợ lý AI điều phối kinh doanh của Công ty Phần mềm Nam Việt.\n` +
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
      processRows = (parsedDataset.rows || []).map((r, idx) => ({
        lead_id: `R${String(idx + 1).padStart(3, "0")}`,
        company_name: `${r["Kênh"] || r["kenh"] || "Kênh bán lẻ"} - ${r["Sản phẩm"] || r["san_pham"] || "Gói phần mềm"} #${idx + 1}`,
        contact_name: `Quản lý ${r["Khu vực"] || r["khu_vuc"] || "Kinh doanh"}`,
        phone: `090${String(1000000 + idx).slice(0, 7)}`,
        email: `retail${idx + 1}@namviet.vn`,
        industry: "Bán lẻ",
        region: r["Khu vực"] || r["khu_vuc"] || "TP.HCM",
        product_interest: String(r["Sản phẩm"] || r["san_pham"] || "").includes("Pro") ? "NV-ERP" : (String(r["Sản phẩm"] || r["san_pham"] || "").includes("Growth") ? "NV-CRM" : "NV-POS"),
        need_description: `Đơn hàng ${r["Sản phẩm"] || r["san_pham"] || "sản phẩm"} qua kênh ${r["Kênh"] || r["kenh"] || "Website"} đạt doanh số ${r["Doanh thu (VND)"] || r["doanh_thu"] || "15000000"} VND`,
        budget_vnd: String(r["Doanh thu (VND)"] || r["doanh_thu"] || "45000000").replace(/[,\s._]/g, ""),
        source_channel: r["Kênh"] || r["kenh"] || "Website",
        registered_at: r["Tháng"] ? `${r["Tháng"]}-01` : "2026-04-01"
      }));
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
      "Đối chiếu từng khách hàng duy nhất với lịch sử liên hệ (tránh gọi lại khách đã từ chối/opt-out), kiểm tra khớp sản phẩm Nam Việt và trích xuất thông tin còn thiếu.",
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

  return {
    AGENT_TOOLS_SPEC,
    runAgentPipeline
  };
})();
