# PDF Book Reader Offline — Demo HTML/CSS/JS

## Cần bổ sung thư viện (không được đóng gói sẵn)
Tải bản build trình duyệt của các thư viện và đặt đúng tên:
- `vendor/pdf.min.js`
- `vendor/pdf.worker.min.js`
- `vendor/page-flip.browser.js`

Nguồn chính thức:
- PDF.js: https://github.com/mozilla/pdf.js/releases
- StPageFlip: https://github.com/Nodlik/StPageFlip/releases

Dùng bản browser build phù hợp. Nếu tên file trong bản tải về khác, đổi tên file hoặc sửa đường dẫn trong `index.html`, `js/app.js`, `service-worker.js`.

## Chạy thử
1. Tải đủ thư viện vào `vendor/`.
2. Đưa thư mục project lên hosting HTTPS (hoặc chạy qua localhost trên máy tính để phát triển).
3. Mở URL bằng Chrome khi đang có mạng, chờ tải xong tài nguyên và service worker cache.
4. Chọn Install app / Add to Home screen.
5. Mở ứng dụng, chọn thư mục PDF và cấp quyền nếu được hỏi.
6. Chép thêm PDF vào thư mục rồi bấm **Làm mới**.

## Giới hạn
- `showDirectoryPicker()` không có mặt trên mọi bản Chrome Android/thiết bị. Cần thử trên máy đích.
- IndexedDB lưu handle, không bảo đảm quyền truy cập vĩnh viễn. Có thể phải cấp lại quyền.
- Service worker cache ứng dụng, không tự cache các PDF trong thư mục người dùng.
- Demo render toàn bộ trang thành canvas trước khi tạo sách, không tối ưu cho PDF nhiều trang/dung lượng lớn.
- `orientation: landscape` chỉ là gợi ý cho trình cài đặt; không bảo đảm khóa xoay trên mọi launcher.
- Cần mở ứng dụng lần đầu khi có mạng để cache các tài nguyên.
