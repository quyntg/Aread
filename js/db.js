// Lưu FileSystemDirectoryHandle trong IndexedDB.
const PdfDB = (() => {
	const DB_NAME = "pdf-book-reader";
	const STORE = "settings";

	function open() {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, 1);
			req.onupgradeneeded = () => req.result.createObjectStore(STORE);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
	async function set(key, value) {
		const db = await open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			tx.objectStore(STORE).put(value, key);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				db.close();
				reject(tx.error);
			};
		});
	}
	async function get(key) {
		const db = await open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly");
			const req = tx.objectStore(STORE).get(key);
			req.onsuccess = () => {
				db.close();
				resolve(req.result ?? null);
			};
			req.onerror = () => {
				db.close();
				reject(req.error);
			};
		});
	}
	return {
		set,
		get
	};
})();