// Kho tài liệu trong IndexedDB: metadata ("docs") tách khỏi nội dung PDF ("blobs")
// để liệt kê thư viện nhanh và không phải nạp file nặng.
const Store = (() => {
	const DB_NAME = "pdf-book-reader-v2";
	let dbPromise = null;

	function open() {
		if (!dbPromise) {
			dbPromise = new Promise((resolve, reject) => {
				const req = indexedDB.open(DB_NAME, 1);
				req.onupgradeneeded = () => {
					const db = req.result;
					db.createObjectStore("docs", { keyPath: "id" });
					db.createObjectStore("blobs");
				};
				req.onsuccess = () => {
					const db = req.result;
					db.onversionchange = () => { db.close(); dbPromise = null; };
					resolve(db);
				};
				req.onerror = () => { dbPromise = null; reject(req.error); };
				req.onblocked = () => { dbPromise = null; reject(new Error("IndexedDB bị chặn")); };
			});
		}
		return dbPromise;
	}

	// Chạy fn(stores) trong một transaction; resolve khi transaction hoàn tất.
	async function run(names, mode, fn) {
		const db = await open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(names, mode);
			let result;
			tx.oncomplete = () => resolve(result);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error || new Error("Giao dịch bị hủy"));
			try {
				const out = fn(names.length === 1 ? tx.objectStore(names[0]) : Object.fromEntries(names.map(n => [n, tx.objectStore(n)])), tx);
				if (out && typeof out.then !== "function") result = out;
				else if (out) out.then(v => { result = v; }, err => { try { tx.abort(); } catch {} reject(err); });
			} catch (err) {
				try { tx.abort(); } catch {}
				reject(err);
			}
		});
	}

	function req(r) {
		return new Promise((resolve, reject) => {
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	}

	return {
		async listDocs() {
			const db = await open();
			return req(db.transaction("docs", "readonly").objectStore("docs").getAll());
		},
		async getDoc(id) {
			const db = await open();
			return (await req(db.transaction("docs", "readonly").objectStore("docs").get(id))) || null;
		},
		async getFile(id) {
			const db = await open();
			return (await req(db.transaction("blobs", "readonly").objectStore("blobs").get(id))) || null;
		},
		// Ghi metadata và file trong cùng một transaction để không bao giờ có bản ghi mồ côi.
		addDoc(doc, blob) {
			return run(["docs", "blobs"], "readwrite", s => {
				s.docs.put(doc);
				s.blobs.put(blob, doc.id);
			});
		},
		// Đọc-sửa-ghi trong một transaction.
		updateDoc(id, patch) {
			return run(["docs"], "readwrite", store => new Promise((resolve, reject) => {
				const g = store.get(id);
				g.onsuccess = () => {
					if (!g.result) return resolve(null);
					const next = Object.assign({}, g.result, patch);
					const p = store.put(next);
					p.onsuccess = () => resolve(next);
					p.onerror = () => reject(p.error);
				};
				g.onerror = () => reject(g.error);
			}));
		},
		deleteDoc(id) {
			return run(["docs", "blobs"], "readwrite", s => {
				s.docs.delete(id);
				s.blobs.delete(id);
			});
		},
		async estimate() {
			try {
				if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
			} catch {}
			return null;
		},
		async persist() {
			try {
				if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
			} catch {}
			return false;
		}
	};
})();
