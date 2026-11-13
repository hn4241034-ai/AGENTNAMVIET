// validator.js - CSV parsing, column normalization & strict format validation gate

window.NamVietValidator = (() => {
  function removeVietnameseAccents(str) {
    if (!str) return "";
    return String(str)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  }

  function normalizeHeaderKey(raw) {
    return removeVietnameseAccents(String(raw || ""))
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function parseCSV(text) {
    const cleanText = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let cur = "";
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
      const ch = cleanText[i];
      const next = cleanText[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          row.push(cur.trim());
          cur = "";
        } else if (ch === "\r" && next === "\n") {
          row.push(cur.trim());
          rows.push(row);
          row = [];
          cur = "";
          i++;
        } else if (ch === "\n" || ch === "\r") {
          row.push(cur.trim());
          rows.push(row);
          row = [];
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur.trim());
      rows.push(row);
    }
    return rows.filter(r => r.some(cell => String(cell).trim() !== ""));
  }

  function matrixToObjects(matrix, schemaConfig) {
    if (!matrix || matrix.length < 2) {
      return { headers: [], rows: [], missingHeaders: schemaConfig.required_columns || [] };
    }
    const rawHeaders = matrix[0].map(h => String(h || "").trim());
    const aliasLookup = {};
    const aliases = schemaConfig.column_aliases || {};

    for (const stdKey of Object.keys(aliases)) {
      aliasLookup[normalizeHeaderKey(stdKey)] = stdKey;
      for (const al of aliases[stdKey]) {
        aliasLookup[normalizeHeaderKey(al)] = stdKey;
      }
    }
    for (const reqCol of (schemaConfig.required_columns || [])) {
      aliasLookup[normalizeHeaderKey(reqCol)] = reqCol;
    }

    const mappedHeaders = rawHeaders.map(h => {
      const nk = normalizeHeaderKey(h);
      return aliasLookup[nk] || nk;
    });

    const rows = [];
    for (let r = 1; r < matrix.length; r++) {
      const line = matrix[r];
      if (!line || line.every(c => String(c || "").trim() === "")) continue;
      const obj = { __rowNumber: r + 1 };
      for (let c = 0; c < mappedHeaders.length; c++) {
        const key = mappedHeaders[c];
        if (!key) continue;
        let val = line[c] !== undefined && line[c] !== null ? String(line[c]).trim() : "";
        obj[key] = val;
      }
      rows.push(obj);
    }

    const presentSet = new Set(mappedHeaders);
    const missingHeaders = (schemaConfig.required_columns || []).filter(col => !presentSet.has(col));

    return { headers: mappedHeaders, rawHeaders, rows, missingHeaders };
  }

  function isValidDateString(val) {
    if (!val) return false;
    const s = String(val).trim();
    // Excel serial number (e.g. 46336)
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const num = parseFloat(s);
      return num > 30000 && num < 70000;
    }
    // YYYY-MM-DD
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) {
      const y = +iso[1], m = +iso[2], d = +iso[3];
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }
    // DD/MM/YYYY
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (dmy) {
      const d = +dmy[1], m = +dmy[2], y = +dmy[3];
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }
    return false;
  }

  function normalizeDateString(val) {
    const s = String(val || "").trim();
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const days = Math.floor(parseFloat(s));
      const dt = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
      return dt.toISOString().slice(0, 10);
    }
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    }
    return s;
  }

  function validateDataset(parsed, schemaConfig) {
    const errors = [];
    const warnings = [];
    const seenLeadIds = new Map();

    if (parsed.missingHeaders && parsed.missingHeaders.length > 0) {
      errors.push({
        row: 1,
        lead_id: "(Header)",
        column: parsed.missingHeaders.join(", "),
        value: "(Thiếu cột)",
        reason: `Thiếu các cột bắt buộc theo chuẩn: ${parsed.missingHeaders.join(", ")}`,
        suggestion: "Kiểm tra lại dòng tiêu đề của file CSV/XLSX/Google Sheet hoặc tải file mẫu chuẩn."
      });
    }

    if (!parsed.rows || parsed.rows.length === 0) {
      errors.push({
        row: 0,
        lead_id: "(Empty)",
        column: "dataset",
        value: "0 dòng",
        reason: "Tập dữ liệu không có bản ghi khách hàng nào.",
        suggestion: "Kiểm tra lại dữ liệu đầu vào."
      });
    }

    (parsed.rows || []).forEach((row, idx) => {
      const rowNum = row.__rowNumber || (idx + 2);
      const lid = String(row.lead_id || "").trim();

      if (!lid) {
        errors.push({
          row: rowNum,
          lead_id: "(Trống)",
          column: "lead_id",
          value: "",
          reason: "Thiếu mã hồ sơ (lead_id).",
          suggestion: `Nhập mã định danh duy nhất, ví dụ: L${String(rowNum - 1).padStart(3, "0")}`
        });
      } else {
        if (seenLeadIds.has(lid)) {
          errors.push({
            row: rowNum,
            lead_id: lid,
            column: "lead_id",
            value: lid,
            reason: `Mã hồ sơ '${lid}' bị trùng với dòng ${seenLeadIds.get(lid)} (mã bản ghi nguồn phải duy nhất).`,
            suggestion: `Đổi sang mã khác duy nhất, ví dụ: ${lid}_2`
          });
        } else {
          seenLeadIds.set(lid, rowNum);
        }
      }

      const comp = String(row.company_name || "").trim();
      if (!comp || comp.length < 2) {
        errors.push({
          row: rowNum,
          lead_id: lid || `Row ${rowNum}`,
          column: "company_name",
          value: comp,
          reason: "Tên doanh nghiệp trống hoặc quá ngắn (< 2 ký tự).",
          suggestion: "Nhập tên doanh nghiệp hợp lệ."
        });
      }

      const phoneRaw = String(row.phone || "").trim();
      const emailRaw = String(row.email || "").trim();
      if (!phoneRaw && !emailRaw) {
        warnings.push({
          row: rowNum,
          lead_id: lid,
          column: "phone / email",
          reason: "Thiếu cả SĐT lẫn Email — Agent sẽ gắn cờ thiếu thông tin liên hệ."
        });
      }
      if (phoneRaw) {
        const digits = phoneRaw.replace(/[\s.\-+()]/g, "");
        if (!/^\d{8,13}$/.test(digits)) {
          errors.push({
            row: rowNum,
            lead_id: lid || `Row ${rowNum}`,
            column: "phone",
            value: phoneRaw,
            reason: "Số điện thoại không đúng định dạng (cần 8-13 chữ số).",
            suggestion: "Nhập số điện thoại hợp lệ (ví dụ: 0912345678)."
          });
        }
      }
      if (emailRaw) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
          errors.push({
            row: rowNum,
            lead_id: lid || `Row ${rowNum}`,
            column: "email",
            value: emailRaw,
            reason: "Email không đúng định dạng chuẩn.",
            suggestion: "Sửa lại email dạng name@domain.com hoặc để trống nếu chưa có."
          });
        }
      }

      const budgetRaw = String(row.budget_vnd || "").trim();
      if (budgetRaw !== "") {
        const cleaned = budgetRaw.replace(/[,\s._]/g, "");
        if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
          errors.push({
            row: rowNum,
            lead_id: lid || `Row ${rowNum}`,
            column: "budget_vnd",
            value: budgetRaw,
            reason: "Ngân sách phải là số nguyên dương (VNĐ) hoặc để trống nếu chưa biết, không được nhập chữ.",
            suggestion: "Chuyển sang số VNĐ (ví dụ: 80000000) hoặc xóa để đánh dấu chưa rõ ngân sách."
          });
        } else if (parseFloat(cleaned) < 0) {
          errors.push({
            row: rowNum,
            lead_id: lid || `Row ${rowNum}`,
            column: "budget_vnd",
            value: budgetRaw,
            reason: "Ngân sách không được là số âm.",
            suggestion: "Sửa thành số dương >= 0 hoặc để trống."
          });
        }
      }

      const channelRaw = String(row.source_channel || "").trim();
      if (!channelRaw) {
        errors.push({
          row: rowNum,
          lead_id: lid || `Row ${rowNum}`,
          column: "source_channel",
          value: "",
          reason: "Thiếu kênh nguồn tiếp nhận (Hội thảo / Website / Campaign...).",
          suggestion: "Nhập nguồn tiếp nhận, ví dụ: Website."
        });
      }

      const regAt = String(row.registered_at || "").trim();
      if (regAt && !isValidDateString(regAt)) {
        errors.push({
          row: rowNum,
          lead_id: lid || `Row ${rowNum}`,
          column: "registered_at",
          value: regAt,
          reason: "Ngày đăng ký không hợp lệ (cần dạng YYYY-MM-DD hoặc DD/MM/YYYY).",
          suggestion: "Sửa về dạng YYYY-MM-DD (ví dụ: 2026-11-10)."
        });
      }

      // Non-blocking missing data warnings (user can fill or skip to next step)
      const missingOpt = [];
      if (!String(row.need_description || "").trim()) missingOpt.push("need_description");
      if (!String(row.budget_vnd || "").trim()) missingOpt.push("budget_vnd");
      if (!String(row.industry || "").trim()) missingOpt.push("industry");
      if (!String(row.region || "").trim()) missingOpt.push("region");
      if (!String(row.product_interest || "").trim()) missingOpt.push("product_interest");
      if (missingOpt.length > 0) {
        warnings.push({
          row: rowNum,
          lead_id: lid || `Row ${rowNum}`,
          column: missingOpt.join(", "),
          reason: `Thiếu thông tin (${missingOpt.join(", ")}) — có thể bổ sung hoặc bỏ qua để sang bước tiếp.`
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalRows: (parsed.rows || []).length
    };
  }

  // Skill: Auto-Repair Format Errors on Dataset
  function repairDatasetErrors(parsed, schemaConfig) {
    if (!parsed || !Array.isArray(parsed.rows)) return { repairedCount: 0, repairLog: [] };
    const repairLog = [];
    let repairedCount = 0;

    if (parsed.missingHeaders && parsed.missingHeaders.length > 0) {
      const added = [...parsed.missingHeaders];
      for (const col of added) {
        if (!parsed.headers.includes(col)) parsed.headers.push(col);
        parsed.rows.forEach(r => { if (r[col] === undefined) r[col] = ""; });
      }
      parsed.missingHeaders = [];
      repairedCount += added.length;
      repairLog.push(`Đã bổ sung ${added.length} cột thiếu trong cấu trúc: ${added.join(", ")}.`);
    }

    const seenIds = new Set();
    parsed.rows.forEach((r, idx) => {
      const rowNum = r.__rowNumber || (idx + 2);

      // 1. lead_id
      const origId = String(r.lead_id || "").trim();
      if (!origId || seenIds.has(origId)) {
        const newId = `L_FIX_${String(idx + 1).padStart(3, "0")}`;
        r.lead_id = newId;
        repairedCount++;
        repairLog.push(`Dòng ${rowNum}: Sửa lead_id '${origId || "(trống)"}' → '${newId}'.`);
      }
      seenIds.add(r.lead_id);

      // 2. company_name
      const origComp = String(r.company_name || "").trim();
      if (!origComp || origComp.length < 2) {
        r.company_name = `Doanh nghiệp (${r.lead_id})`;
        repairedCount++;
        repairLog.push(`Dòng ${rowNum}: Bổ sung tên doanh nghiệp tạm '${r.company_name}'.`);
      }

      // 3. phone
      if (r.phone) {
        let digits = String(r.phone).replace(/[\s.\-+()]/g, "");
        if (digits.startsWith("84") && digits.length >= 10) digits = "0" + digits.slice(2);
        if (/^\d{8,13}$/.test(digits)) {
          if (digits !== r.phone) {
            repairLog.push(`Dòng ${rowNum}: Chuẩn hóa SĐT '${r.phone}' → '${digits}'.`);
            r.phone = digits;
            repairedCount++;
          }
        } else {
          repairLog.push(`Dòng ${rowNum}: Xóa SĐT sai định dạng '${r.phone}' (chuyển thành thiếu SĐT).`);
          r.phone = "";
          repairedCount++;
        }
      }

      // 4. email
      if (r.email) {
        const trimmedEmail = String(r.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          repairLog.push(`Dòng ${rowNum}: Xóa Email sai định dạng '${r.email}' (chuyển thành thiếu Email).`);
          r.email = "";
          repairedCount++;
        } else if (trimmedEmail !== r.email) {
          r.email = trimmedEmail;
          repairedCount++;
        }
      }

      // 5. budget_vnd (support Vietnamese text like "80 triệu", "1.5 tỷ", "100.000.000 đ")
      if (r.budget_vnd !== undefined && String(r.budget_vnd).trim() !== "") {
        const rawB = String(r.budget_vnd).trim();
        const lowerB = removeVietnameseAccents(rawB).toLowerCase();
        const mTy = lowerB.match(/(\d+(?:[.,]\d+)?)\s*(ty|ti|b)\b/);
        const mTr = lowerB.match(/(\d+(?:[.,]\d+)?)\s*(trieu|tr|m)\b/);
        if (mTy) {
          r.budget_vnd = String(Math.round(parseFloat(mTy[1].replace(",", ".")) * 1000000000));
          repairedCount++;
          repairLog.push(`Dòng ${rowNum}: Quy đổi ngân sách '${rawB}' → ${r.budget_vnd} VNĐ.`);
        } else if (mTr) {
          r.budget_vnd = String(Math.round(parseFloat(mTr[1].replace(",", ".")) * 1000000));
          repairedCount++;
          repairLog.push(`Dòng ${rowNum}: Quy đổi ngân sách '${rawB}' → ${r.budget_vnd} VNĐ.`);
        } else {
          const digitsOnly = rawB.replace(/[^\d.-]/g, "");
          const num = parseFloat(digitsOnly);
          if (!isNaN(num) && num >= 0 && /^-?\d+(\.\d+)?$/.test(rawB.replace(/[,\s._đvnd]/gi, ""))) {
            const cleanNum = String(Math.round(num));
            if (cleanNum !== rawB) {
              r.budget_vnd = cleanNum;
              repairedCount++;
              repairLog.push(`Dòng ${rowNum}: Chuẩn hóa ngân sách '${rawB}' → ${cleanNum}.`);
            }
          } else {
            repairLog.push(`Dòng ${rowNum}: Xóa ngân sách không hợp lệ '${rawB}' (để trống).`);
            r.budget_vnd = "";
            repairedCount++;
          }
        }
      }

      // 6. source_channel
      if (!String(r.source_channel || "").trim()) {
        r.source_channel = "Website";
        repairedCount++;
        repairLog.push(`Dòng ${rowNum}: Điền nguồn tiếp nhận mặc định 'Website'.`);
      }

      // 7. registered_at
      if (r.registered_at && !isValidDateString(r.registered_at)) {
        const rawDate = String(r.registered_at).trim();
        const slashIso = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(rawDate);
        const dashDmy = /^(\d{1,2})[\-](\d{1,2})[\-](\d{4})$/.exec(rawDate);
        let fixed = new Date().toISOString().slice(0, 10);
        if (slashIso) {
          const candidate = `${slashIso[1]}-${slashIso[2].padStart(2, "0")}-${slashIso[3].padStart(2, "0")}`;
          if (isValidDateString(candidate)) fixed = candidate;
        } else if (dashDmy) {
          const candidate = `${dashDmy[3]}-${dashDmy[2].padStart(2, "0")}-${dashDmy[1].padStart(2, "0")}`;
          if (isValidDateString(candidate)) fixed = candidate;
        }
        r.registered_at = fixed;
        repairedCount++;
        repairLog.push(`Dòng ${rowNum}: Sửa ngày '${rawDate}' → '${fixed}'.`);
      }
    });

    return { repairedCount, repairLog };
  }

  return {
    removeVietnameseAccents,
    normalizeHeaderKey,
    parseCSV,
    matrixToObjects,
    isValidDateString,
    normalizeDateString,
    validateDataset,
    repairDatasetErrors
  };
})();
