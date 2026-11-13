# Nam Việt AI Sales Lead Agent (AI301 – Đề 02)

Giải pháp AI Agent hoàn chỉnh cho bài toán sàng lọc, lọc trùng, chấm điểm ưu tiên, phân công 8 Nhân viên Kinh doanh và điều phối ngoại lệ cho Trưởng phòng Kinh doanh tại **Công ty Phần mềm Quản lý Nam Việt**.

## 1. Cách khởi chạy nhanh (Zero-Install trên Windows)
Hệ thống chạy trực tiếp bằng Windows PowerShell + .NET có sẵn trên Windows (không cần cài Python hay Node.js):
1. Nhấn đúp vào `start.bat` (hoặc chạy lệnh `powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8765`).
2. Trình duyệt tự động mở tại `http://localhost:8765`.

## 2. Cấu trúc thư mục
- `server.ps1`: Local HTTP Server (đọc `.xlsx` nhiều sheet native, tải Google Sheets không bị CORS, lưu log JSONL vào `logs/`, tùy chọn proxy LLM).
- `start.bat`: Script khởi chạy 1-click.
- `config/business_rules.json`: Quy tắc lọc trùng, trọng số ưu tiên, danh mục 4 nhóm sản phẩm Nam Việt, danh sách 8 NVKD và lịch sử liên hệ.
- `public/index.html`, `public/styles.css`: Giao diện Web Dashboard trực quan.
- `public/js/validator.js`: Cổng kiểm tra định dạng & tính hợp lệ dữ liệu đầu vào (bắt buộc sửa đúng chuẩn mới cho chạy tiếp).
- `public/js/skills.js`: 5 kỹ năng nghiệp vụ độc lập (Deduplication, History & Missing Info, Priority Scoring, Assignment & Outreach Drafting, Reporting).
- `public/js/agent_engine.js`: Bộ điều phối Tool-Calling AI Agent & ghi nhật ký truy vết (Execution Trace).
- `public/js/app.js`: Giao diện tương tác, Inline Data Editor, Manager Approval, Export CSV/JSONL và Bộ Tự Kiểm Thử (Self-Test Suite).
- `data/sample_normal_and_edge_cases.csv`: Dữ liệu mẫu chuẩn gồm ca thông thường, thiếu dữ liệu, trùng viết tắt, sai sản phẩm ngân sách lớn, lịch sử chặn và các ranh giới quy tắc.
- `data/sample_invalid_format.csv`: Dữ liệu mẫu sai định dạng để kiểm thử ràng buộc khóa quy trình và sửa trực tiếp trên UI.
- `docs/Task1_PhanTich_ThietKe.md`: Tài liệu trả lời đầy đủ Task 1.

## 3. Đầu vào hỗ trợ & Ràng buộc kiểm tra
- **Định dạng đầu vào**: File `.csv` (UTF-8), file `.xlsx` (1 sheet hoặc nhiều sheet gồm `leads`, `contact_history`, `sales_staff`), hoặc **Link Google Sheets** (chế độ chia sẻ xem công khai).
- **Ràng buộc kiểm tra định dạng**:
  - Khi dữ liệu **khớp yêu cầu** → Mở khóa và cho phép chạy quy trình AI Agent.
  - Khi dữ liệu **sai yêu cầu** (thiếu cột bắt buộc, trùng `lead_id`, ngân sách nhập chữ/số âm, email/SĐT/ngày sai định dạng, thiếu kênh nguồn) → Hệ thống **khóa nút chạy**, chỉ rõ từng ô lỗi và cho phép người dùng **sửa trực tiếp trên bảng** rồi nhấn **Kiểm tra lại** để tiếp tục.

## 4. Tự kiểm thử tại buổi thi
1. Mở tab **5. Tự Kiểm Thử (Self-Test)** và nhấn **Chạy Toàn Bộ Kiểm Thử** để xác minh các kịch bản Thông thường, Thiếu dữ liệu, Ranh giới quy tắc và Ràng buộc dữ liệu sai.
2. Nhấn **Sinh Test 700 Leads/Tuần** để kiểm chứng hiệu năng xử lý khối lượng ~700 hồ sơ/tuần.
3. Trong buổi thi, khi nhận bộ dữ liệu mới từ giảng viên (CSV / XLSX / Google Sheets), nạp trực tiếp tại Bước 1; nếu quy tắc hoặc danh sách NVKD thay đổi, cập nhật ngay tại tab **6. Quy tắc & Cấu hình**.

