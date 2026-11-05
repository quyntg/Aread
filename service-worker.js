// Không cần tăng số version mỗi lần sửa code nữa: file ứng dụng luôn được lấy bản mới
// khi có mạng (network-first), chỉ dùng bản lưu khi mất mạng hoặc mạng quá chậm.
// Chỉ tăng CACHE_NAME khi muốn xóa sạch bản lưu cũ.
const CACHE_NAME = "pdf-book-reader-shell";
const NETWORK_TIMEOUT_MS = 4000;
const APP_SHELL = [
	"./", "./index.html", "./manifest.json", "./css/style.css",
	"./js/db.js", "./js/app.js",
	"./vendor/pdf.min.js", "./vendor/pdf.worker.min.js", "./vendor/page-flip.browser.js",
	"./icons/icon-192.png", "./icons/icon-512.png"
];

// Chạy local (live-server) thì không cache để khỏi bị "dính" code cũ.
const IS_DEV = ["localhost", "127.0.0.1", "10.0.2.2"].includes(self.location.hostname);

self.addEventListener("install", event => {
	self.skipWaiting(); // bản mới nhận quyền ngay, không chờ đóng hết tab
	if (IS_DEV) return;
	// Không nuốt lỗi: thiếu một file thì cài đặt thất bại và sẽ thử lại lần sau.
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL.map(u => new Request(u, { cache: "reload" }))))
	);
});

self.addEventListener("activate", event => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(keys.filter(k => IS_DEV || k !== CACHE_NAME).map(k => caches.delete(k)));
		await self.clients.claim();
	})());
});

self.addEventListener("fetch", event => {
	const req = event.request;
	if (req.method !== "GET" || IS_DEV) return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	// Thư viện nặng, hầu như không đổi: ưu tiên bản lưu cho nhanh (đổi tên file khi nâng cấp).
	const isHeavyStatic = /\/vendor\/|\/icons\//.test(url.pathname);

	event.respondWith((async () => {
		const cache = await caches.open(CACHE_NAME);
		const cached = await cache.match(req, { ignoreSearch: true });
		if (isHeavyStatic && cached) return cached;

		// Bỏ qua cache HTTP của trình duyệt/hosting để chắc chắn lấy bản mới nhất.
		const network = fetch(req, { cache: "no-cache" }).then(res => {
			if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
			return res;
		});

		if (!cached) {
			try {
				return await network;
			} catch {
				if (req.mode === "navigate") {
					const shell = await cache.match("./index.html");
					if (shell) return shell;
				}
				return new Response("Chưa có bản lưu và hiện không có mạng.", {
					status: 503,
					headers: { "Content-Type": "text/plain; charset=utf-8" }
				});
			}
		}

		// Có bản lưu: chờ mạng tối đa vài giây; quá hạn hoặc lỗi thì dùng bản lưu,
		// mạng vẫn tiếp tục chạy nền để cập nhật cho lần sau.
		const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
		event.waitUntil(network.catch(() => {}));
		try {
			const res = await Promise.race([network, timeout]);
			return res || cached;
		} catch {
			return cached;
		}
	})());
});
