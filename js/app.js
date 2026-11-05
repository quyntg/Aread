"use strict";
const $ = (s) => document.querySelector(s);

const state = {
    docs: [],
    sort: "recent",
    query: "",
    thumbUrls: [],
};

/* ---------- Tiện ích ---------- */

function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1,
    );
    return (
        (bytes / 1024 ** i).toFixed(i > 1 ? 1 : 0).replace(".", ",") +
        " " +
        units[i]
    );
}

function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function normalize(s) {
    return String(s)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d");
}

function titleOf(name) {
    return name.replace(/\.pdf$/i, "");
}

let toastTimer = 0;
function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.hidden = true;
    }, 4000);
}

function showView(name) {
    for (const v of ["library", "import", "reader"])
        $("#" + v + "View").hidden = v !== name;
}

// Không để một bước treo (ví dụ toBlob trên WebView cũ) làm kẹt cả hàng đợi.
function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Hết thời gian chờ")), ms);
        promise.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            },
        );
    });
}

function debounce(fn, ms) {
    let t = 0;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

/* Hộp thoại dùng chung: trả về chuỗi (có ô nhập), true (xác nhận) hoặc null (hủy). */
function askModal({ title, text, input, okLabel = "OK", danger = false }) {
    return new Promise((resolve) => {
        const modal = $("#modal"),
            field = $("#modalInput"),
            ok = $("#modalOk"),
            cancel = $("#modalCancel");
        $("#modalTitle").textContent = title;
        $("#modalText").textContent = text || "";
        field.hidden = !input;
        field.value = "";
        ok.textContent = okLabel;
        ok.className = "btn " + (danger ? "danger" : "primary");
        modal.hidden = false;
        if (input) setTimeout(() => field.focus(), 30);
        const done = (value) => {
            modal.hidden = true;
            ok.onclick =
                cancel.onclick =
                modal.onclick =
                field.onkeydown =
                    null;
            resolve(value);
        };
        ok.onclick = () => done(input ? field.value : true);
        cancel.onclick = () => done(null);
        modal.onclick = (e) => {
            if (e.target === modal) done(null);
        };
        field.onkeydown = (e) => {
            if (e.key === "Enter") ok.click();
        };
    });
}

/* ---------- PDF ---------- */

const COVERS = [
    "#3B5B8C",
    "#8C4B3B",
    "#3E7A62",
    "#7A5C9C",
    "#A07B2E",
    "#4C6C7A",
];
function coverColor(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COVERS[h % COVERS.length];
}

// Mở PDF từ Blob. Nếu file có mật khẩu và interactive=true thì hỏi người dùng.
async function loadPdf(blob, label, interactive) {
    let password;
    let wrong = false;
    for (;;) {
        // Đọc lại dữ liệu mỗi lần thử, phòng khi pdf.js chiếm quyền buffer.
        const data = new Uint8Array(await blob.arrayBuffer());
        try {
            return await pdfjsLib.getDocument({
                data,
                password,
                isEvalSupported: false, // chặn thực thi mã trong font độc hại
            }).promise;
        } catch (err) {
            if (!err || err.name !== "PasswordException") throw err;
            if (!interactive) throw err;
            const answer = await askModal({
                title: wrong ? "Mật khẩu chưa đúng" : "File này cần mật khẩu",
                text: label,
                input: true,
                okLabel: "Mở",
            });
            if (answer == null) {
                const e = new Error("cancelled");
                e.cancelled = true;
                throw e;
            }
            password = answer;
            wrong = true;
        }
    }
}

async function makeThumb(pdf) {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 300 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport,
    }).promise;
    const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    canvas.width = canvas.height = 0;
    page.cleanup();
    return blob;
}

/* ---------- Thư viện ---------- */

async function reloadDocs() {
    try {
        state.docs = await Store.listDocs();
    } catch (err) {
        console.error(err);
        state.docs = [];
        toast("Không đọc được kho tài liệu: " + err.message);
    }
    renderLibrary();
}

function docProgress(doc) {
    if (!doc.pages || doc.pages < 2 || !doc.lastPage) return 0;
    return Math.min(100, ((doc.lastPage + 1) / doc.pages) * 100);
}

function metaText(doc) {
    return (doc.pages ? doc.pages + " trang · " : "") + formatBytes(doc.size);
}

function coverEl(doc) {
    const cover = document.createElement("div");
    cover.className = "cover";
    if (doc.thumb) {
        const url = URL.createObjectURL(doc.thumb);
        state.thumbUrls.push(url);
        const img = document.createElement("img");
        img.alt = "";
        img.src = url;
        cover.append(img);
    } else {
        cover.style.background = coverColor(doc.id);
        for (const c of ["l1", "l2", "shade"]) {
            const d = document.createElement("div");
            d.className = c;
            cover.append(d);
        }
    }
    return cover;
}

function docCard(doc, big) {
    const card = document.createElement("div");
    card.className = "doc-card " + (big ? "big" : "small");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "doc-open";
    open.addEventListener("click", () => openDoc(doc.id));

    const info = document.createElement("div");
    info.className = "doc-info";
    const top = document.createElement("div");
    const name = document.createElement("div");
    name.className = "doc-name";
    name.textContent = doc.title || titleOf(doc.name);
    const meta = document.createElement("div");
    meta.className = "doc-meta";
    meta.textContent = metaText(doc);
    top.append(name, meta);
    info.append(top);

    const pct = docProgress(doc);
    const bottom = document.createElement("div");
    if (big) {
        const resume = document.createElement("div");
        resume.className = "resume";
        resume.textContent = `Trang ${doc.lastPage + 1} / ${doc.pages}`;
        bottom.append(resume);
    }
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = pct + "%";
    track.append(fill);
    bottom.append(track);
    info.append(bottom);

    open.append(coverEl(doc), info);
    card.append(open);

    if (!big) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "doc-del";
        del.setAttribute("aria-label", "Xóa " + (doc.title || doc.name));
        del.innerHTML =
            '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>';
        del.addEventListener("click", () => deleteDoc(doc));
        card.append(del);
    }
    return card;
}

function renderLibrary() {
    for (const url of state.thumbUrls) URL.revokeObjectURL(url);
    state.thumbUrls = [];

    const q = normalize(state.query.trim());
    let list = state.docs.filter((d) => !q || normalize(d.name).includes(q));
    const sorters = {
        recent: (a, b) =>
            (b.lastOpened || b.addedAt || 0) - (a.lastOpened || a.addedAt || 0),
        name: (a, b) => a.name.localeCompare(b.name, "vi"),
        size: (a, b) => b.size - a.size,
    };
    list = list.slice().sort(sorters[state.sort]);

    // Hàng "Đọc tiếp": đã đọc dở, chưa hết, mới mở gần đây nhất
    const resume = state.docs
        .filter(
            (d) =>
                d.lastPage > 0 &&
                d.pages &&
                d.lastPage < d.pages - 1 &&
                d.lastOpened,
        )
        .sort((a, b) => b.lastOpened - a.lastOpened)
        .slice(0, 3);
    const cs = $("#continueSection");
    cs.hidden = !resume.length || !!q;
    const cl = $("#continueList");
    cl.replaceChildren(...resume.map((d) => docCard(d, true)));

    $("#countLabel").textContent = list.length + " file";
    const grid = $("#docGrid");
    grid.replaceChildren(...list.map((d) => docCard(d, false)));

    const empty = $("#emptyBox");
    empty.hidden = list.length > 0;
    if (!list.length) {
        empty.replaceChildren();
        const msg = document.createElement("div");
        msg.textContent = state.docs.length
            ? "Không có tài liệu nào khớp với tìm kiếm."
            : "Thư viện đang trống. Hãy thêm file PDF để bắt đầu đọc.";
        empty.append(msg);
        if (!state.docs.length) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn primary";
            btn.textContent = "Thêm PDF";
            btn.addEventListener("click", openImport);
            empty.append(btn);
        }
    }
}

async function deleteDoc(doc) {
    const ok = await askModal({
        title: "Xóa tài liệu?",
        text: `“${doc.title || doc.name}” sẽ bị xóa khỏi thiết bị này. File gốc ở nơi khác không bị ảnh hưởng.`,
        okLabel: "Xóa",
        danger: true,
    });
    if (!ok) return;
    try {
        await Store.deleteDoc(doc.id);
        await reloadDocs();
        toast("Đã xóa tài liệu.");
    } catch (err) {
        console.error(err);
        toast("Không xóa được: " + err.message);
    }
}

$("#searchInput").addEventListener(
    "input",
    debounce((e) => {
        state.query = e.target.value;
        renderLibrary();
    }, 150),
);

for (const chip of document.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => {
        state.sort = chip.dataset.sort;
        for (const c of document.querySelectorAll(".chip")) {
            const on = c === chip;
            c.classList.toggle("is-on", on);
            c.setAttribute("aria-pressed", String(on));
        }
        renderLibrary();
    });
}

/* ---------- Thêm tài liệu ---------- */

const imp = { items: [], running: false };

const ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
    work: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path>',
    wait: '<path d="M7 3h7l5 5v13H7z"></path><path d="M14 3v5h5"></path>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
    error: '<path d="M12 7v6M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle>',
};

function openImport() {
    showView("import");
    renderQueue();
    refreshStorage();
}

function leaveImport() {
    imp.items = imp.items.filter(
        (i) => i.state === "work" || i.state === "wait",
    );
    showView("library");
    reloadDocs(); // luôn nạp lại danh sách khi về thư viện, kể cả khi hàng đợi chưa chạy xong
}

async function refreshStorage() {
    const est = await Store.estimate();
    const panel = $("#storagePanel");
    if (!est || !est.quota) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
    const used = est.usage || 0;
    $("#storageText").textContent =
        `Đã dùng ${formatBytes(used)} · còn trống ${formatBytes(Math.max(0, est.quota - used))}`;
    $("#storageFill").style.width =
        Math.max(1, Math.min(100, (used / est.quota) * 100)) + "%";
    $("#storageNote").textContent =
        `${state.docs.length} tài liệu trong thư viện. Xóa tài liệu để lấy lại dung lượng.`;
}

function renderQueue() {
    const list = $("#queueList");
    if (!imp.items.length) {
        const e = document.createElement("div");
        e.className = "queue-empty";
        e.textContent = "Chưa có file nào. Bấm “Chọn file PDF” để bắt đầu.";
        list.replaceChildren(e);
        return;
    }
    list.replaceChildren(
        ...imp.items.map((item) => {
            const row = document.createElement("div");
            row.className = "qrow " + item.state;
            const icon = document.createElement("div");
            icon.className = "qicon";
            const iconKey = {
                done: "check",
                work: "work",
                wait: "wait",
                locked: "lock",
                error: "error",
            }[item.state];
            icon.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[iconKey]}</svg>`;
            const main = document.createElement("div");
            main.className = "qmain";
            const name = document.createElement("div");
            name.className = "qname";
            name.textContent = item.name;
            main.append(name);
            if (item.state === "work") {
                const track = document.createElement("div");
                track.className = "bar-track";
                const fill = document.createElement("div");
                fill.className = "bar-fill";
                fill.style.width = item.pct + "%";
                track.append(fill);
                main.append(track);
            } else {
                const sub = document.createElement("div");
                sub.className = "qsub";
                sub.textContent = item.msg || formatBytes(item.size);
                main.append(sub);
            }
            row.append(icon, main);
            if (item.state === "locked") {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "qbtn";
                btn.textContent = "Nhập mật khẩu";
                btn.addEventListener("click", () => unlockItem(item));
                row.append(btn);
            } else {
                const st = document.createElement("div");
                st.className = "qstatus";
                st.textContent =
                    {
                        done: "Đã xong",
                        work: item.pct + "%",
                        wait: "Đang chờ",
                        error: "Lỗi",
                    }[item.state] || "";
                row.append(st);
            }
            return row;
        }),
    );
}

function enqueue(files) {
    for (const file of files) {
        const isPdf =
            /\.pdf$/i.test(file.name) || file.type === "application/pdf";
        imp.items.push({
            id: uid(),
            file,
            name: file.name,
            size: file.size,
            state: isPdf ? "wait" : "error",
            msg: isPdf ? "" : "Không phải file PDF",
            pct: 0,
        });
    }
    renderQueue();
    processQueue();
}

async function processQueue() {
    if (imp.running) return;
    imp.running = true;
    try {
        for (;;) {
            const item = imp.items.find((i) => i.state === "wait");
            if (!item) break;
            item.state = "work";
            item.pct = 10;
            renderQueue();
            await importOne(item);
            renderQueue();
            renderLibrary(); // cập nhật thư viện ngay sau từng file, không chờ cả hàng đợi
        }
    } finally {
        imp.running = false;
        await reloadDocs();
        refreshStorage();
    }
}

function newDoc(item, extra) {
    return Object.assign(
        {
            id: item.id,
            name: item.name,
            title: titleOf(item.name),
            size: item.size,
            pages: 0,
            addedAt: Date.now(),
            lastOpened: null,
            lastPage: 0,
            thumb: null,
            locked: false,
        },
        extra,
    );
}

async function importOne(item) {
    if (state.docs.some((d) => d.name === item.name && d.size === item.size)) {
        item.state = "error";
        item.msg = "Đã có trong thư viện";
        return;
    }
    let pdf = null;
    try {
        item.pct = 20;
        renderQueue();
        try {
            pdf = await loadPdf(item.file, item.name, false);
        } catch (err) {
            if (err && err.name === "PasswordException") {
                await Store.addDoc(newDoc(item, { locked: true }), item.file);
                state.docs = await Store.listDocs();
                item.state = "locked";
                item.msg = "Cần mật khẩu để tạo ảnh bìa";
                return;
            }
            throw err;
        }
        item.pct = 55;
        renderQueue();
        let thumb = null;
        try {
            thumb = await withTimeout(makeThumb(pdf), 20000);
        } catch (err) {
            console.warn("Không tạo được ảnh bìa", err);
        }
        item.pct = 85;
        renderQueue();
        const doc = newDoc(item, { pages: pdf.numPages, thumb });
        await Store.addDoc(doc, item.file);
        state.docs.push(doc);
        item.pages = doc.pages;
        item.state = "done";
        item.msg = metaText(doc);
    } catch (err) {
        console.error(err);
        item.state = "error";
        item.msg =
            err && err.name === "QuotaExceededError"
                ? "Hết dung lượng. Hãy xóa bớt tài liệu."
                : "Không đọc được file PDF";
    } finally {
        if (pdf) pdf.destroy();
    }
}

async function finalizeMeta(id, pdf) {
    let thumb = null;
    try {
        thumb = await makeThumb(pdf);
    } catch (err) {
        console.warn(err);
    }
    return Store.updateDoc(id, { pages: pdf.numPages, thumb, locked: false });
}

async function unlockItem(item) {
    let pdf = null;
    try {
        pdf = await loadPdf(item.file, item.name, true);
        const doc = await finalizeMeta(item.id, pdf);
        item.state = "done";
        item.msg = doc ? metaText(doc) : "";
        state.docs = await Store.listDocs();
        renderLibrary();
    } catch (err) {
        if (!err.cancelled) {
            console.error(err);
            toast("Không mở được file này.");
        }
    } finally {
        if (pdf) pdf.destroy();
        renderQueue();
    }
}

$("#addBtn").addEventListener("click", openImport);
$("#importBack").addEventListener("click", leaveImport);
$("#doneImport").addEventListener("click", leaveImport);
$("#cancelImport").addEventListener("click", () => {
    imp.items = imp.items.filter((i) => i.state !== "wait"); // file đang chép dở vẫn được hoàn tất
    leaveImport();
});
$("#pickBtn").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) enqueue(files);
});

/* ---------- Đọc sách ---------- */

const R = {
    token: 0, // tăng mỗi lần mở/đóng để bỏ kết quả của lần mở cũ
    id: null,
    pdf: null,
    flip: null,
    n: 0,
    pageEls: [],
    rendered: new Map(), // chỉ số trang -> khóa độ phân giải đã vẽ
    queue: [],
    run: null, // { busy } của lần mở hiện tại
    zoom: 1,
    scaleKey: "",
    saveTimer: 0,
};
const ZOOMS = [1, 1.5, 2, 3];

async function openDoc(id) {
    if (!window.pdfjsLib || !window.St || !window.St.PageFlip) {
        toast("Thiếu thư viện đọc PDF. Xem README.md.");
        return;
    }
    closeReader();
    const token = ++R.token;
    showView("reader");
    $("#loading").hidden = false;
    $("#pageInfo").textContent = "";
    let pdf = null;
    try {
        const rec = await Store.getDoc(id);
        const blob = rec && (await Store.getFile(id));
        if (!rec || !blob) throw new Error("Không tìm thấy dữ liệu tài liệu.");
        $("#currentTitle").textContent = rec.title || titleOf(rec.name);
        pdf = await loadPdf(blob, rec.title || rec.name, true);
        if (token !== R.token) {
            pdf.destroy();
            return;
        }
        R.id = id;
        R.pdf = pdf;
        R.n = pdf.numPages;
        R.run = { busy: false };
        R.zoom = 1;
        await buildBook(token, rec.lastPage || 0);
        if (token !== R.token) return;
        if (rec.locked || rec.pages !== R.n)
            finalizeMeta(id, pdf)
                .then(reloadDocs)
                .catch(() => {});
        Store.updateDoc(id, { lastOpened: Date.now() }).catch(() => {});
    } catch (err) {
        if (token !== R.token) {
            if (pdf && pdf !== R.pdf) pdf.destroy();
            return;
        }
        if (!err.cancelled) {
            console.error(err);
            toast("Không mở được tài liệu: " + (err.message || err));
        }
        if (pdf && pdf !== R.pdf) pdf.destroy();
        showLibrary();
    } finally {
        if (token === R.token) $("#loading").hidden = true;
    }
}

function stageSize() {
    const s = $("#stage");
    return { w: s.clientWidth, h: s.clientHeight };
}

function applyZoomSize() {
    const { w, h } = stageSize();
    const wrap = $("#zoomWrap");
    wrap.style.width = Math.round(w * R.zoom) + "px";
    wrap.style.height = Math.round(h * R.zoom) + "px";
    $("#zoomLabel").textContent = Math.round(R.zoom * 100) + "%";
    $("#zoomOut").disabled = R.zoom <= ZOOMS[0];
    $("#zoomIn").disabled = R.zoom >= ZOOMS[ZOOMS.length - 1];
    R.scaleKey = `${h}x${R.zoom}`;
}

async function buildBook(token, startPage) {
    const first = await R.pdf.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    first.cleanup();
    if (token !== R.token) return;

    const wrap = $("#zoomWrap");
    const el = document.createElement("div");
    wrap.replaceChildren(el);
    applyZoomSize();

    R.pageEls = [];
    for (let i = 0; i < R.n; i++) {
        const page = document.createElement("div");
        page.className = "page";
        R.pageEls.push(page);
    }
    R.rendered.clear();
    R.queue = [];

    R.flip = new St.PageFlip(el, {
        width: Math.round(vp.width),
        height: Math.round(vp.height),
        size: "stretch",
        // Ngưỡng tối thiểu theo cỡ trang: màn hình hẹp hơn ~2 trang thì tự chuyển sang xem 1 trang
        minWidth: Math.round(vp.width * 0.6),
        maxWidth: 2400,
        minHeight: Math.round(vp.height * 0.6),
        maxHeight: 3200,
        showCover: true,
        usePortrait: true,
        mobileScrollSupport: true,
        maxShadowOpacity: 0.35,
        flippingTime: 650,
    });
    R.flip.loadFromHTML(R.pageEls);
    R.flip.on("flip", onFlip);
    R.flip.on("changeOrientation", onFlip);

    $("#pageSlider").max = R.n;
    $("#sliderMax").textContent = R.n;
    $("#pageInput").max = R.n;

    const start = Math.max(0, Math.min(R.n - 1, startPage));
    if (start > 0) R.flip.turnToPage(start);
    updateReaderUI();
    ensureVisible(currentIndex());
}

function currentIndex() {
    return R.flip ? R.flip.getCurrentPageIndex() : 0;
}

function onFlip() {
    if (!R.flip) return;
    const idx = currentIndex();
    updateReaderUI();
    ensureVisible(idx);
    scheduleSave(idx);
}

function pageLabel(idx) {
    const portrait = R.flip.getOrientation() === "portrait";
    if (!portrait && idx > 0 && idx + 1 <= R.n - 1)
        return `${idx + 1}–${idx + 2}`;
    return String(idx + 1);
}

function updateReaderUI() {
    if (!R.flip) return;
    const idx = currentIndex();
    const portrait = R.flip.getOrientation() === "portrait";
    $("#pageInfo").textContent = `Trang ${pageLabel(idx)} / ${R.n}`;
    $("#pageSlider").value = idx + 1;
    $("#pageInput").value = idx + 1;
    const nextStart = portrait ? idx + 1 : idx === 0 ? 1 : idx + 2;
    $("#prevBtn").disabled = idx <= 0;
    $("#nextBtn").disabled = nextStart > R.n - 1;
}

function scheduleSave(idx) {
    clearTimeout(R.saveTimer);
    const id = R.id;
    R.saveTimer = setTimeout(() => {
        R.saveTimer = 0;
        Store.updateDoc(id, { lastPage: idx, lastOpened: Date.now() }).catch(
            () => {},
        );
    }, 600);
}

/* Vẽ lười: chỉ giữ canvas cho các trang gần trang đang xem. */
function ensureVisible(center) {
    if (!R.pdf) return;
    const order = [0, 1, -1, 2, -2, 3, 4, 5]
        .map((d) => center + d)
        .filter((i) => i >= 0 && i < R.n);
    R.queue = order.filter((i) => {
        const r = R.rendered.get(i);
        return !r || r.key !== R.scaleKey;
    });
    for (const i of Array.from(R.rendered.keys())) {
        if (i < center - 6 || i > center + 9) {
            R.pageEls[i].replaceChildren();
            R.rendered.delete(i);
        }
    }
    pump(R.token, R.run);
}

async function pump(token, run) {
    if (!run || run.busy) return;
    run.busy = true;
    try {
        while (token === R.token && R.queue.length) {
            const i = R.queue.shift();
            const r = R.rendered.get(i);
            if (r && r.key === R.scaleKey) continue;
            await renderPage(i, token);
        }
    } finally {
        run.busy = false;
    }
}

function targetScale(base) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssH = Math.max(300, stageSize().h) * R.zoom;
    let scale = Math.min(cssH * dpr, 2600) / base.height;
    const px = base.width * scale * base.height * scale;
    if (px > 9e6) scale *= Math.sqrt(9e6 / px);
    return scale;
}

async function renderPage(i, token) {
    const pdf = R.pdf;
    const key = R.scaleKey;
    let canvas = null;
    try {
        const page = await pdf.getPage(i + 1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: targetScale(base) });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({
            canvasContext: canvas.getContext("2d", { alpha: false }),
            viewport,
        }).promise;
        page.cleanup();
        if (token !== R.token || pdf !== R.pdf) {
            canvas.width = canvas.height = 0;
            return;
        }
        R.pageEls[i].replaceChildren(canvas);
        R.rendered.set(i, { key });
    } catch (err) {
        if (token === R.token) {
            console.warn("Không vẽ được trang " + (i + 1), err);
            R.rendered.set(i, { key, failed: true }); // tránh thử lại vô hạn
        }
        if (canvas) canvas.width = canvas.height = 0;
    }
}

function goTo(index) {
    if (!R.flip) return;
    R.flip.turnToPage(Math.max(0, Math.min(R.n - 1, index)));
    onFlip();
}

function setZoom(z) {
    if (!R.flip) return;
    R.zoom = z;
    applyZoomSize();
    R.flip.update();
    const stage = $("#stage");
    stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    updateReaderUI();
    ensureVisible(currentIndex());
}

function closeReader() {
    if (R.saveTimer && R.id && R.flip) {
        clearTimeout(R.saveTimer);
        R.saveTimer = 0;
        Store.updateDoc(R.id, {
            lastPage: currentIndex(),
            lastOpened: Date.now(),
        }).catch(() => {});
    }
    R.queue = [];
    R.run = null;
    if (R.flip) {
        try {
            R.flip.destroy();
        } catch (e) {
            console.warn(e);
        }
        R.flip = null;
    }
    $("#zoomWrap").replaceChildren();
    for (const canvas of document.querySelectorAll("#zoomWrap canvas"))
        canvas.width = canvas.height = 0;
    R.pageEls = [];
    R.rendered.clear();
    if (R.pdf) {
        try {
            R.pdf.destroy();
        } catch (e) {
            console.warn(e);
        }
        R.pdf = null;
    }
    R.id = null;
    R.n = 0;
}

async function showLibrary() {
    R.token++; // hủy mọi thao tác mở đang dở
    closeReader();
    showView("library");
    $("#loading").hidden = true;
    if (document.fullscreenElement && document.exitFullscreen)
        document.exitFullscreen().catch(() => {});
    await reloadDocs();
}

$("#backBtn").addEventListener("click", showLibrary);
$("#prevBtn").addEventListener("click", () => R.flip && R.flip.flipPrev());
$("#nextBtn").addEventListener("click", () => R.flip && R.flip.flipNext());
$("#zoomIn").addEventListener("click", () => {
    const next = ZOOMS.find((z) => z > R.zoom);
    if (next) setZoom(next);
});
$("#zoomOut").addEventListener("click", () => {
    const prev = ZOOMS.slice()
        .reverse()
        .find((z) => z < R.zoom);
    if (prev) setZoom(prev);
});
$("#pageSlider").addEventListener("input", (e) => {
    $("#pageInput").value = e.target.value;
});
$("#pageSlider").addEventListener("change", (e) =>
    goTo(Number.parseInt(e.target.value, 10) - 1),
);
function goFromInput() {
    const page = Number.parseInt($("#pageInput").value, 10);
    if (Number.isFinite(page)) goTo(page - 1);
    else updateReaderUI();
}
$("#goPageBtn").addEventListener("click", goFromInput);
$("#pageInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") goFromInput();
});

$("#fullscreenBtn").addEventListener("click", async () => {
    try {
        if (!document.fullscreenElement)
            await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
    } catch {
        toast("Thiết bị không cho phép toàn màn hình ở chế độ này.");
    }
});

document.addEventListener("keydown", (e) => {
    if ($("#readerView").hidden || !R.flip) return;
    if (
        e.target &&
        /^(INPUT|TEXTAREA)$/.test(e.target.tagName) &&
        e.target.type !== "range"
    )
        return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
        R.flip.flipNext();
        e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        R.flip.flipPrev();
        e.preventDefault();
    } else if (e.key === "Escape") showLibrary();
});

window.addEventListener(
    "resize",
    debounce(() => {
        if (!R.flip) return;
        applyZoomSize();
        R.flip.update();
        updateReaderUI();
        ensureVisible(currentIndex());
    }, 250),
);

// Lưu tiến độ khi đóng tab hoặc chuyển ứng dụng
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && R.flip && R.id) {
        clearTimeout(R.saveTimer);
        R.saveTimer = 0;
        Store.updateDoc(R.id, {
            lastPage: currentIndex(),
            lastOpened: Date.now(),
        }).catch(() => {});
    }
});

/* ---------- Khởi động ---------- */

async function init() {
    if (window.pdfjsLib)
        pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
    else toast("Thiếu thư viện pdf.js trong thư mục vendor/.");
    Store.persist(); // xin trình duyệt không tự xóa dữ liệu khi thiếu bộ nhớ
    await reloadDocs();
}
init();
