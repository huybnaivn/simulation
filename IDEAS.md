# Ý tưởng thí nghiệm

Danh sách các bài toán có thể làm thành mô phỏng tiếp theo. Tiêu chí chọn: luật chơi hiểu được trong vài giây, người xem tự tay thao tác được, và kết quả có điều bất ngờ.

## Đã làm

- Kim Buffon (`buffon/`)
- Bảng Galton (`galton/`)
- Stomachion của Archimedes (`stomachion/`)
- Sàng Eratosthenes (`eratosthenes/`)
- Bài toán Monty Hall (`montyhall/`)

## Chưa làm

| Bài toán | Người dùng làm gì | Điều bất ngờ rút ra |
|---|---|---|
| Nghịch lý ngày sinh | Kéo thanh số người trong phòng, xem ai trùng ngày sinh | Chỉ 23 người là xác suất trùng đã hơn 50% |
| Tháp Hà Nội | Kéo thả đĩa, có nút tự giải và đếm số bước | Số bước tối thiểu là 2ⁿ − 1, tăng rất nhanh |
| Trò chơi hỗn loạn (tam giác Sierpinski) | Bấm thả điểm ngẫu nhiên, mỗi lần nhảy nửa đường tới một đỉnh | Từ ngẫu nhiên thuần tuý hiện ra hình fractal |
| Giả thuyết Collatz (3n + 1) | Nhập một số, xem dãy nhảy lên xuống thành đồ thị | Số nào thử cũng về 1, nhưng chưa ai chứng minh được |
| Chứng minh Pythagoras bằng xếp hình | Kéo 4 tam giác vuông trong hình vuông lớn | Phần trống đổi từ c² thành a² + b² ngay trước mắt |
| Bảy cây cầu Königsberg | Vẽ đường đi qua các cầu, mỗi cầu một lần | Không thể đi được, và lý do nằm ở số bậc lẻ của đỉnh |
| Trò chơi Nim | Bốc sỏi đấu với máy | Máy thắng nhờ phép XOR mỗi khi thế cờ cho phép |

## Gợi ý thứ tự

- Cùng chủ đề xác suất với Buffon, Galton, Monty Hall: nghịch lý ngày sinh, trò chơi hỗn loạn.
- Thiên về kéo thả như Stomachion: Tháp Hà Nội, chứng minh Pythagoras.
- Thêm thí nghiệm mới: tạo thư mục riêng, rồi thêm một dòng vào `PAGES` trong `nav.js` và một mục vào `index.html`.
