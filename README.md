# PDF Book Reader Offline

Ứng dụng web (PWA) đọc PDF offline với hiệu ứng lật trang, thiết kế cho màn hình tương tác Android (landscape, cảm ứng).

## Cách hoạt động
- **Thêm PDF**: bấm "Thêm PDF" → "Chọn file PDF". File được chép vào bộ nhớ riêng của ứng dụng (IndexedDB), nên đọc offline được và không cần cấp quyền thư mục. (Không dùng `showDirectoryPicker()` vì Chrome Android không hỗ trợ.)
- **Đọc**: chỉ vẽ các trang gần trang đang xem (lười), nên PDF dài vẫn nhẹ RAM. Độ phân giải theo màn hình (tối đa DPR 2).
- **Tiến độ đọc** lưu theo từng tài liệu; hàng "Đọc tiếp" hiện các file đang đọc dở.
- **PDF có mật khẩu**: hỏi mật khẩu khi mở (mật khẩu không được lưu).
- **Xóa**: nút thùng rác trên mỗi tài liệu.

## Thư viện kèm theo (thư mục `vendor/`)
- `pdf.min.js`, `pdf.worker.min.js` — PDF.js 2.6.347 (giữ bản này cho tương thích Chrome/WebView đời cũ). Đã bật `isEvalSupported:false` để giảm rủi ro CVE-2024-4367. Nếu thiết bị có Chrome mới, nên nâng lên PDF.js ≥ 4.2.67.
- `page-flip.browser.js` — StPageFlip.

## Chạy thử / triển khai
1. Đưa cả thư mục lên hosting **HTTPS** (hoặc chạy `python3 -m http.server` rồi mở `http://localhost:8000` để thử).
2. Mở bằng Chrome khi có mạng, chờ service worker cache xong (lần đầu).
3. Chọn "Cài đặt ứng dụng" / "Thêm vào màn hình chính" nếu có.
4. Thêm PDF và đọc. Từ lần sau ứng dụng chạy hoàn toàn offline.

Khi sửa code, **tăng `CACHE_NAME`** trong `service-worker.js` để thiết bị cũ nhận bản mới.

## Giới hạn đã biết
- Dữ liệu nằm trong trình duyệt: xóa dữ liệu trang web/ứng dụng sẽ mất thư viện. Ứng dụng có xin chế độ lưu bền (`navigator.storage.persist()`), nhưng trình duyệt có thể từ chối.
- Chưa có: tìm chữ trong PDF, mục lục, đánh dấu trang, chọn/sao chép chữ.
- Phông chữ dùng phông hệ thống của thiết bị (không tải phông ngoài để giữ offline).
- Zoom làm lại độ phân giải trang theo mức phóng; ở mức 300% các trang rất lớn bị giới hạn ~9 triệu điểm ảnh/trang để tránh hết RAM.
