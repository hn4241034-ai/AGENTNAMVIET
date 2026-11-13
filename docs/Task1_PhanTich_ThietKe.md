# Báo cáo Phân tích & Thiết kế AI Agent – Công ty Phần mềm Nam Việt (AI301 – Đề 02)

---

## TASK 1: PHÂN TÍCH QUY TRÌNH & THIẾT KẾ HỆ THỐNG AI AGENT

### 1. Phân tích quy trình hiện tại (As-Is)
Hiện tại, Công ty Phần mềm Nam Việt xử lý khoảng **700 thông tin khách hàng (lead)/tuần** từ Hội thảo, Website và các chiến dịch bán hàng theo quy trình thủ công:
1. **Tiếp nhận & chuyển danh sách thô**: Bộ phận Tiếp thị gom danh sách từ các kênh và chuyển thẳng file thô cho 8 Nhân viên Kinh doanh (NVKD).
2. **Tự đọc & tự chấm ưu tiên**: Mỗi NVKD tự đọc từng dòng, tự đánh giá mức độ ưu tiên theo cảm tính (chủ yếu nhìn ngân sách).
3. **Tự liên hệ khách hàng**: NVKD tự gọi/gửi email mà không có bước đối chiếu lịch sử liên hệ hay kiểm tra chéo giữa 8 người.
4. **Báo cáo tổng hợp cho Trưởng phòng Kinh doanh**: Tổng hợp thủ công sau khi liên hệ, thiếu dữ liệu gốc và lý do phân loại.

#### Xác định 4 vấn đề cốt lõi trong bối cảnh & ảnh hưởng cụ thể
| STT | Vấn đề trong quy trình hiện tại | Nguyên nhân gốc rễ | Ảnh hưởng cụ thể tới doanh nghiệp |
|---|---|---|---|
| **1** | **Trùng lặp hồ sơ & gọi trùng khách hàng** | Cùng một doanh nghiệp có nhiều người đăng ký qua nhiều kênh, dùng tên viết tắt/alias khác nhau; không có bước chuẩn hóa và gom nhóm trước khi phát cho 8 NVKD. | Hai NVKD cùng gọi một khách gây phản cảm, giảm uy tín chuyên nghiệp; sai lệch số liệu đếm khách tiềm năng và lãng phí công sức gọi lặp. |
| **2** | **Chấm ưu tiên sai lệch (ngân sách lớn nhưng sai sản phẩm)** | NVKD tự chấm theo cảm tính nhìn ngân sách lớn mà không đối chiếu chặt với nhóm sản phẩm Nam Việt (ERP, CRM, HRM, POS) và phạm vi ngành/khu vực. | Đổ nguồn lực bán hàng vào cơ hội không thể chốt (tỷ lệ chuyển đổi thấp), mất thời gian xử lý ngoài phạm vi sản phẩm. |
| **3** | **Bỏ sót cơ hội phù hợp vì thiếu thông tin ban đầu** | Hồ sơ đăng ký thiếu ngân sách, quy mô hoặc mô tả sơ sài bị NVKD gạt bỏ để chạy theo hồ sơ nhìn "đầy đủ" hơn; không có quy trình tự động đặt câu hỏi bổ sung. | Mất khách hàng SME có nhu cầu thật với sản phẩm Nam Việt, sụt giảm doanh thu tiềm năng từ hội thảo/website. |
| **4** | **Trưởng phòng thiếu khả năng giám sát & phát hiện phân công sai** | Không có danh sách tập trung ghi nhận hồ sơ nào chưa có người phù hợp, hồ sơ nào vi phạm lịch sử không liên hệ lại, hay nhân viên nào quá tải/tranh chấp vùng. | Cơ hội bị bỏ quên không được phát hiện kịp thời; không cân bằng được tải công việc giữa 8 NVKD; thiếu nhật ký truy vết trách nhiệm. |

---

### 2. Quy trình đề xuất (To-Be) theo sơ đồ Workflow Nam Việt

| Bước | Tên bước | Đầu vào | Công việc thực hiện | Đầu ra | Người / Bộ phận chịu trách nhiệm |
|---|---|---|---|---|---|
| **B1** | Tiếp nhận & Kiểm tra định dạng đầu vào | File CSV, XLSX (1 hoặc nhiều sheet) hoặc Link Google Sheets | Đọc dữ liệu, chuẩn hóa tên cột, kiểm tra bắt buộc định dạng (`lead_id`, `company_name`, SĐT/Email, `budget_vnd` số dương, ngày hợp lệ). **Nếu sai định dạng: khóa quy trình và yêu cầu chỉnh sửa/nạp lại đúng chuẩn.** | Tập dữ liệu thô đạt chuẩn + Báo cáo kiểm tra định dạng | Bộ phận Tiếp thị / Hệ thống Cổng kiểm soát (Validation Gate) |
| **B2** | Chuẩn hóa & Lọc trùng Dữ liệu | Danh sách lead đạt chuẩn + quy tắc trùng | Chuẩn hóa tên DN (loại tiền tố TNHH/CP, viết tắt, alias), SĐT, Email, MST. Gom nhóm các bản ghi cùng doanh nghiệp; đánh dấu ca trùng mơ hồ. | Danh sách Khách hàng duy nhất (`CUST-xxx`), kèm `source_records` và cờ trùng mơ hồ | **AI Agent (Skill 1)** |
| **B3** | Đối chiếu Lịch sử, Sản phẩm & Thông tin thiếu | Khách hàng duy nhất + `contact_history` + `products` | Kiểm tra khách thuộc danh sách `do_not_contact` hoặc đang có NVKD cũ chăm sóc (`active`). Đối chiếu nhu cầu với 4 nhóm sản phẩm Nam Việt, phát hiện sai sản phẩm, liệt kê trường thiếu. | Hồ sơ phân tích nhu cầu + Danh sách `missing_fields` + Cờ `do_not_contact` | **AI Agent (Skill 2)** |
| **B4** | Chấm điểm ưu tiên & Đề xuất NVKD | Hồ sơ đã phân tích + `sales_staff` (8 NVKD) + quy tắc | Chấm điểm 0–100 (Product Fit 40đ, Need Clarity 25đ, Budget 20đ, Urgency 15đ); chặn bẫy ngân sách lớn sai sản phẩm; giữ điểm tiềm năng cho hồ sơ thiếu ngân sách. Ghép 8 NVKD theo Ngành + Khu vực + Sản phẩm + Tải tuần; kiểm tra vượt thẩm quyền/tranh chấp. | Mức ưu tiên + Căn cứ xếp loại + NVKD đề xuất + Cờ cần Trưởng phòng duyệt / Unassigned | **AI Agent (Skill 3 & 4)** |
| **B5** | Tạo Bản nháp Tiếp cận / Câu hỏi bổ sung | Hồ sơ đã chấm điểm & đề xuất NVKD | Nếu thiếu thông tin -> sinh bản nháp câu hỏi bổ sung; nếu đầy đủ -> sinh bản nháp thông điệp tiếp cận cá nhân hóa theo sản phẩm. | Bản nháp thông điệp & `next_action` cho từng khách | **AI Agent (Skill 4)** |
| **B6** | Kiểm tra & Phê duyệt Ngoại lệ (Human-in-the-Loop) | Danh sách `manager_review` & `unassigned` | Trưởng phòng Kinh doanh xem xét các ca trùng tên mơ hồ, ngân sách VIP (≥300 triệu), tranh chấp NVKD cũ-mới, NVKD quá tải hoặc khách ngoài vùng/ngành để chốt phương án. | Quyết định phê duyệt phân công cuối cùng | **Trưởng phòng Kinh doanh** |
| **B7** | Giao việc, Theo dõi & Ghi Nhật ký Truy vết | Danh sách công việc đã duyệt + toàn bộ trace | Xuất danh sách việc theo 8 NVKD, danh sách ngừng liên hệ, thống kê không đếm lặp và lưu nhật ký JSONL từng bước gọi công cụ. | Task List trên UI, file CSV/JSONL, Nhật ký truy vết | **Đội ngũ 8 NVKD & Hệ thống Audit Log** |

---

### 3. Các bước AI Agent tự thực hiện & Lý do lựa chọn (≥ 3 bước)
1. **Chuẩn hóa & Lọc trùng dữ liệu (Skill 1)**:
   - *Lý do*: Khối lượng ~700 lead/tuần có nhiều biến thể viết tắt (`Công ty TNHH Hoàng Hà`, `Cty HH`, `Hoàng Hà Corp`), con người dò tay bằng Excel rất chậm và dễ sót dẫn đến gọi trùng. AI Agent đối chiếu đồng thời MST, SĐT, Email và độ tương đồng tên/alias trong vài mili-giây và giữ nguyên toàn bộ `source_records` để truy vết.
2. **Phân tích lịch sử, phát hiện sai sản phẩm, trích xuất thông tin thiếu & Chấm điểm ưu tiên (Skill 2 & 3)**:
   - *Lý do*: Cần áp dụng nhất quán bộ trọng số nghiệp vụ cho 100% hồ sơ, không bị cảm tính như con người ("nhìn ngân sách lớn bỏ qua sản phẩm" hoặc "thấy thiếu ngân sách liền bỏ qua khách"). Agent luôn xuất `priority_rationale` minh bạch từng thành phần điểm.
3. **Đề xuất NVKD theo đa điều kiện & Tạo bản nháp thông điệp/câu hỏi bổ sung (Skill 4)**:
   - *Lý do*: Việc ghép đồng thời 4 ràng buộc (Ngành, Khu vực, Sản phẩm, Tải tuần hiện tại của 8 NVKD) và soạn sẵn email/câu hỏi bổ sung cá nhân hóa giúp rút ngắn thời gian phản hồi xuống dưới 24h và giải phóng NVKD khỏi việc đọc lại từ đầu.

---

### 4. Điểm con người cần kiểm tra/quyết định (Human-in-the-Loop ≥ 2 điểm)

| Điểm kiểm tra | Người quyết định | Điều kiện chuyển sang con người xử lý | Cách phát hiện kết quả sai của Agent |
|---|---|---|---|
| **Điểm 1: Xác nhận gộp trùng mơ hồ & Tranh chấp phân công / VIP** | Trưởng phòng Kinh doanh | (a) Độ tương đồng tên nằm trong vùng xám `[62%, 78%)` và khác SĐT/Email/MST; (b) Khách VIP ngân sách `≥ 300.000.000 VNĐ`; (c) Khách đang có NVKD cũ (`active`) ở khu vực khác với NVKD vùng mới; (d) NVKD phù hợp đã chạm định mức tải tuần. | Kiểm tra trường `ambiguous_duplicate` và `escalation_reasons` trên tab **Công việc & Duyệt Trưởng phòng**; đối chiếu `source_records` gốc (nếu 2 công ty thực chất khác MST -> tách hồ sơ; nếu cùng công ty -> gộp). |
| **Điểm 2: Rà soát lại hồ sơ "Chưa có NVKD phù hợp" / Thông điệp trước khi gửi** | Trưởng phòng Kinh doanh & NVKD | (a) Khách nằm trong danh sách `unassigned` (ví dụ ngành/khu vực mới chưa phân công trong 8 NVKD); (b) Trước khi NVKD nhấn gửi bản nháp thông điệp/câu hỏi bổ sung cho khách hàng có trường thiếu hoặc mức ưu tiên ranh giới. | So sánh `priority_rationale` với mô tả nhu cầu gốc (`merged_needs`) và kiểm tra `missing_fields`. Nếu Agent nhận diện nhầm từ khóa sản phẩm hoặc gán nhầm khu vực do địa danh viết tắt, người dùng phát hiện ngay qua bảng đối chiếu song song bản ghi nguồn – kết quả và chỉnh sửa trực tiếp. |

---

### 5. Bản thiết kế Hệ thống theo Mục tiêu – Đầu vào – Quy trình – Đầu ra

- **Mục tiêu**: Tự động hóa hoàn toàn quy trình sàng lọc ~700 lead/tuần của Công ty Nam Việt từ dữ liệu thô tới danh sách hành động cho 8 NVKD và Trưởng phòng; loại bỏ gọi trùng, chặn ưu tiên sai sản phẩm, không bỏ sót khách thiếu thông tin và đảm bảo truy vết 100%.
- **Đầu vào**:
  - File `.csv`, `.xlsx` (1 hoặc nhiều sheet) hoặc Link Google Sheets công khai.
  - Cấu trúc dữ liệu: `leads`, `contact_history`, `products`, `sales_staff` (8 NVKD), `business_rules.json`.
  - Ràng buộc đầu vào: Phải vượt qua **Cổng kiểm tra định dạng (Validation Gate)**; nếu sai định dạng, người dùng bắt buộc chỉnh sửa trên bảng dữ liệu hoặc nạp lại đúng chuẩn mới được chạy tiếp.
- **Quy trình (Kiến trúc Modular Tool-Calling Agent)**:
  - **Tầng Giao diện (Web SPA)**: Tiếp nhận file/link, kiểm tra & sửa lỗi inline, hiển thị dashboard phân tích, bảng duyệt Trưởng phòng, bản nháp và log.
  - **Tầng Backend Local Server (`server.ps1` / .NET HttpListener)**: Parse `.xlsx` native nhiều sheet, tải Google Sheets không bị CORS, lưu vết JSONL xuống `logs/`, proxy tùy chọn tới LLM API.
  - **Tầng Agent Orchestrator (`agent_engine.js` + `skills.js`)**: Thực thi chuỗi Tool Calls (`validate_input_schema` → `normalize_and_deduplicate_leads` → `analyze_needs_history_and_missing` → `score_customer_priority` → `assign_salesperson_and_draft_outreach` → `compile_manager_report_and_stats`), hỗ trợ cả **Autonomous Local Mode** và **External LLM Executive Synthesis**.
- **Đầu ra**:
  - Trực tiếp trên giao diện: KPI tổng hợp không đếm lặp, Bảng hồ sơ khách hàng duy nhất (kèm bản ghi nguồn, căn cứ ưu tiên, thông tin thiếu, NVKD đề xuất, việc tiếp theo, bản nháp tiếp cận/câu hỏi), 4 hàng đợi công việc (Cần Trưởng phòng duyệt, Chưa có NVKD phù hợp, Ngừng liên hệ, Việc theo từng NVKD), Nhật ký truy vết từng bước và Xuất CSV/JSONL.

