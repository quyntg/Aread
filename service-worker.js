// Tăng số version mỗi lần deploy để máy cũ tự bỏ cache cũ
const CACHE_NAME = "pdf-book-reader-v2";
const APP_SHELL = [
	"./", "./index.html", "./manifest.json", "./css/style.css",
	"./js/db.js", "./js/app.js", "./vendor/pdf.min.js",
	"./vendor/pdf.worker.min.js", "./vendor/page-flip.browser.js"
];

// Khi chạy local (live-server) thì không dùng cache để khỏi bị "dính" code cũ
const HOST = self.location.hostname;
const IS_DEV = ["localhost", "127.0.0.1", "10.0.2.2"].includes(HOST) || /^192\.168\./.test(HOST);

self.addEventListener("install", event => {
	self.skipWaiting();
	if (IS_DEV) return;
	event.waitUntil(caches.open(CACHE_NAME).then(cache =>
		cache.addAll(APP_SHELL).catch(error => console.warn("Chưa cache đủ thư viện:", error))
	));
});

self.addEventListener("activate", event => {
	event.waitUntil((async () => {
		// Xoá cache cũ (khác version hiện tại; khi dev thì xoá hết)
		const keys = await caches.keys();
		await Promise.all(keys.filter(k => IS_DEV || k !== CACHE_NAME).map(k => caches.delete(k)));
		await self.clients.claim();
	})());
});

self.addEventListener("fetch", event => {
	const req = event.request;
	if (req.method !== "GET" || IS_DEV) return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return; // không đụng tới request khác domain

	// Thư viện trong /vendor/ ít đổi và nặng: ưu tiên cache cho nhanh (đổi version để làm mới)
	const isVendor = url.pathname.includes("/vendor/");

	event.respondWith((async () => {
		if (isVendor) {
			const cached = await caches.match(req);
			if (cached) return cached;
		}
		try {
			// Network-first: luôn lấy bản mới nhất, bỏ qua cache HTTP của trình duyệt
			const response = await fetch(req, {
				cache: "no-cache"
			});
			if (response.ok && response.status === 200) {
				const copy = response.clone();
				caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
			}
			return response;
		} catch {
			// Mất mạng: dùng bản đã lưu
			const cached = await caches.match(req);
			if (cached) return cached;
			return new Response("Tài nguyên chưa được cache và hiện không có mạng.", {
				status: 503,
				headers: {
					"Content-Type": "text/plain; charset=utf-8"
				}
			});
		}
	})());
});