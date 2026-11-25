# TÀI LIỆU KIẾN TRÚC & LUỒNG PHÂN TÍCH DỮ LIỆU
## HỆ THỐNG MINH HOÀNG AI DATA ANALYST

> **Tuyên ngôn nền tảng:**  
> *"Chúng tôi là Minh Hoàng. AI Agent không chỉ đọc số liệu — mà biến dữ liệu thành quyết định."*

---

## 1. TỔNG QUAN HỆ THỐNG & GIÁ TRỊ CỐT LÕI

**Minh Hoàng AI Data Analyst** là nền tảng AI Agent phân tích dữ liệu kinh doanh đa hình thích ứng (Polymorphic Adaptive Analytics), được thiết kế nhằm giải quyết triệt để 3 điểm nghẽn lớn nhất của các công cụ BI và Chatbot AI truyền thống:

1. **Khắc phục sự cứng nhắc của Dashboard truyền thống:** Không bắt buộc người dùng phải gán cứng schema cố định, không hiển thị các ô số liệu vô nghĩa (`0 VND`, `Không có cột`).
2. **Khắc phục tính "ảo giác" (hallucination) của Chatbot thông thường:** 100% số liệu hiển thị, biểu đồ và câu trả lời đều được tính toán từ các dòng dữ liệu thực tế trong tệp cung cấp, có dẫn chứng chi tiết (`Evidence-based`).
3. **Hiện thực hóa tương tác Người ↔ AI 2 chiều (Human-in-the-Loop):** AI chủ động đọc dữ liệu để gợi ý câu hỏi nghiệp vụ sát thực tế; người dùng có thể trao đổi trực tiếp bằng ngôn ngữ tự nhiên để định hướng phạm vi phân tích, và toàn bộ Dashboard lẫn Báo cáo điều hành sẽ lập tức giải đáp đúng các câu hỏi đó.

---

## 2. SƠ ĐỒ LUỒNG PHÂN TÍCH DỮ LIỆU TỔNG THỂ (6 BƯỚC)

```
 [ BƯỚC 1: TIẾP NHẬN ĐA NGUỒN DỮ LIỆU ]
  ├── Tải tệp CSV (UTF-8, UTF-8 BOM, Windows-1258)
  ├── Tải tệp Excel đa bảng (.xlsx, .xls)
  └── Kết nối Link Google Sheets (Công khai)
                    │
                    ▼
 [ BƯỚC 2: CỔNG KIỂM ĐỊNH & LÀM SẠCH (GATEKEEPER) ]
  ├── Quét kiểu dữ liệu: Ngày tháng, Số tiền, Số lượng, Định danh
  ├── Phát hiện ô lỗi / khuyết thiếu theo tọa độ ô
  └── Cho phép chỉnh sửa trực tiếp trên bảng (Inline Editor)
                    │
                    ▼
 [ BƯỚC 3: THIẾT LẬP PHẠM VI TƯƠNG TÁC NGƯỜI ↔ AI ]
  ├── Tự động trích xuất File Profile (Kỳ thời gian, Phân loại, Chỉ số)
  ├── ✦ AI gợi ý câu hỏi thích ứng theo 3 góc nhìn dữ liệu (Không dập khuôn)
  └── 💬 Chat trực tiếp với AI để lọc nhóm, đổi kỳ, đặt mục tiêu định lượng
                    │
                    ▼
 [ BƯỚC 4: ĐỘNG CƠ PHÂN TÍCH ĐA HÌNH THÍCH ỨNG ]
  ├── Tự động nhận diện 5 ngữ cảnh: Hợp đồng, Bán lẻ, Ads, Leads, Tùy ý
  ├── Tính toán 4 thẻ KPI nghiệp vụ chuẩn xác 100%
  ├── Dựng 4 Visual Cards thích ứng (Trendline, Donut, Xếp hạng, Rà soát)
  └── Bộ não kép (Gemini Dual-Brain Failover ↔ Deterministic Local)
                    │
                    ▼
 [ BƯỚC 5: ĐỐI CHIẾU CHÉO & VÒNG LẶP TINH CHỈNH (VERIFY) ]
  ├── Kiểm chứng chéo: Tổng KPI đối chiếu với từng dòng chi tiết
  └── Human Feedback Loop: Nhập phản hồi để Agent tái tính toán tức thì
                    │
                    ▼
 [ BƯỚC 6: GIẢI ĐÁP TRỌNG TÂM & XUẤT BẢN BÁO CÁO ]
  ├── Khối Q&A từng dòng ngang: Giải đáp trực diện các câu hỏi đã trao đổi
  ├── Báo cáo 2 cột cân đối: Báo cáo kinh doanh + Tóm tắt điều hành (Brief)
  └── Xuất báo cáo HTML độc lập 1-Click (Mở offline không cần cài đặt)
```

---

## 3. CHI TIẾT 6 GIAI ĐOẠN NGHIỆP VỤ

### Giai đoạn 1: Tiếp nhận Đa nguồn Dữ liệu (Multi-Source Data Ingestion)
- **Hỗ trợ định dạng:** Tệp CSV, Excel nhiều sheet (`.xlsx`, `.xls`) hoặc đường dẫn Google Sheets công khai.
- **Xử lý mã hóa thông minh:** Tự động phát hiện và chuyển đổi chuẩn xác giữa các bảng mã tiếng Việt (UTF-8, UTF-8 BOM, Windows-1258) để không bị lỗi font chữ.
- **Tách dòng & tách cột linh hoạt:** Tự động phát hiện dấu phân cách (dấu phẩy `,`, chấm phẩy `;`, tab `\t`).

### Giai đoạn 2: Cổng Kiểm định Cấu trúc & Làm sạch (Schema & Validation Gate)
- **Kiểm định tiền khả thi (Gatekeeper Gate):** Quét toàn bộ tệp để phát hiện:
  - Cột bắt buộc còn thiếu.
  - Định dạng ngày tháng không chuẩn (`YYYY-MM-DD`, `DD/MM/YYYY`).
  - Số tiền, chi phí, số lượng bị nhập lẫn ký tự chữ hoặc số âm bất hợp lý.
  - Số điện thoại, email, mã số thuế sai quy chuẩn.
- **Giao diện sửa lỗi trực tiếp (Inline Data Editor):** Khi phát hiện lỗi, hệ thống không chỉ báo lỗi chung chung mà tô đỏ chính xác tọa độ ô lỗi, cho phép người dùng nhấp đúp vào ô để sửa trực tiếp ngay trên trình duyệt mà không cần phải mở lại Excel ngoài.

### Giai đoạn 3: Trao đổi Phạm vi Tương tác Người ↔ AI (Interactive AI Scope & Live Q&A)
- **Khởi tạo Hồ sơ Dữ liệu (`buildFileDataProfile`):** Hệ thống tự động phân tách cấu trúc tệp thành:
  - *Chỉ số số đo (Numeric Metrics):* Doanh thu, Lợi nhuận, Giá vốn, Số đơn, Ngân sách...
  - *Chiều phân loại (Categorical Dimensions):* Kênh bán lẻ, Khu vực, Sản phẩm, Chiến dịch...
  - *Trục thời gian (Temporal Periods):* Các tháng, các quý thực tế được ghi nhận trong tệp.
- **Nút "✦ Gợi ý câu hỏi mới từ file":** Tuyệt đối không dập khuôn câu hỏi mẫu cố định. Mỗi lần người dùng nhấp nút, AI sẽ tự động sinh các câu hỏi sâu gắn liền với dữ liệu thực tế theo 3 góc nhìn luân phiên:
  - *Góc nhìn 1 (Phạm vi & Chỉ số chủ lực):* Kênh/nhóm nào dẫn đầu về doanh thu? Xu hướng tăng/giảm qua các kỳ?
  - *Góc nhìn 2 (Rủi ro tập trung & Điểm nghẽn):* Nhóm nào sụt giảm mạnh nhất? Tỷ lệ ô khuyết thông tin có rủi ro gì?
  - *Góc nhìn 3 (Đối chiếu chéo & Mục tiêu định lượng):* Biên lợi nhuận chênh lệch ra sao? Để tăng trưởng +30% hoặc +50% thì phân khúc nào cần bứt phá?
- **💬 Khung Chat trao đổi trực tiếp Người ↔ AI:**
  - Người dùng có thể chat tự do: *"Chỉ xem tháng 09/2026"*, *"Ưu tiên chỉ số Lợi nhuận gộp"*, *"Lọc riêng kênh Website"*, *"Mục tiêu doanh thu 500 triệu"*.
  - AI hiểu ý định (Intent Recognition) và trích xuất thành bộ chỉ thị vận hành (`Directives`), đồng bộ trực tiếp xuống bộ máy phân tích.

### Giai đoạn 4: Động cơ Phân tích Đa hình Thích ứng (Polymorphic Adaptive Analytics Engine)
- **Tự động nhận diện 5 Ngữ cảnh Nghiệp vụ (Domain Contexts):**
  1. *Kinh doanh Bán lẻ & Thương mại điện tử (Retail / E-commerce):* Tự động ưu tiên Số đơn, Doanh thu, Giá vốn, Lợi nhuận gộp, Kênh bán, Khu vực.
  2. *Hợp đồng Dịch vụ & Phần mềm B2B (SaaS / Services):* Ưu tiên Giá trị hợp đồng, Kỳ thanh toán, Tiền thu trước, Trạng thái triển khai.
  3. *Tiếp thị số & Quảng cáo (Marketing / Ads):* Ưu tiên Lượt nhấp (Clicks), Lượt hiển thị (Impressions), Chi phí quảng cáo, Tỷ lệ chuyển đổi (CR / CTR).
  4. *Quản lý Khách hàng tiềm năng (CRM / Leads):* Ưu tiên Số lượng Lead, Điểm số tiềm năng, Tỷ lệ chuyển đổi, Kênh nguồn tiếp cận.
  5. *Bảng số liệu tổng hợp tùy ý (Custom Generic Data):* Tự động chọn 2 cột số lớn nhất và 2 cột phân nhóm đa dạng nhất để tạo báo cáo.
- **Trung thực dữ liệu tuyệt đối (Strict Data Truthfulness):** Chỉ tính toán và hiển thị các trường có thật trong tệp. Tuyệt đối không tự suy diễn số liệu và không hiển thị các thẻ rỗng `0 VND (Không có cột)`.
- **4 Visual Cards trực quan đa chiều:**
  - *Trendline:* Biểu đồ xu hướng biến động theo thời gian thực tế trong tệp.
  - *Donut Chart:* Cơ cấu tỷ trọng phân bổ của phân nhóm dẫn đầu.
  - *Horizontal Bar Chart:* Bảng xếp hạng đóng góp theo độ lớn giá trị.
  - *Variance & Data Audit Card:* Đánh giá độ biến động kỳ liền kề và tỷ lệ hoàn thiện dữ liệu.
- **Bộ não Kép (Dual-Brain Architecture):**
  - *Gemini Cloud LLM:* Phân tích ngữ nghĩa chuyên sâu, rút ra nhận định điều hành chiến lược sắc sảo.
  - *Deterministic Local Engine:* Bộ máy thuật toán toán học cục bộ chạy song song làm phương án dự phòng (Failover), đảm bảo hệ thống luôn trả kết quả ngay cả khi mất mạng internet hoặc hết hạn mức API.

### Giai đoạn 5: Đối chiếu Chéo & Vòng lặp Tinh chỉnh (Cross-Verification & Feedback Loop)
- **Kiểm chứng tính toàn vẹn (Integrity Verification):** Đối chiếu tổng các chỉ số KPI trên Dashboard với tổng các dòng chi tiết dữ liệu; kiểm tra các ca trùng lặp hoặc mâu thuẫn thời gian.
- **Vòng lặp Human-in-the-Loop:** Cho phép người dùng nhập phản hồi điều chỉnh (ví dụ: *"Cần siết chặt điều kiện trùng công ty"* hoặc *"So sánh với kịch bản tăng trưởng 20%"*) để AI lập tức cập nhật lại kết quả phân tích mà không phải nạp lại tệp từ đầu.

### Giai đoạn 6: Giải đáp Trực diện & Xuất Bản Báo Cáo (Targeted Q&A & Standalone Report)
- **Khối Giải đáp Trực diện Q&A (1 Hàng Ngang / Câu):**
  - Trả lời trực diện vào các câu hỏi mà người dùng và AI đã thống nhất ở Bước 3.
  - Bố cục từng dòng ngang độc lập, rộng rãi, dễ đọc, không bị chèn ép chữ.
  - Luôn đi kèm mục **Dẫn chứng số liệu cụ thể (`Evidence`)** lấy trực tiếp từ dữ liệu dòng để phục vụ kiểm chứng.
- **Báo cáo Điều hành 2 Cột Cân Đối:**
  - *Cột trái:* Báo cáo chi tiết số liệu, phân tích chiều phân loại, rủi ro và khuyến nghị hành động.
  - *Cột phải:* Bản Tóm tắt điều hành (Executive AI Brief) tinh gọn với các biểu tượng `+` (điểm sáng/thành quả) và `-` (cảnh báo/hành động cấp bách).
- **Xuất Báo cáo HTML Độc lập (1-Click Standalone Report):**
  - Xuất ra 1 tệp `.html` hoàn chỉnh duy nhất chứa toàn bộ số liệu, biểu đồ CSS và nhận định.
  - Có thể mở xem offline trên mọi trình duyệt, gửi qua email, Zalo, Teams cho ban lãnh đạo hoặc khách hàng mà không cần cài đặt phần mềm phụ trợ.

---

## 4. BẢNG SO SÁNH GIÁ TRỊ VƯỢT TRỘI

| Tiêu chí so sánh | Dashboard BI Truyền thống (Power BI / Excel) | Chatbot AI Thông thường (ChatGPT / Claude) | **Minh Hoàng AI Data Analyst** |
| :--- | :--- | :--- | :--- |
| **Tính linh hoạt dữ liệu** | Cứng nhắc, phải sửa Data Model khi đổi cấu trúc file | Linh hoạt nhưng dễ hiểu sai ngữ cảnh bảng số liệu | **Thích ứng đa hình tự động** theo 5 ngữ cảnh kinh doanh |
| **Độ tin cậy số liệu** | 100% chính xác nhưng không giải thích được lý do | Thường xuyên "bịa" số liệu hoặc cộng sai số | **100% chuẩn xác có dẫn chứng số liệu thực tế** |
| **Gợi ý câu hỏi nghiệp vụ** | Không có (người dùng tự dựng công thức) | Trả lời câu hỏi chung chung, không gắn số liệu file | **✦ Tự sinh câu hỏi sâu từ các cột và kỳ thực tế trong file** |
| **Đồng bộ Q&A ↔ Kết quả** | Không có | Rời rạc từng câu chat | **Hỏi gì đáp nấy ngay trên Dashboard và Báo cáo điều hành** |
| **Cài đặt & Triển khai** | Cài đặt phức tạp, chi phí bản quyền định kỳ | Phụ thuộc hoàn toàn vào kết nối đám mây | **Zero-Install (Chạy ngay trên Windows hoặc GitHub Pages)** |

---

## 5. HƯỚNG DẪN TRIỂN KHAI & CHIA SẺ

1. **Khởi chạy nội bộ trên máy tính (Localhost):**
   - Nhấn đúp chuột vào tệp `start.bat` (chạy trên cổng `http://localhost:8765`).
   - Hoặc chạy lệnh PowerShell: `powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8765`.
2. **Triển khai chia sẻ công khai qua GitHub Pages:**
   - Hệ thống được thiết kế dạng Single Page Application thuần (HTML5, Vanilla CSS3, Modern ES6 JavaScript).
   - Chỉ cần đẩy toàn bộ mã nguồn lên kho lưu trữ GitHub và bật tính năng GitHub Pages, liên kết web sẽ hoạt động ngay lập tức cho đối tác và khách hàng truy cập.

---
*Tài liệu được phát triển và chuẩn hóa bởi Minh Hoàng Software.*
