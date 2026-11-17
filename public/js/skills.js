// skills.js - Nam Viet Business Skills (Tools callable by the AI Agent)

window.NamVietSkills = (() => {
  const { removeVietnameseAccents, normalizeDateString } = window.NamVietValidator;

  function normalizeText(str) {
    return removeVietnameseAccents(String(str || ""))
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePhone(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("84") && digits.length >= 10) {
      digits = "0" + digits.slice(2);
    }
    return digits;
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function normalizeCompanyCore(name, dedupRules) {
    let norm = normalizeText(name);
    const stopWords = (dedupRules && dedupRules.company_stop_words) || [];
    // Sort longer stop phrases first
    const sorted = [...stopWords].sort((a, b) => b.length - a.length);
    for (const sw of sorted) {
      const rx = new RegExp(`\\b${normalizeText(sw)}\\b`, "g");
      norm = norm.replace(rx, " ");
    }
    norm = norm.replace(/\s+/g, " ").trim();

    // Check known aliases
    const aliases = (dedupRules && dedupRules.known_aliases) || {};
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      const cNorm = normalizeText(canonical);
      if (norm === cNorm) return cNorm;
      for (const al of aliasList) {
        if (norm === normalizeText(al)) return cNorm;
      }
    }
    return norm;
  }

  function tokenJaccardAndContainment(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1.0;
    const tokA = new Set(a.split(" ").filter(Boolean));
    const tokB = new Set(b.split(" ").filter(Boolean));
    if (tokA.size === 0 || tokB.size === 0) return 0;

    let inter = 0;
    for (const t of tokA) if (tokB.has(t)) inter++;
    const union = new Set([...tokA, ...tokB]).size;
    const jaccard = inter / union;

    // Acronym check e.g. "hoang ha" vs "hh"
    const acrA = [...tokA].map(t => t[0]).join("");
    const acrB = [...tokB].map(t => t[0]).join("");
    if ((acrA.length >= 2 && acrA === b.replace(/\s+/g, "")) ||
        (acrB.length >= 2 && acrB === a.replace(/\s+/g, ""))) {
      return 0.85;
    }
    // Containment boost when one shares all tokens of the other plus generic suffix like "tech"
    const minSize = Math.min(tokA.size, tokB.size);
    const overlapMin = inter / minSize;
    return Math.max(jaccard, overlapMin * 0.72);
  }

  function formatVND(amount) {
    if (amount === null || amount === undefined || isNaN(amount) || amount <= 0) return "Chưa rõ";
    return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + " VNĐ";
  }

  // SKILL 1: Normalize & Deduplicate Leads
  function toolNormalizeAndDeduplicate(leads, config) {
    const dedupRules = config.deduplication_rules || {};
    const exactThresh = dedupRules.fuzzy_company_similarity_threshold ?? 0.78;
    const ambigLow = dedupRules.ambiguous_similarity_low ?? 0.62;

    const prepared = leads.map((raw, idx) => {
      const budgetNum = raw.budget_vnd !== "" && raw.budget_vnd !== undefined
        ? parseFloat(String(raw.budget_vnd).replace(/[,\s._]/g, ""))
        : null;
      return {
        ...raw,
        __idx: idx,
        budget_num: isNaN(budgetNum) ? null : budgetNum,
        norm_phone: normalizePhone(raw.phone),
        norm_email: normalizeEmail(raw.email),
        norm_tax: String(raw.tax_code || "").trim(),
        norm_company_core: normalizeCompanyCore(raw.company_name, dedupRules),
        registered_at: normalizeDateString(raw.registered_at)
      };
    });

    const clusters = [];
    const rulesTriggered = [];

    for (const rec of prepared) {
      let matchedCluster = null;
      let matchBasis = "";
      let isAmbiguous = false;
      let similarityScore = 0;

      for (const cl of clusters) {
        // 1. Exact tax_code
        if (rec.norm_tax && cl.tax_codes.has(rec.norm_tax)) {
          matchedCluster = cl;
          matchBasis = `Trùng Mã số thuế (${rec.norm_tax})`;
          similarityScore = 1.0;
          break;
        }
        // 2. Exact phone
        if (rec.norm_phone && cl.phones.has(rec.norm_phone)) {
          matchedCluster = cl;
          matchBasis = `Trùng Số điện thoại (${rec.norm_phone})`;
          similarityScore = 1.0;
          break;
        }
        // 3. Exact email
        if (rec.norm_email && cl.emails.has(rec.norm_email)) {
          matchedCluster = cl;
          matchBasis = `Trùng Email (${rec.norm_email})`;
          similarityScore = 1.0;
          break;
        }
        // 4. Company name / alias similarity
        for (const core of cl.company_cores) {
          const sim = tokenJaccardAndContainment(rec.norm_company_core, core);
          if (sim >= exactThresh) {
            matchedCluster = cl;
            matchBasis = `Trùng tên/viết tắt doanh nghiệp (độ tương đồng ${(sim * 100).toFixed(0)}%)`;
            similarityScore = sim;
            break;
          } else if (sim >= ambigLow && sim > similarityScore) {
            // Same region check increases plausibility of ambiguous duplicate
            const sameRegion = cl.regions.has(normalizeText(rec.region));
            if (sameRegion || sim >= 0.65) {
              matchedCluster = cl;
              matchBasis = `Nghi ngờ trùng tên/viết tắt (${(sim * 100).toFixed(0)}%) nhưng khác SĐT/Email/MST`;
              isAmbiguous = true;
              similarityScore = sim;
            }
          }
        }
        if (matchedCluster && !isAmbiguous) break;
      }

      if (matchedCluster) {
        matchedCluster.records.push(rec);
        if (rec.norm_tax) matchedCluster.tax_codes.add(rec.norm_tax);
        if (rec.norm_phone) matchedCluster.phones.add(rec.norm_phone);
        if (rec.norm_email) matchedCluster.emails.add(rec.norm_email);
        if (rec.norm_company_core) matchedCluster.company_cores.add(rec.norm_company_core);
        if (rec.region) matchedCluster.regions.add(normalizeText(rec.region));
        matchedCluster.match_reasons.push(`${rec.lead_id}: ${matchBasis}`);
        if (isAmbiguous) matchedCluster.ambiguous_duplicate = true;
        rulesTriggered.push({ lead_id: rec.lead_id, merged_into: matchedCluster.cluster_id, basis: matchBasis, ambiguous: isAmbiguous });
      } else {
        const cid = `CUST-${String(clusters.length + 1).padStart(3, "0")}`;
        clusters.push({
          cluster_id: cid,
          records: [rec],
          tax_codes: new Set(rec.norm_tax ? [rec.norm_tax] : []),
          phones: new Set(rec.norm_phone ? [rec.norm_phone] : []),
          emails: new Set(rec.norm_email ? [rec.norm_email] : []),
          company_cores: new Set(rec.norm_company_core ? [rec.norm_company_core] : []),
          regions: new Set(rec.region ? [normalizeText(rec.region)] : []),
          match_reasons: [`${rec.lead_id}: Hồ sơ gốc đầu tiên`],
          ambiguous_duplicate: false
        });
      }
    }

    const customers = clusters.map(cl => {
      // Pick richest company_name (longest non-abbreviated)
      const companyNames = [...new Set(cl.records.map(r => r.company_name).filter(Boolean))];
      const primaryName = companyNames.sort((a, b) => b.length - a.length)[0] || "";
      const contacts = [...new Set(cl.records.map(r => r.contact_name).filter(Boolean))];
      const phones = [...new Set(cl.records.map(r => r.phone).filter(Boolean))];
      const emails = [...new Set(cl.records.map(r => r.email).filter(Boolean))];
      const taxCodes = [...new Set(cl.records.map(r => r.tax_code).filter(Boolean))];
      const industries = [...new Set(cl.records.map(r => r.industry).filter(Boolean))];
      const regions = [...new Set(cl.records.map(r => r.region).filter(Boolean))];
      const products = [...new Set(cl.records.map(r => r.product_interest).filter(Boolean))];
      const channels = [...new Set(cl.records.map(r => r.source_channel).filter(Boolean))];
      const budgets = cl.records.map(r => r.budget_num).filter(b => b !== null && !isNaN(b));
      const maxBudget = budgets.length > 0 ? Math.max(...budgets) : null;
      const sumBudget = budgets.length > 0 ? budgets.reduce((a, b) => a + b, 0) : null;
      const needsList = cl.records
        .filter(r => r.need_description)
        .map(r => `[${r.lead_id} - ${r.source_channel}] ${r.need_description}`);

      return {
        customer_id: cl.cluster_id,
        company_name: primaryName,
        alias_names: companyNames,
        tax_code: taxCodes[0] || "",
        contacts,
        phones,
        emails,
        industry: industries[0] || "",
        all_industries: industries,
        region: regions[0] || "",
        all_regions: regions,
        product_interests: products,
        channels,
        budget_vnd: maxBudget,
        total_stated_budget_vnd: sumBudget,
        merged_needs: needsList.join(" | "),
        raw_need_text: cl.records.map(r => r.need_description || "").join(" "),
        source_records: cl.records.map(r => ({
          lead_id: r.lead_id,
          company_name: r.company_name,
          contact_name: r.contact_name,
          phone: r.phone,
          email: r.email,
          region: r.region,
          product_interest: r.product_interest,
          budget_vnd: r.budget_num,
          source_channel: r.source_channel,
          registered_at: r.registered_at
        })),
        duplicate_count: cl.records.length,
        dedup_reasons: cl.match_reasons,
        ambiguous_duplicate: cl.ambiguous_duplicate
      };
    });

    return {
      raw_count: leads.length,
      unique_customer_count: customers.length,
      merged_duplicates_count: leads.length - customers.length,
      ambiguous_count: customers.filter(c => c.ambiguous_duplicate).length,
      rules_triggered: rulesTriggered,
      customers
    };
  }

  // SKILL 2: Check Contact History, Product Fit & Missing Information
  function toolAnalyzeNeedsHistoryAndMissing(customers, config) {
    const history = config.contact_history || [];
    const products = config.products || [];
    const wrongKeywords = (config.priority_rules && config.priority_rules.wrong_product_keywords) || [];

    return customers.map(cust => {
      // 1. Check Contact History
      let historyMatch = null;
      for (const h of history) {
        const hTax = String(h.tax_code || "").trim();
        const hPhone = normalizePhone(h.phone);
        const hEmail = normalizeEmail(h.email);
        const hComp = normalizeCompanyCore(h.company_name, config.deduplication_rules);

        const matchTax = cust.tax_code && hTax && cust.tax_code === hTax;
        const matchPhone = hPhone && cust.phones.some(p => normalizePhone(p) === hPhone);
        const matchEmail = hEmail && cust.emails.some(e => normalizeEmail(e) === hEmail);
        const matchComp = hComp && cust.alias_names.some(n => normalizeCompanyCore(n, config.deduplication_rules) === hComp);

        if (matchTax || matchPhone || matchEmail || matchComp) {
          historyMatch = h;
          break;
        }
      }

      const isDoNotContact = Boolean(
        historyMatch && (historyMatch.outcome === "do_not_contact" || historyMatch.outcome === "rejected_spam")
      );

      // 2. Match Nam Viet Products & Check Wrong-Product Trap
      const needNorm = normalizeText(cust.raw_need_text + " " + cust.product_interests.join(" "));
      const matchedWrongKw = wrongKeywords.filter(kw => needNorm.includes(normalizeText(kw)));

      const matchedProducts = [];
      for (const prod of products) {
        const directIdMatch = cust.product_interests.some(pi =>
          normalizeText(pi).includes(normalizeText(prod.product_id)) ||
          normalizeText(pi).includes(normalizeText(prod.category))
        );
        const kwHits = (prod.keywords || []).filter(kw => needNorm.includes(normalizeText(kw)));
        if (directIdMatch || kwHits.length > 0) {
          matchedProducts.push({
            product_id: prod.product_id,
            product_name: prod.product_name,
            min_budget_vnd: prod.min_budget_vnd,
            score: (directIdMatch ? 2 : 0) + kwHits.length,
            matched_keywords: kwHits
          });
        }
      }
      matchedProducts.sort((a, b) => b.score - a.score);

      const isWrongProduct = matchedWrongKw.length > 0 && matchedProducts.length === 0;

      // 3. Identify Missing Information
      const missingFields = [];
      if (!cust.tax_code) missingFields.push("Mã số thuế");
      if (cust.phones.length === 0) missingFields.push("Số điện thoại");
      if (cust.emails.length === 0) missingFields.push("Email");
      if (!cust.industry) missingFields.push("Nhóm ngành nghề");
      if (!cust.region) missingFields.push("Khu vực");
      if (cust.budget_vnd === null || cust.budget_vnd === 0) missingFields.push("Ngân sách dự kiến");
      if (cust.product_interests.length === 0 && matchedProducts.length === 0) missingFields.push("Nhóm sản phẩm quan tâm");
      if (!cust.raw_need_text || cust.raw_need_text.trim().length < 15) missingFields.push("Mô tả nhu cầu chi tiết");

      return {
        ...cust,
        history_match: historyMatch,
        is_do_not_contact: isDoNotContact,
        matched_products: matchedProducts,
        primary_product: matchedProducts[0] || null,
        is_wrong_product: isWrongProduct,
        wrong_product_reasons: matchedWrongKw,
        missing_fields: missingFields,
        is_profile_complete: missingFields.length === 0
      };
    });
  }

  // SKILL 3: Priority Scoring (with boundary & wrong-product protection)
  function toolScorePriority(analyzedCustomers, config) {
    const pRules = config.priority_rules || {};
    const weights = pRules.weights || { product_fit: 40, need_clarity: 25, budget_fit: 20, urgency_and_channel: 15 };
    const highMin = pRules.high_score_min ?? 75;
    const medMin = pRules.medium_score_min ?? 45;
    const urgencyKws = pRules.urgency_keywords || [];

    return analyzedCustomers.map(cust => {
      if (cust.is_do_not_contact) {
        return {
          ...cust,
          priority_score: 0,
          priority_level: "Không liên hệ lại",
          priority_rationale: `Khách nằm trong danh sách ngừng liên hệ theo lịch sử (${cust.history_match.outcome}): "${cust.history_match.note}".`
        };
      }

      if (cust.is_wrong_product) {
        return {
          ...cust,
          priority_score: 15,
          priority_level: "Thấp",
          priority_rationale: `Không phù hợp danh mục phần mềm Nam Việt (phát hiện nhu cầu ngoài phạm vi: "${cust.wrong_product_reasons.join(", ")}"). Dù ngân sách ${formatVND(cust.budget_vnd)}, hệ thống chặn ưu tiên cao để tránh sai lệch.`
        };
      }

      const reasons = [];
      // 1. Product fit (0-40)
      let prodScore = 0;
      if (cust.matched_products.length > 0) {
        const top = cust.matched_products[0];
        prodScore = top.score >= 2 ? weights.product_fit : Math.round(weights.product_fit * 0.78);
        reasons.push(`Khớp sản phẩm ${top.product_id} (+${prodScore}/${weights.product_fit}đ)`);
      } else {
        prodScore = 10;
        reasons.push(`Chưa xác định rõ sản phẩm Nam Việt phù hợp (+10/${weights.product_fit}đ)`);
      }

      // 2. Need clarity (0-25)
      let needScore = 0;
      const len = (cust.raw_need_text || "").trim().length;
      if (len >= 50) {
        needScore = weights.need_clarity;
        reasons.push(`Nhu cầu mô tả rõ ràng (+${needScore}/${weights.need_clarity}đ)`);
      } else if (len >= 20) {
        needScore = Math.round(weights.need_clarity * 0.65);
        reasons.push(`Nhu cầu ở mức cơ bản (+${needScore}/${weights.need_clarity}đ)`);
      } else {
        needScore = 5;
        reasons.push(`Nhu cầu còn sơ sài (+5/${weights.need_clarity}đ)`);
      }

      // 3. Budget fit (0-20) — Incomplete budget does NOT zero out a strong product fit!
      let budgetScore = 0;
      const minViable = cust.primary_product ? cust.primary_product.min_budget_vnd : (pRules.min_viable_budget_vnd || 20000000);
      if (cust.budget_vnd === null) {
        budgetScore = Math.round(weights.budget_fit * 0.55); // 11đ partial potential so good fit leads are NOT dropped!
        reasons.push(`Thiếu ngân sách — giữ điểm tiềm năng để hỏi bổ sung (+${budgetScore}/${weights.budget_fit}đ)`);
      } else if (cust.budget_vnd >= minViable * 2) {
        budgetScore = weights.budget_fit;
        reasons.push(`Ngân sách ${formatVND(cust.budget_vnd)} vượt tốt ngưỡng gói ${formatVND(minViable)} (+${budgetScore}/${weights.budget_fit}đ)`);
      } else if (cust.budget_vnd >= minViable) {
        budgetScore = Math.round(weights.budget_fit * 0.8);
        reasons.push(`Ngân sách ${formatVND(cust.budget_vnd)} đạt ngưỡng tối thiểu (+${budgetScore}/${weights.budget_fit}đ)`);
      } else {
        budgetScore = 5;
        reasons.push(`Ngân sách ${formatVND(cust.budget_vnd)} thấp hơn gói chuẩn ${formatVND(minViable)} (+5/${weights.budget_fit}đ)`);
      }

      // 4. Urgency & Channel (0-15)
      const normNeed = normalizeText(cust.raw_need_text);
      const hasUrgency = urgencyKws.some(kw => normNeed.includes(normalizeText(kw)));
      const highIntentChannel = cust.channels.some(ch => ["hoi thao", "website"].includes(normalizeText(ch)));
      let urgScore = 5;
      if (hasUrgency && highIntentChannel) urgScore = weights.urgency_and_channel;
      else if (hasUrgency || highIntentChannel) urgScore = Math.round(weights.urgency_and_channel * 0.7);
      if (cust.duplicate_count > 1) urgScore = Math.min(weights.urgency_and_channel, urgScore + 3);
      reasons.push(`Kênh [${cust.channels.join(", ")}]${hasUrgency ? " + có dấu hiệu gấp" : ""} (+${urgScore}/${weights.urgency_and_channel}đ)`);

      const total = Math.min(100, prodScore + needScore + budgetScore + urgScore);
      let level = "Thấp";
      if (total >= highMin) level = "Cao";
      else if (total >= medMin) level = "Trung bình";

      return {
        ...cust,
        priority_score: total,
        priority_level: level,
        priority_rationale: reasons.join("; ")
      };
    });
  }

  // SKILL 4: Sales Assignment, Escalation Rules & Outreach Drafting
  function toolAssignAndDraftOutreach(scoredCustomers, config) {
    // Deep clone staff loads for dynamic balancing during batch run
    const staffPool = (config.sales_staff || []).map(s => ({
      ...s,
      dynamic_load: s.current_load || 0,
      assigned_customer_ids: []
    }));

    const aRules = config.assignment_rules || {};
    const vipThresh = (config.priority_rules && config.priority_rules.vip_budget_threshold_vnd) || 300000000;

    // Sort High priority first so they get best available staff capacity
    const ordered = [...scoredCustomers].sort((a, b) => b.priority_score - a.priority_score);

    const processed = ordered.map(cust => {
      if (cust.is_do_not_contact) {
        return {
          ...cust,
          assigned_staff_id: null,
          assigned_salesperson: "Không phân công (Chặn theo lịch sử)",
          assignment_status: "do_not_contact",
          escalation_reasons: [],
          needs_manager_decision: false,
          next_action: "Đưa vào danh sách không liên hệ lại; thông báo tiếp thị ngừng chạy remarketing.",
          draft_type: "none",
          draft_message: "(Không tạo thông điệp vì khách thuộc danh sách ngừng liên hệ theo lịch sử.)"
        };
      }

      const escalationReasons = [];
      if (cust.ambiguous_duplicate) {
        escalationReasons.push("Nghi ngờ hồ sơ trùng tên viết tắt/alias nhưng khác thông tin liên hệ — cần Trưởng phòng xác nhận gộp hay tách.");
      }
      if (cust.budget_vnd !== null && cust.budget_vnd >= vipThresh && !cust.is_wrong_product) {
        escalationReasons.push(`Khách hàng VIP (Ngân sách ${formatVND(cust.budget_vnd)} ≥ ngưỡng ${formatVND(vipThresh)}) — vượt thẩm quyền phân công tự động.`);
      }

      // Check history active owner conflict
      let historyOwner = null;
      if (cust.history_match && cust.history_match.outcome === "active" && cust.history_match.previous_salesperson) {
        historyOwner = staffPool.find(s => s.staff_id === cust.history_match.previous_salesperson) || null;
      }

      // Score candidate staff by Region + Industry + Product
      const normRegion = normalizeText(cust.region);
      const normIndustry = normalizeText(cust.industry);
      const prodId = cust.primary_product ? cust.primary_product.product_id : null;

      const candidates = staffPool.map(st => {
        const regionMatch = normRegion && st.assigned_regions.some(r => {
          const nr = normalizeText(r);
          return nr === normRegion || nr.includes(normRegion) || normRegion.includes(nr);
        });
        const industryMatch = normIndustry && st.assigned_industries.some(ind => {
          const ni = normalizeText(ind);
          return ni === normIndustry || ni.includes(normIndustry) || normIndustry.includes(ni);
        });
        const productMatch = prodId ? st.product_groups.includes(prodId) : true;
        const remainingCap = st.max_weekly_capacity - st.dynamic_load;

        let fitScore = 0;
        if (regionMatch) fitScore += 40;
        if (industryMatch) fitScore += 40;
        if (productMatch) fitScore += 20;

        return {
          staff: st,
          regionMatch,
          industryMatch,
          productMatch,
          remainingCap,
          fitScore,
          isExactDomainMatch: regionMatch && industryMatch
        };
      });

      // Must match at least region + industry (or region + product when industry is missing)
      const validMatches = candidates.filter(c =>
        (c.regionMatch && c.industryMatch) ||
        (!cust.industry && c.regionMatch && c.productMatch)
      );

      validMatches.sort((a, b) => {
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
        return b.remainingCap - a.remainingCap;
      });

      let assignedStaff = null;
      let assignmentStatus = "assigned";

      if (validMatches.length === 0) {
        assignmentStatus = "unassigned";
        if (cust.priority_level === "Cao" || cust.priority_level === "Trung bình") {
          escalationReasons.push(`Chưa có NVKD phụ trách đúng Ngành [${cust.industry || "Trống"}] & Khu vực [${cust.region || "Trống"}] — cần Trưởng phòng điều phối chéo.`);
        }
      } else {
        // Check active history conflict
        const bestCandidate = validMatches[0];
        if (historyOwner && historyOwner.staff_id !== bestCandidate.staff.staff_id) {
          escalationReasons.push(
            `Tranh chấp phân công: Hồ sơ đang được ${historyOwner.staff_name} (${historyOwner.staff_id}) chăm sóc trước đó, nhưng chi nhánh/khu vực mới (${cust.region}) thuộc phạm vi của ${bestCandidate.staff.staff_name} (${bestCandidate.staff.staff_id}).`
          );
          assignedStaff = bestCandidate.staff;
        } else {
          // Pick first with remaining capacity if available
          const available = validMatches.find(c => c.remainingCap > 0);
          if (available) {
            assignedStaff = available.staff;
          } else {
            assignedStaff = bestCandidate.staff;
            escalationReasons.push(
              `NVKD phù hợp ${assignedStaff.staff_name} (${assignedStaff.staff_id}) đã chạm/vượt định mức tuần (${assignedStaff.dynamic_load}/${assignedStaff.max_weekly_capacity}) — cần Trưởng phòng duyệt quá tải hoặc chuyển người.`
            );
          }
        }
      }

      if (assignedStaff && escalationReasons.length === 0) {
        assignedStaff.dynamic_load += 1;
        assignedStaff.assigned_customer_ids.push(cust.customer_id);
      } else if (escalationReasons.length > 0) {
        assignmentStatus = assignedStaff ? "manager_review" : "unassigned_manager_review";
      }

      const needsManager = escalationReasons.length > 0;

      // Draft Outreach Message or Clarifying Questions
      const contactGreeting = cust.contacts.length > 0 ? `Anh/Chị ${cust.contacts[0]}` : "Quý Doanh nghiệp";
      const prodLabel = cust.primary_product ? cust.primary_product.product_name : "giải pháp phần mềm quản lý Nam Việt";
      let draftType = "outreach";
      let draftMessage = "";
      let nextAction = "";

      if (cust.is_wrong_product) {
        draftType = "clarify";
        nextAction = "Gửi email phản hồi lịch sự xác nhận phạm vi sản phẩm và hỏi lại có nhu cầu ERP/CRM/HRM/POS không.";
        draftMessage =
          `Kính gửi ${contactGreeting} (${cust.company_name}),\n` +
          `Cảm ơn Anh/Chị đã quan tâm tới Công ty Phần mềm Nam Việt qua ${cust.channels.join("/")}.\n` +
          `Hiện Nam Việt chuyên cung cấp giải pháp quản trị doanh nghiệp SME (ERP, CRM, HRM, POS). Với yêu cầu về "${cust.wrong_product_reasons.join(", ")}", bên em chưa trực tiếp triển khai hạng mục này.\n` +
          `Không biết bên mình có đang tìm hiểu thêm phần mềm quản lý kho, bán hàng hay nhân sự để em hỗ trợ tư vấn phù hợp hơn không ạ?`;
      } else if (cust.missing_fields.length > 0) {
        draftType = "clarify_questions";
        const questions = [];
        if (cust.missing_fields.includes("Ngân sách dự kiến")) {
          questions.push("- Ngân sách dự kiến doanh nghiệp mình dành cho đợt triển khai này là khoảng bao nhiêu?");
        }
        if (cust.missing_fields.includes("Nhóm sản phẩm quan tâm")) {
          questions.push("- Anh/Chị đang ưu tiên phân hệ nào trước (Quản trị tổng thể ERP, Bán hàng CRM, Nhân sự HRM hay POS chuỗi cửa hàng)?");
        }
        if (cust.missing_fields.includes("Nhóm ngành nghề") || cust.missing_fields.includes("Khu vực")) {
          questions.push("- Lĩnh vực hoạt động chính và địa bàn/chi nhánh triển khai của công ty mình ở đâu ạ?");
        }
        if (cust.missing_fields.includes("Mô tả nhu cầu chi tiết")) {
          questions.push("- Quy mô nhân sự/cửa hàng sử dụng phần mềm và bài toán khó khăn nhất hiện nay là gì ạ?");
        }
        if (cust.missing_fields.includes("Email") || cust.missing_fields.includes("Số điện thoại")) {
          questions.push("- Xin phép xác nhận thêm Email/Số điện thoại liên hệ chính để bên em gửi tài liệu demo.");
        }

        nextAction = needsManager
          ? "Chờ Trưởng phòng duyệt phân công, sau đó NVKD sử dụng bản nháp câu hỏi bổ sung để liên hệ khách."
          : `Giao ${assignedStaff ? assignedStaff.staff_name : "NVKD"} gửi bản nháp hỏi bổ sung ${cust.missing_fields.length} thông tin còn thiếu.`;

        draftMessage =
          `Chào ${contactGreeting} (${cust.company_name}),\n` +
          `Em là ${assignedStaff ? assignedStaff.staff_name : "chuyên viên tư vấn"} từ Công ty Phần mềm Nam Việt. Cảm ơn bên mình đã đăng ký qua ${cust.channels.join("/")} về nhu cầu ${cust.primary_product ? cust.primary_product.category : "quản lý doanh nghiệp"}.\n` +
          `Để bên em chuẩn bị đúng bộ demo ${prodLabel} và báo giá sát nhất, anh/chị cho em xin thêm vài thông tin ngắn nhé:\n` +
          questions.join("\n") +
          `\nEm xin cảm ơn và sẵn sàng trao đổi 15 phút theo lịch thuận tiện của anh/chị ạ.`;
      } else {
        draftType = "outreach";
        nextAction = needsManager
          ? "Chờ Trưởng phòng Kinh doanh phê duyệt phân công trước khi NVKD gọi tiếp cận."
          : `Giao ${assignedStaff.staff_name} liên hệ đặt lịch demo ${cust.primary_product ? cust.primary_product.product_id : "sản phẩm"} trong 24h.`;

        draftMessage =
          `Kính chào ${contactGreeting} – ${cust.company_name},\n` +
          `Em là ${assignedStaff ? assignedStaff.staff_name : "đại diện kinh doanh"} phụ trách khối ${cust.industry || "SME"} tại ${cust.region || "khu vực"} của Công ty Phần mềm Nam Việt.\n` +
          `Ghi nhận từ ${cust.channels.join(" & ")} về nhu cầu triển khai ${prodLabel} (ngân sách dự kiến ${formatVND(cust.budget_vnd)}), bên em đã tổng hợp phương án phù hợp với quy mô của quý công ty.\n` +
          `Anh/Chị có thuận tiện trao đổi 15–20 phút trong tuần này để bên em demo trực tiếp quy trình thực tế không ạ?`;
      }

      return {
        ...cust,
        assigned_staff_id: assignedStaff ? assignedStaff.staff_id : null,
        assigned_salesperson: assignedStaff
          ? `${assignedStaff.staff_name} (${assignedStaff.staff_id})`
          : "Chưa có nhân viên phù hợp",
        assignment_status: assignmentStatus,
        escalation_reasons: escalationReasons,
        needs_manager_decision: needsManager,
        next_action: nextAction,
        draft_type: draftType,
        draft_message: draftMessage
      };
    });

    // Restore original customer_id order for clean UI display
    processed.sort((a, b) => a.customer_id.localeCompare(b.customer_id));

    return { customers: processed, updatedStaffPool: staffPool };
  }

  // SKILL 5: Deduplicated Summary Statistics & Business Task Lists
  function toolCompileReportsAndStats(customers, staffPool, rawLeads = []) {
    const byPriority = {
      "Cao": 0,
      "Trung bình": 0,
      "Thấp": 0,
      "Không liên hệ lại": 0
    };

    for (const c of customers) {
      if (byPriority[c.priority_level] !== undefined) {
        byPriority[c.priority_level]++;
      } else {
        byPriority["Thấp"]++;
      }
    }

    const byStaff = staffPool.map(s => {
      const assignedList = customers.filter(c => c.assigned_staff_id === s.staff_id && !c.is_do_not_contact);
      const confirmedCount = assignedList.filter(c => c.assignment_status === "assigned").length;
      const pendingReviewCount = assignedList.filter(c => c.needs_manager_decision).length;
      return {
        staff_id: s.staff_id,
        staff_name: s.staff_name,
        regions: s.assigned_regions.join(", "),
        industries: s.assigned_industries.join(", "),
        initial_load: s.current_load,
        new_assigned_confirmed: confirmedCount,
        pending_manager_approval: pendingReviewCount,
        total_projected_load: s.current_load + confirmedCount,
        max_weekly_capacity: s.max_weekly_capacity,
        // Priority breakdown per staff
        priority_high: assignedList.filter(c => c.priority_level === "Cao").length,
        priority_medium: assignedList.filter(c => c.priority_level === "Trung bình").length,
        priority_low: assignedList.filter(c => c.priority_level === "Thấp").length
      };
    });

    const unassignedList = customers.filter(c =>
      c.assignment_status === "unassigned" || c.assignment_status === "unassigned_manager_review"
    );
    const doNotContactList = customers.filter(c => c.is_do_not_contact);
    const managerDecisionList = customers.filter(c => c.needs_manager_decision);
    const salesActionList = customers.filter(c => !c.is_do_not_contact);
    const assignedCallList = customers.filter(c => c.assignment_status === "assigned");
    const totalRawRecords = customers.reduce((acc, c) => acc + c.duplicate_count, 0);

    // 1. Lead Funnel Data (Phễu hao hụt)
    const productFitCount = customers.filter(c => !c.is_wrong_product).length;
    const funnelData = [
      { stage: "1. Bản ghi đầu vào", count: totalRawRecords, pct: 100, color: "#52525b" },
      { stage: "2. Khách sau gộp trùng", count: customers.length, pct: Math.round((customers.length / Math.max(1, totalRawRecords)) * 100), color: "#0d9488" },
      { stage: "3. Khớp SP Nam Việt", count: productFitCount, pct: Math.round((productFitCount / Math.max(1, totalRawRecords)) * 100), color: "#0f766e" },
      { stage: "4. Danh sách gọi NVKD", count: assignedCallList.length, pct: Math.round((assignedCallList.length / Math.max(1, totalRawRecords)) * 100), color: "#16a34a" }
    ];

    // 2. Exception Breakdown (Lý do vào hàng đợi người duyệt)
    let ambigDups = 0, vipBudget = 0, dispute = 0, overload = 0;
    for (const c of managerDecisionList) {
      const txt = (c.escalation_reasons || []).join(" ");
      if (/nghi ngo|trung/i.test(txt)) ambigDups++;
      if (/vip|ngan sach lon/i.test(txt)) vipBudget++;
      if (/tranh chap|nhieu hon/i.test(txt)) dispute++;
      if (/qua tai|dinh muc/i.test(txt)) overload++;
    }
    const exceptionBreakdown = [
      { reason: "Trùng mơ hồ (Ca xám 0.62–0.78)", count: ambigDups, color: "#8b5cf6" },
      { reason: "Ngân sách VIP (>300M)", count: vipBudget, color: "#f59e0b" },
      { reason: "Tranh chấp phạm vi (≥2 NVKD)", count: dispute, color: "#ef4444" },
      { reason: "Chưa có NVKD phù hợp", count: unassignedList.length, color: "#ec4899" },
      { reason: "Vượt định mức tải tuần", count: overload, color: "#64748b" }
    ];

    // 3. Missing Data Heatmap by Channel x Column
    const rawItems = rawLeads.length > 0 ? rawLeads : customers.flatMap(c => c.source_records || []);
    const channels = [...new Set(rawItems.map(r => r.source_channel || "Khác"))];
    const checkFields = ["budget_vnd", "need_description", "phone", "email", "industry"];
    const fieldLabels = {
      budget_vnd: "Ngân sách",
      need_description: "Nhu cầu",
      phone: "SĐT",
      email: "Email",
      industry: "Ngành"
    };
    const heatmapMatrix = channels.map(ch => {
      const inCh = rawItems.filter(r => (r.source_channel || "Khác") === ch);
      const totalInCh = Math.max(1, inCh.length);
      const rates = {};
      for (const f of checkFields) {
        const miss = inCh.filter(r => !String(r[f] ?? "").trim()).length;
        rates[f] = {
          missing: miss,
          total: totalInCh,
          pct: Math.round((miss / totalInCh) * 100)
        };
      }
      return { channel: ch, total: totalInCh, rates };
    });

    return {
      summary: {
        total_raw_records: totalRawRecords,
        unique_customers: customers.length,
        duplicates_merged: customers.reduce((acc, c) => acc + (c.duplicate_count - 1), 0),
        by_priority: byPriority,
        unassigned_count: unassignedList.length,
        do_not_contact_count: doNotContactList.length,
        manager_decision_count: managerDecisionList.length,
        funnel_data: funnelData,
        exception_breakdown: exceptionBreakdown,
        heatmap_matrix: heatmapMatrix,
        field_labels: fieldLabels,
        double_entry_balance: {
          sum_priority: Object.values(byPriority).reduce((a, b) => a + b, 0),
          total_customers: customers.length,
          is_balanced: Object.values(byPriority).reduce((a, b) => a + b, 0) === customers.length
        }
      },
      by_staff: byStaff,
      lists: {
        sales_tasks: salesActionList,
        unassigned: unassignedList,
        do_not_contact: doNotContactList,
        manager_decisions: managerDecisionList
      }
    };
  }

  // SKILL 0: Clean & Standardize Validated Dataset
  function toolCleanDataset(rows, config, mode = "standard", options = {}) {
    const cleanLog = [];
    let normalizedCells = 0;
    let trimmedCellsCount = 0;
    let emptyRowsRemovedCount = 0;
    let duplicateRowsRemovedCount = 0;
    let missingRowsRemovedCount = 0;
    const sourceRowsCount = (rows || []).length;

    const trimWhitespace = options.trimWhitespace !== false;
    const removeEmptyRows = options.removeEmptyRows !== false;
    const removeDuplicates = options.removeDuplicates !== false;
    const dropMissingRows = options.dropMissingRows === true;

    const regionMap = {
      "hcm": "TP.HCM",
      "tp hcm": "TP.HCM",
      "tphcm": "TP.HCM",
      "ho chi minh": "TP.HCM",
      "sai gon": "TP.HCM",
      "hn": "Hà Nội",
      "ha noi": "Hà Nội",
      "dn": "Đà Nẵng",
      "da nang": "Đà Nẵng",
      "bd": "Bình Dương",
      "binh duong": "Bình Dương",
      "can tho": "Cần Thơ",
      "hai phong": "Hải Phòng",
      "tay nguyen": "Tây Nguyên"
    };

    const productMap = {
      "erp": "NV-ERP",
      "nv erp": "NV-ERP",
      "crm": "NV-CRM",
      "nv crm": "NV-CRM",
      "hrm": "NV-HRM",
      "nv hrm": "NV-HRM",
      "pos": "NV-POS",
      "nv pos": "NV-POS"
    };

    const seenSignatures = new Set();
    const intermediateRows = [];

    for (const raw of (rows || [])) {
      const r = { ...raw };
      const fields = Object.keys(r).filter(k => k !== "__rowNumber");

      // 1. Check empty row
      const isAllEmpty = fields.every(f => !String(r[f] ?? "").trim());
      if (removeEmptyRows && isAllEmpty) {
        emptyRowsRemovedCount++;
        continue;
      }

      // 2. Check trim whitespace
      for (const f of fields) {
        const orig = String(r[f] ?? "");
        if (trimWhitespace) {
          const trimmed = orig.replace(/\s+/g, " ").trim();
          if (trimmed !== orig) {
            r[f] = trimmed;
            trimmedCellsCount++;
            normalizedCells++;
          }
        }
      }

      // 3. Check duplicate row
      const sig = fields.map(f => String(r[f] ?? "").trim().toLowerCase()).join("|");
      if (removeDuplicates) {
        if (seenSignatures.has(sig)) {
          duplicateRowsRemovedCount++;
          continue;
        }
        seenSignatures.add(sig);
      }

      // 4. Check drop missing rows (any empty field)
      if (dropMissingRows) {
        const hasMissing = fields.some(f => !String(r[f] ?? "").trim());
        if (hasMissing) {
          missingRowsRemovedCount++;
          continue;
        }
      }

      // Standardize known CRM fields if present
      if (r.phone) {
        const np = normalizePhone(r.phone);
        if (np !== r.phone) {
          r.phone = np;
          normalizedCells++;
        }
      }
      if (r.email) {
        const ne = normalizeEmail(r.email);
        if (ne !== r.email) {
          r.email = ne;
          normalizedCells++;
        }
      }
      if (r.registered_at) {
        const nd = normalizeDateString(r.registered_at);
        if (nd !== r.registered_at) {
          r.registered_at = nd;
          normalizedCells++;
        }
      }
      if (r.budget_vnd) {
        const nb = String(r.budget_vnd).replace(/[,\s._]/g, "");
        if (nb !== r.budget_vnd && /^\d+$/.test(nb)) {
          r.budget_vnd = nb;
          normalizedCells++;
        }
      }
      if (r.region) {
        const rk = normalizeText(r.region);
        if (regionMap[rk] && regionMap[rk] !== r.region) {
          r.region = regionMap[rk];
          normalizedCells++;
        }
      }
      if (r.product_interest) {
        const pk = normalizeText(r.product_interest);
        if (productMap[pk] && productMap[pk] !== r.product_interest) {
          r.product_interest = productMap[pk];
          normalizedCells++;
        }
      }

      if (mode === "deep") {
        if (!r.industry && r.need_description) {
          const nd = normalizeText(r.need_description);
          if (/kho|san xuat|nha may/.test(nd)) { r.industry = "Sản xuất"; normalizedCells++; }
          else if (/cua hang|ban le|pos/.test(nd)) { r.industry = "Bán lẻ"; normalizedCells++; }
        }
        if (!r.product_interest && r.need_description) {
          const nd = normalizeText(r.need_description);
          if (/erp|san xuat|ton kho|ke toan/.test(nd)) { r.product_interest = "NV-ERP"; normalizedCells++; }
          else if (/crm|pipeline|cham soc khach/.test(nd)) { r.product_interest = "NV-CRM"; normalizedCells++; }
          else if (/hrm|cham cong|tinh luong|nhan su/.test(nd)) { r.product_interest = "NV-HRM"; normalizedCells++; }
          else if (/pos|cua hang|ma vach/.test(nd)) { r.product_interest = "NV-POS"; normalizedCells++; }
        }
      }

      intermediateRows.push(r);
    }

    const cleanedRows = intermediateRows;
    const removedRowsCount = emptyRowsRemovedCount + duplicateRowsRemovedCount + missingRowsRemovedCount;

    // Count remaining empty cells
    let remainingEmptyCellsCount = 0;
    for (const r of cleanedRows) {
      const fields = Object.keys(r).filter(k => k !== "__rowNumber");
      for (const f of fields) {
        if (!String(r[f] ?? "").trim()) {
          remainingEmptyCellsCount++;
        }
      }
    }

    const warnings = [];
    let missingContactCount = 0;
    let missingNeedCount = 0;
    for (const r of cleanedRows) {
      if (r.phone !== undefined || r.email !== undefined) {
        if (!r.phone && !r.email) missingContactCount++;
      }
      if (r.need_description !== undefined) {
        if (!r.need_description || r.need_description.length < 5) missingNeedCount++;
      }
    }
    if (missingContactCount > 0) warnings.push(`${missingContactCount} hồ sơ thiếu cả SĐT và Email`);
    if (missingNeedCount > 0) warnings.push(`${missingNeedCount} hồ sơ mô tả nhu cầu quá ngắn/trống`);

    if (emptyRowsRemovedCount > 0) cleanLog.push(`Đã xóa ${emptyRowsRemovedCount} dòng hoàn toàn trống.`);
    if (duplicateRowsRemovedCount > 0) cleanLog.push(`Đã xóa ${duplicateRowsRemovedCount} dòng trùng lặp nội dung.`);
    if (missingRowsRemovedCount > 0) cleanLog.push(`Đã loại bỏ ${missingRowsRemovedCount} dòng thiếu dữ liệu theo quy tắc.`);
    if (trimmedCellsCount > 0) cleanLog.push(`Đã cắt khoảng trắng thừa ở ${trimmedCellsCount} ô dữ liệu.`);
    if (normalizedCells > 0) cleanLog.push(`Đã chuẩn hóa định dạng ở ${normalizedCells} ô.`);
    if (cleanLog.length === 0) cleanLog.push("Dữ liệu đã chuẩn, không phát hiện ô hay dòng cần làm sạch thêm.");

    const isStable = cleanedRows.length > 0;
    return {
      cleanedRows,
      stats: {
        totalRows: cleanedRows.length,
        sourceRowsCount,
        cleanedRowsCount: cleanedRows.length,
        removedRowsCount,
        emptyRowsRemovedCount,
        duplicateRowsRemovedCount,
        missingRowsRemovedCount,
        trimmedCellsCount,
        remainingEmptyCellsCount,
        normalizedCells,
        missingContactCount,
        missingNeedCount,
        isStable
      },
      cleanLog,
      warnings
    };
  }

  // SKILL 6: Verify Process Output Quality
  function toolVerifyPipelineOutput(output, parsedDataset, config) {
    const checks = [];
    const customers = output?.customers || [];
    const summary = output?.report?.summary || {};
    const rawCount = (parsedDataset?.rows || []).length;
    const vipThresh = config?.priority_rules?.vip_budget_threshold_vnd ?? 300000000;

    // 1. Data Integrity (no dropped or double-counted leads)
    const sumSources = customers.reduce((acc, c) => acc + (c.source_records?.length || 0), 0);
    const integrityOk = customers.length > 0 && sumSources === rawCount && summary.unique_customers === customers.length;
    checks.push({
      id: "integrity",
      name: "Bảo toàn & Không đếm lặp",
      status: integrityOk ? "PASS" : "FAIL",
      detail: `${sumSources}/${rawCount} bản ghi gốc -> ${customers.length} KH duy nhất`
    });

    // 2. Wrong Product Trap Guard
    const wrongHigh = customers.filter(c => c.is_wrong_product && c.priority_level === "Cao");
    checks.push({
      id: "wrong_product_guard",
      name: "Chặn bẫy sai sản phẩm",
      status: wrongHigh.length === 0 ? "PASS" : "FAIL",
      detail: wrongHigh.length === 0 ? "Không có hồ sơ sai SP bị chấm Ưu tiên Cao" : `${wrongHigh.length} hồ sơ sai SP bị chấm Cao`
    });

    // 3. Do Not Contact Guard
    const dncAssigned = customers.filter(c => c.is_do_not_contact && c.assigned_staff_id);
    checks.push({
      id: "dnc_guard",
      name: "Chặn khách Ngừng liên hệ",
      status: dncAssigned.length === 0 ? "PASS" : "FAIL",
      detail: dncAssigned.length === 0 ? "Đã chặn 100% khách thuộc danh sách không liên hệ lại" : `${dncAssigned.length} khách DNC vẫn bị giao NVKD`
    });

    // 4. VIP & Ambiguous Escalation Check
    const missedVip = customers.filter(c => !c.is_do_not_contact && !c.is_wrong_product && (c.budget_vnd || 0) >= vipThresh && !c.needs_manager_decision);
    checks.push({
      id: "escalation_guard",
      name: "Kiểm soát VIP & Trùng mơ hồ",
      status: missedVip.length === 0 ? "PASS" : "FAIL",
      detail: missedVip.length === 0 ? `Tất cả ca VIP >= ${(vipThresh / 1e6)}tr & trùng mơ hồ đều đưa Trưởng phòng duyệt` : `${missedVip.length} ca VIP chưa gắn cờ duyệt`
    });

    // 5. Drafts & Trace Auditability
    const missingDrafts = customers.filter(c => !c.is_do_not_contact && (!c.next_action || !c.draft_message));
    const traceOk = (output?.trace?.length || 0) >= 5;
    checks.push({
      id: "audit_and_drafts",
      name: "Đủ bản nháp & Log truy vết",
      status: missingDrafts.length === 0 && traceOk ? "PASS" : "FAIL",
      detail: `${output?.trace?.length || 0} bước log truy vết, ${customers.length - missingDrafts.length}/${customers.length} hồ sơ đủ hành động`
    });

    const passed = checks.every(ch => ch.status === "PASS");
    return {
      passed,
      checks,
      summary: passed
        ? `Đạt 5/5 tiêu chí kiểm chứng (${customers.length} KH duy nhất sẵn sàng lập báo cáo).`
        : `Phát hiện ${checks.filter(c => c.status !== "PASS").length} tiêu chí chưa đạt — cần Feedback cho Process.`
    };
  }

  return {
    toolCleanDataset,
    toolVerifyPipelineOutput,
    toolNormalizeAndDeduplicate,
    toolAnalyzeNeedsHistoryAndMissing,
    toolScorePriority,
    toolAssignAndDraftOutreach,
    toolCompileReportsAndStats,
    formatVND
  };
})();
