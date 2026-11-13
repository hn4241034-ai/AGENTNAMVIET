// live_ui.js - Interactive Live Background Canvas & Landing Page Micro-Interactions

(() => {
  const WORKFLOW_PREVIEWS = {
    1: {
      badge: "BƯỚC 01 · ĐẦU VÀO",
      title: "Nhận Excel / Google Sheets",
      metric: "CSV · XLSX · G-Sheet",
      desc: "Nạp trực tiếp file từ máy hoặc link Google Sheets nhiều tab (leads, history, staff).",
      status: "Hỗ trợ ~700 hồ sơ/tuần"
    },
    2: {
      badge: "BƯỚC 02 · HỢP LỆ?",
      title: "Kiểm tra Định dạng",
      metric: "Schema & Type Gate",
      desc: "Sai cột, SĐT, Email, Ngày hoặc Ngân sách sẽ báo lỗi cụ thể từng ô để sửa ngay tại bảng.",
      status: "Khóa quy trình nếu sai chuẩn"
    },
    3: {
      badge: "BƯỚC 03 · ĐÃ SẠCH?",
      title: "Làm sạch Dữ liệu",
      metric: "Normalize & Stabilize",
      desc: "Chuẩn hóa SĐT (+84→0), ngày YYYY-MM-DD, khu vực, mã SP. Có thể làm sạch lại đến khi ổn.",
      status: "Sẵn sàng trước khi Process"
    },
    4: {
      badge: "BƯỚC 04 · PROCESS",
      title: "AI Agent Xử lý (5 Skills)",
      metric: "Gemini Dual-Brain",
      desc: "Gộp trùng viết tắt/alias, chặn lịch sử opt-out, chấm ưu tiên tránh bẫy sai SP, gán 8 NVKD.",
      status: "Tạo sẵn bản nháp & câu hỏi"
    },
    5: {
      badge: "BƯỚC 05 · VERIFY?",
      title: "Kiểm chứng & Feedback",
      metric: "5 Tiêu chí Kiểm soát",
      desc: "Tự kiểm tra không đếm lặp, chặn sai SP, ca VIP. Chưa đạt → gửi Feedback chạy lại Process.",
      status: "Vòng lặp phản hồi khép kín"
    },
    6: {
      badge: "BƯỚC 06 · CHỐT & XUẤT",
      title: "Dashboard & Xuất HTML",
      metric: "1-Click Export HTML",
      desc: "Rà soát kết quả, duyệt ca Trưởng phòng, chốt kết quả và xuất file báo cáo HTML hoàn chỉnh.",
      status: "Hoàn tất + Log JSONL"
    }
  };

  function initLiveCanvas() {
    const canvas = document.getElementById("liveBgCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    const mouse = { x: -9999, y: -9999, active: false };
    const ripples = [];
    let nodes = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(68, Math.max(28, Math.floor((width * height) / 26000)));
      nodes = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.42,
        vy: (Math.random() - 0.5) * 0.42,
        r: i % 5 === 0 ? 2.4 : 1.5,
        accent: i % 5 === 0
      }));
    }

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      document.documentElement.style.setProperty("--mx", e.clientX + "px");
      document.documentElement.style.setProperty("--my", e.clientY + "px");

      const star = document.getElementById("heroAsterisk");
      if (star) {
        const angle = (e.clientX / Math.max(1, width)) * 90 + (window.scrollY * 0.15);
        star.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      }
    });
    window.addEventListener("mouseleave", () => { mouse.active = false; });
    window.addEventListener("click", (e) => {
      ripples.push({ x: e.clientX, y: e.clientY, r: 4, alpha: 0.45 });
    });

    function tick() {
      ctx.clearRect(0, 0, width, height);

      // Subtle mouse radial glow (warm golden-yellow on bright white)
      if (mouse.active) {
        const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 260);
        grad.addColorStop(0, "rgba(250, 204, 21, 0.22)");
        grad.addColorStop(0.55, "rgba(250, 204, 21, 0.06)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // Update & draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;

        if (mouse.active) {
          const dx = mouse.x - n.x;
          const dy = mouse.y - n.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 170 && dist > 1) {
            n.x += (dx / dist) * 0.35;
            n.y += (dy / dist) * 0.35;
          }
        }

        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const d = Math.hypot(n.x - m.x, n.y - m.y);
          if (d < 135) {
            const alpha = (1 - d / 135) * (n.accent || m.accent ? 0.34 : 0.14);
            ctx.strokeStyle = (n.accent || m.accent)
              ? `rgba(234, 179, 8, ${alpha.toFixed(3)})`
              : `rgba(17, 17, 17, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
        }

        if (mouse.active) {
          const dm = Math.hypot(mouse.x - n.x, mouse.y - n.y);
          if (dm < 175) {
            const alpha = (1 - dm / 175) * 0.48;
            ctx.strokeStyle = `rgba(234, 179, 8, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }

        ctx.fillStyle = n.accent ? "rgba(234, 179, 8, 0.85)" : "rgba(17, 17, 17, 0.25)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Click ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 3.2;
        rp.alpha *= 0.94;
        ctx.strokeStyle = `rgba(234, 179, 8, ${rp.alpha.toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.stroke();
        if (rp.alpha < 0.02) ripples.splice(i, 1);
      }

      requestAnimationFrame(tick);
    }

    resize();
    tick();
  }

  function initLandingInteractions() {
    const items = Array.from(document.querySelectorAll(".wf-list-item"));
    const previewCard = document.getElementById("wfPreviewScreen");
    if (!items.length || !previewCard) return;

    function selectStep(stepNum) {
      const data = WORKFLOW_PREVIEWS[stepNum];
      if (!data) return;
      items.forEach(el => {
        const active = Number(el.dataset.step) === Number(stepNum);
        el.classList.toggle("active", active);
      });
      previewCard.innerHTML = `
        <div class="preview-chip">${data.badge}</div>
        <div class="preview-metric">${data.metric}</div>
        <h4>${data.title}</h4>
        <p>${data.desc}</p>
        <div class="preview-footer">
          <span class="live-dot"></span>
          <span>${data.status}</span>
        </div>
      `;
    }

    items.forEach(el => {
      el.addEventListener("mouseenter", () => selectStep(el.dataset.step));
      el.addEventListener("click", () => selectStep(el.dataset.step));
    });
    selectStep(1);

    // Interactive product filter chips on hero white card
    const prodPills = Array.from(document.querySelectorAll(".hero-prod-pill"));
    const prodDetail = document.getElementById("heroProdDetail");
    const prodMap = {
      "NV-ERP": "Quản trị tổng thể, kho & kế toán sản xuất",
      "NV-CRM": "Quản lý khách hàng & sales pipeline",
      "NV-HRM": "Chấm công, tính lương & nhân sự",
      "NV-POS": "Bán hàng & quản lý chuỗi cửa hàng"
    };
    prodPills.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        prodPills.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (prodDetail) prodDetail.textContent = prodMap[btn.dataset.prod] || "";
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initLiveCanvas();
    initLandingInteractions();
  });
})();

