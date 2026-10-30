const $ = (s) => document.querySelector(s);
const state = {
	folder: null,
	files: [],
	pdf: null,
	flip: null,
	currentFile: null
};

function status(message) {
	$("#status").textContent = message;
}

function formatBytes(bytes) {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function chooseFolder() {
	if (!("showDirectoryPicker" in window)) {
		status("Chrome/thiết bị này chưa hỗ trợ chọn thư mục trực tiếp. Hãy thử Chrome mới hơn.");
		alert("Trình duyệt chưa hỗ trợ showDirectoryPicker().");
		return;
	}
	try {
		state.folder = await window.showDirectoryPicker({
			id: "pdf-library",
			mode: "read"
		});
		await PdfDB.set("folderHandle", state.folder);
		const permission = await state.folder.queryPermission({
			mode: "read"
		});
		if (permission !== "granted") {
			$("#permissionBtn").hidden = false;
			status("Đã lưu thư mục, nhưng cần cấp quyền đọc.");
			return;
		}
		await refreshFiles();
	} catch (error) {
		if (error.name !== "AbortError") {
			console.error(error);
			status("Không chọn được thư mục: " + error.message);
		}
	}
}

async function requestFolderPermission() {
	if (!state.folder) return chooseFolder();
	try {
		const permission = await state.folder.requestPermission({
			mode: "read"
		});
		if (permission === "granted") await refreshFiles();
		else status("Chưa được cấp quyền. Hãy chọn lại thư mục.");
	} catch (error) {
		console.error(error);
		status("Không thể xác nhận quyền. Hãy chọn lại thư mục.");
	}
}

async function refreshFiles() {
	if (!state.folder) return;
	if (await state.folder.queryPermission({
			mode: "read"
		}) !== "granted") {
		$("#permissionBtn").hidden = false;
		status("Cần cấp quyền đọc thư mục. Bấm “Cấp lại quyền đọc thư mục”.");
		return;
	}
	const files = [];
	try {
		for await (const entry of state.folder.values()) {
			if (entry.kind === "file" && /\.pdf$/i.test(entry.name)) {
				const file = await entry.getFile();
				files.push({
					handle: entry,
					name: entry.name,
					size: file.size
				});
			}
		}
	} catch (error) {
		console.error(error);
		status("Không đọc được thư mục. Hãy cấp lại quyền hoặc chọn thư mục khác.");
		$("#permissionBtn").hidden = false;
		return;
	}
	files.sort((a, b) => a.name.localeCompare(b.name, "vi"));
	state.files = files;
	$("#permissionBtn").hidden = true;
	status(`Tìm thấy ${files.length} file PDF.`);
	renderFileList();
}

function renderFileList() {
	const container = $("#pdfList");
	container.replaceChildren();
	if (!state.files.length) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "Không tìm thấy PDF. Hãy chép file vào thư mục rồi bấm Làm mới.";
		container.append(empty);
		return;
	}
	for (const item of state.files) {
		const button = document.createElement("button");
		button.className = "pdf-card";
		const icon = document.createElement("span");
		icon.textContent = "📄 PDF";
		const title = document.createElement("strong");
		title.textContent = item.name;
		const meta = document.createElement("small");
		meta.textContent = formatBytes(item.size);
		button.append(icon, title, meta);
		button.addEventListener("click", () => openPdf(item));
		container.append(button);
	}
}

async function openPdf(item) {
	if (!window.pdfjsLib || !window.St?.PageFlip) {
		alert("Thiếu thư viện offline. Xem README.md để tải thư viện vào vendor/.");
		return;
	}
	$("#libraryView").hidden = true;
	$("#readerView").hidden = false;
	$("#loading").hidden = false;
	$("#currentTitle").textContent = item.name;
	state.currentFile = item;
	destroyFlipbook();
	try {
		const file = await item.handle.getFile();
		state.pdf = await pdfjsLib.getDocument({
			data: await file.arrayBuffer()
		}).promise;
		await buildFlipbook(state.pdf);
		const savedPage = await PdfDB.get("lastPage:" + item.name);
		if (savedPage != null && state.flip) state.flip.turnToPage(Math.min(savedPage, state.pdf.numPages - 1));
		updatePageInfo();
	} catch (error) {
		console.error(error);
		alert("Không mở được PDF: " + error.message);
		showLibrary();
	} finally {
		$("#loading").hidden = true;
	}
}

async function buildFlipbook(pdf) {
	const book = ensureBook();
	book.replaceChildren();
	const pageElements = [];
	// Demo đơn giản: render toàn bộ trang; PDF dài cần render lười để giảm RAM.
	for (let n = 1; n <= pdf.numPages; n++) {
		const page = await pdf.getPage(n);
		const viewport = page.getViewport({
			scale: 1.0
		});
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		await page.render({
			canvasContext: canvas.getContext("2d", {
				alpha: false
			}),
			viewport
		}).promise;
		const wrapper = document.createElement("div");
		wrapper.className = "page";
		wrapper.append(canvas);
		pageElements.push(wrapper);
	}
	const width = pageElements[0]?.querySelector("canvas").width || 500;
	const height = pageElements[0]?.querySelector("canvas").height || 700;
	state.flip = new St.PageFlip(book, {
		width,
		height,
		size: "stretch",
		minWidth: 240,
		maxWidth: 1200,
		minHeight: 300,
		maxHeight: 1600,
		showCover: true,
		usePortrait: false,
		mobileScrollSupport: false,
		maxShadowOpacity: 0.35,
		flippingTime: 650
	});
	state.flip.loadFromHTML(pageElements);
	state.flip.on("flip", async () => {
		updatePageInfo();
		if (state.currentFile) await PdfDB.set("lastPage:" + state.currentFile.name, state.flip.getCurrentPageIndex());
	});
}

function updatePageInfo() {
	if (!state.flip || !state.pdf) return;
	const current = state.flip.getCurrentPageIndex();
	$("#pageInfo").textContent = `Trang ${current + 1} / ${state.pdf.numPages}`;
	$("#pageInput").value = current + 1;
	$("#prevBtn").disabled = current <= 0;
	$("#nextBtn").disabled = current >= state.pdf.numPages - 1;
}

function destroyFlipbook() {
	if (state.flip) {
		try {
			state.flip.destroy();
		} catch (e) {
			console.warn(e);
		}
	}
	state.flip = null;
	ensureBook().replaceChildren();
}

// StPageFlip.destroy() gỡ luôn phần tử #book khỏi DOM nên cần tạo lại
function ensureBook() {
	let book = $("#book");
	if (!book) {
		book = document.createElement("div");
		book.id = "book";
		book.className = "book";
		$(".book-stage").prepend(book);
	}
	return book;
}

function showLibrary() {
	$("#readerView").hidden = true;
	$("#libraryView").hidden = false;
	destroyFlipbook();
	state.pdf = null;
	state.currentFile = null;
}

function goToPage() {
	if (!state.flip || !state.pdf) return;
	const page = Number.parseInt($("#pageInput").value, 10);
	if (Number.isFinite(page)) state.flip.turnToPage(Math.max(0, Math.min(state.pdf.numPages - 1, page - 1)));
	updatePageInfo();
}

$("#chooseFolderBtn").addEventListener("click", chooseFolder);
$("#permissionBtn").addEventListener("click", requestFolderPermission);
$("#refreshBtn").addEventListener("click", refreshFiles);
$("#backBtn").addEventListener("click", showLibrary);
$("#prevBtn").addEventListener("click", () => state.flip?.flipPrev());
$("#nextBtn").addEventListener("click", () => state.flip?.flipNext());
$("#goPageBtn").addEventListener("click", goToPage);
$("#pageInput").addEventListener("keydown", e => {
	if (e.key === "Enter") goToPage();
});
$("#fullscreenBtn").addEventListener("click", async () => {
	try {
		if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
		else await document.exitFullscreen();
	} catch {
		alert("Trình duyệt không cho phép toàn màn hình ở chế độ hiện tại.");
	}
});

async function init() {
	if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
	try {
		state.folder = await PdfDB.get("folderHandle");
		if (state.folder) {
			if (await state.folder.queryPermission({
					mode: "read"
				}) === "granted") await refreshFiles();
			else {
				status("Đã tìm thấy thư mục đã lưu nhưng cần cấp lại quyền.");
				$("#permissionBtn").hidden = false;
			}
		}
	} catch (error) {
		console.warn(error);
	}
}
init();