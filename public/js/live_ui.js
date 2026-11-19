// live_ui.js - Interactive Live Background Canvas & Landing Page Micro-Interactions

(() => {
  const WORKFLOW_PREVIEWS = {
    1: {
      badge: "BƯỚC 01 · ĐẦU VÀO",
      title: "Nhận CSV / Excel / Google Sheets",
      metric: "CSV · XLSX · G-Sheet",
      desc: "Nạp trực tiếp file dữ liệu bán lẻ, hợp đồng, marketing, tài chính hoặc link Google Sheets công khai.",
      status: "Tự động đọc mọi bảng dữ liệu"
    },
    2: {
      badge: "BƯỚC 02 · KIỂM ĐỊNH",
      title: "Kiểm tra Cấu trúc & Định dạng",
      metric: "Schema & Type Gate",
      desc: "Tự động nhận diện kiểu cột số liệu, ngày tháng, phân nhóm và báo lỗi cụ thể từng ô để sửa ngay tại bảng.",
      status: "Chặn dữ liệu lỗi ngay đầu vào"
    },
    3: {
      badge: "BƯỚC 03 · PHẠM VI & LÀM SẠCH",
      title: "Trao đổi AI & Chuẩn hóa Dữ liệu",
      metric: "Interactive AI Scope",
      desc: "AI đọc trực tiếp nội dung file, gợi ý câu hỏi theo góc nhìn thực tế, chat chốt phạm vi và làm sạch dữ liệu.",
      status: "Đồng bộ phạm vi xuống Dashboard"
    },
    4: {
      badge: "BƯỚC 04 · PROCESS",
      title: "AI Agent Phân tích Đa hình",
      metric: "Gemini Dual-Brain",
      desc: "Tự động chọn 4 chỉ số KPI phù hợp lĩnh vực, lọc nhóm theo yêu cầu và tổng hợp nhận định chuyên sâu.",
      status: "Không bịa số liệu khi thiếu cột"
    },
    5: {
      badge: "BƯỚC 05 · VERIFY",
      title: "Kiểm chứng & Phản hồi Tinh chỉnh",
      metric: "Data Integrity Check",
      desc: "Đối chiếu độ nhất quán của dữ liệu và số liệu tổng hợp; cho phép gửi Feedback để AI phân tích lại ngay.",
      status: "Vòng lặp tinh chỉnh khép kín"
    },
    6: {
      badge: "BƯỚC 06 · DASHBOARD & XUẤT",
      title: "Dashboard KPI & Báo cáo HTML",
      metric: "1-Click Export HTML",
      desc: "Biểu đồ tự thích ứng, thẻ giải đáp trực tiếp câu hỏi đã trao đổi với AI và xuất file báo cáo HTML độc lập.",
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

      // Subtle mouse radial glow (gentle warm honey tone on crisp white)
      if (mouse.active) {
        const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 240);
        grad.addColorStop(0, "rgba(245, 158, 11, 0.08)");
        grad.addColorStop(0.55, "rgba(245, 158, 11, 0.02)");
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
            const alpha = (1 - d / 135) * (n.accent || m.accent ? 0.26 : 0.12);
            ctx.strokeStyle = (n.accent || m.accent)
              ? `rgba(217, 119, 6, ${(alpha * 0.75).toFixed(3)})`
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
            const alpha = (1 - dm / 175) * 0.35;
            ctx.strokeStyle = `rgba(217, 119, 6, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }

        ctx.fillStyle = n.accent ? "rgba(217, 119, 6, 0.55)" : "rgba(17, 17, 17, 0.22)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Click ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 3.2;
        rp.alpha *= 0.94;
        ctx.strokeStyle = `rgba(217, 119, 6, ${(rp.alpha * 0.6).toFixed(3)})`;
        ctx.lineWidth = 1.2;
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

    // Interactive analytics pillar chips on hero white card
    const prodPills = Array.from(document.querySelectorAll(".hero-prod-pill"));
    const prodDetail = document.getElementById("heroProdDetail");
    const prodMap = {
      "KPI": "Tự động nhận diện cột & dựng 4 thẻ KPI theo đúng ngữ cảnh file",
      "TREND": "Theo dõi xu hướng biến động qua từng kỳ tháng & tăng trưởng",
      "DONUT": "Phân rã cơ cấu đóng góp theo kênh, chu kỳ, khu vực & phân khúc",
      "CHAT": "Trao đổi trực tiếp, lọc nhóm & giải đáp câu hỏi từ số liệu thật"
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

  function initPage3LiveHover() {
    document.addEventListener("mousemove", (e) => {
      const target = e.target.closest(".interactive-panel, .kpi-card, .chart-card, .report-block, .staff-chart-row");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      target.style.setProperty("--item-mx", `${x}px`);
      target.style.setProperty("--item-my", `${y}px`);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initLiveCanvas();
    initLandingInteractions();
    initPage3LiveHover();
  });
})();

