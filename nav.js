// Thanh bên dùng chung cho mọi trang. Thêm thí nghiệm mới thì chỉ cần thêm một dòng vào PAGES.
// Cách dùng: đặt <script src="…/nav.js"></script> bên trong <header>; thẻ script được thay bằng <nav>.
(() => {
  'use strict';
  const PAGES = [
    ['index.html', 'Trang chủ'],
    ['buffon/index.html', 'Kim Buffon'],
    ['galton/index.html', 'Bảng Galton'],
    ['stomachion/index.html', 'Stomachion'],
    ['eratosthenes/index.html', 'Sàng Eratosthenes'],
  ];

  const script = document.currentScript;
  const root = new URL('.', script.src);                 // thư mục chứa nav.js = gốc của trang web
  const here = location.pathname.replace(/\/$/, '/index.html');

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Thí nghiệm');
  for (const [path, label] of PAGES) {
    const url = new URL(path, root);
    const a = document.createElement('a');
    a.href = url.href;
    a.textContent = label;
    if (url.pathname === here) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  script.replaceWith(nav);
})();
