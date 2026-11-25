# Minh Hoàng AI Data Analyst

> **Tuyên ngôn nền tảng:**  
> *"Chúng tôi là Minh Hoàng. AI Agent không chỉ đọc số liệu — mà biến dữ liệu thành quyết định."*

Hệ thống AI Agent phân tích dữ liệu kinh doanh đa hình thích ứng (Polymorphic Adaptive Analytics), tự động nhận diện cấu trúc tệp dữ liệu, tương tác trực tiếp Người ↔ AI để xác định phạm vi, trực quan hóa Dashboard KPI và giải đáp trực diện các câu hỏi quản trị kinh doanh.

---

## 1. Khởi chạy nhanh (Zero-Install trên Windows)
Hệ thống sử dụng PowerShell và Web API có sẵn trên Windows (không cần cài thêm Python hay Node.js):
1. Nhấn đúp chuột vào tệp `start.bat` (hoặc chạy lệnh: `powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8765`).
2. Trình duyệt tự động mở tại địa chỉ: `http://localhost:8765`.

Hoặc triển khai trực tiếp lên **GitHub Pages** để chia sẻ công khai không cần cấu hình máy chủ.

---

## 2. Điểm nổi bật của Minh Hoàng AI Data Analyst
1. **Tiếp nhận đa nguồn linh hoạt:** Hỗ trợ tải tệp CSV, Excel nhiều sheet (`.xlsx`, `.xls`) hoặc kết nối qua link Google Sheets công khai.
2. **Cổng kiểm định & Sửa trực tiếp (Inline Data Editor):** Tự động rà soát kiểu dữ liệu và cho phép chỉnh sửa trực tiếp các ô lỗi ngay trên trình duyệt mà không cần mở Excel ngoài.
3. **Tương tác trực tiếp Người ↔ AI:**
   - Nút `✦ Gợi ý câu hỏi mới từ file`: AI tự động suy luận câu hỏi nghiệp vụ sát thực tế theo 3 góc nhìn (Phạm vi & Chỉ số chủ lực, Rủi ro tập trung, Mục tiêu định lượng), tuyệt đối không dập khuôn.
   - Khung chat `💬 Trao đổi trực tiếp`: Người dùng chat bằng ngôn ngữ tự nhiên để lọc nhóm, đổi kỳ hoặc đặt mục tiêu doanh thu.
4. **Động cơ phân tích đa hình thích ứng:** Tự động nhận diện 5 ngữ cảnh kinh doanh (Bán lẻ/E-commerce, Hợp đồng SaaS/B2B, Tiếp thị số/Ads, Quản lý Leads/CRM, Bảng số liệu tổng hợp tùy ý) và tính toán 4 chỉ số KPI thực tế mà không bịa số liệu.
5. **Dashboard & Báo cáo đồng bộ Q&A:** Khối giải đáp Q&A hiển thị từng dòng ngang độc lập, trả lời trực diện kèm dẫn chứng số liệu cụ thể (`Evidence`).
6. **Báo cáo điều hành & Xuất file HTML 1-Click:** Bản Tóm tắt điều hành (Executive AI Brief) với các biểu tượng `+` (điểm sáng) và `-` (cảnh báo/hành động), cho phép tải về 1 tệp HTML độc lập để gửi sếp hoặc đối tác.

---

## 3. Cấu trúc thư mục dự án
- `index.html`, `styles.css`: Giao diện Web Dashboard trực quan, bố cục 2 cột cân đối, chuẩn nhận diện thương hiệu Minh Hoàng.
- `public/`: Thư mục mã nguồn giao diện web phục vụ chạy máy chủ cục bộ hoặc GitHub Pages.
- `js/` (và `public/js/`):
  - `agent_engine.js`: Bộ máy điều phối AI Agent, trích xuất cấu trúc file, kết nối Gemini LLM và bộ suy luận dự phòng.
  - `app.js`: Tương tác giao diện người dùng, xử lý chat, rà soát bảng dữ liệu và cập nhật Dashboard.
  - `skills.js`: Các kỹ năng phân tích chuyên sâu, chuẩn hóa dữ liệu và tính toán thống kê.
  - `validator.js`: Cổng kiểm tra tính hợp lệ của tệp dữ liệu.
- `docs/LUONG_PHAN_TICH_DU_LIEU_AI_AGENT.md`: Tài liệu kiến trúc và luồng phân tích dữ liệu 6 bước chi tiết để tham khảo.
- `data/`: Các tệp dữ liệu mẫu phục vụ kiểm thử.
- `server.ps1`: Máy chủ nội bộ nhẹ bằng PowerShell hỗ trợ đọc file Excel, vượt rào cản CORS Google Sheets và proxy AI.
- `start.bat`: Phím tắt 1-click khởi chạy máy chủ.

---

## 4. Tài liệu tham khảo chi tiết
Xem chi tiết toàn bộ luồng xử lý và kiến trúc kỹ thuật tại:  
👉 [LUONG_PHAN_TICH_DU_LIEU_AI_AGENT.md](file:///d:/AGENNNT/docs/LUONG_PHAN_TICH_DU_LIEU_AI_AGENT.md)
