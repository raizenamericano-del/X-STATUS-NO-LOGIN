"use strict";
(() => {
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = SX.escape,
    icon = sxIcon;
  const pages = {
    dashboard: "Overview",
    connection: "Hubungkan WhatsApp",
    gallery: "Galeri Status",
    downloads: "Download Manager",
    history: "Riwayat",
    settings: "Pengaturan",
    help: "Bantuan",
  };
  let page = "dashboard",
    items = [],
    history = [],
    overview = null,
    settings = {},
    wa = {},
    filter = "all",
    selection = new Set(),
    previewId = null,
    method = "pairing",
    uploadFiles = [],
    uploadXHR = null,
    pollBusy = false;
  let mediaLimit = 24,
    recentSignature = null;
  const tasks = [];
  let queueBusy = false;
  const stateNames = {
    disconnected: "Offline",
    connecting: "Menghubungkan",
    waiting: "Menunggu autentikasi",
    connected: "Terhubung",
    reconnecting: "Menyambung ulang",
    failed: "Gagal terhubung",
  };
  const jobNames = {
    queued: "Dalam antrean",
    preparing: "Menyiapkan paket",
    ready: "Siap",
    transferring: "Menerima file",
    transferred: "Terkirim dari server",
    delivered: "Diterima browser",
    failed: "Gagal",
    cancelled: "Dibatalkan",
    expired: "Kedaluwarsa",
  };
  function notifyError(e) {
    if (e.name !== "AbortError")
      SX.toast(e.message || "Proses belum berhasil.", "error");
  }
  async function buttonTask(button, fn) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      notifyError(e);
    } finally {
      button.disabled = false;
    }
  }
  function closeMenu() {
    $("#sidebar").classList.remove("open");
    $("#navScrim").hidden = true;
    $("#menuButton").setAttribute("aria-expanded", "false");
  }
  function navigate(next) {
    page = pages[next] ? next : "dashboard";
    $$(".page").forEach((el) => (el.hidden = el.id !== `page-${page}`));
    $$("[data-page]").forEach((el) => {
      const active = el.dataset.page === page;
      if (
        el.classList.contains("nav-item") ||
        el.parentElement.classList.contains("mobile-bottom")
      ) {
        el.classList.toggle("active", active);
        el.setAttribute("aria-current", active ? "page" : "false");
      }
    });
    $("#pageLabel").textContent = pages[page];
    document.title = `${pages[page]} — STATUSX`;
    if (location.hash !== `#${page}`)
      window.history.replaceState(null, "", `#${page}`);
    closeMenu();
    if (page === "history") loadHistory().catch(notifyError);
    if (page === "connection") refreshWa().catch(notifyError);
  }
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-page]");
    if (nav) {
      e.preventDefault();
      navigate(nav.dataset.page);
    }
    const close = e.target.closest("[data-close]");
    if (close) {
      const id = close.dataset.close;
      if (id === "uploadDialog" && uploadXHR) {
        cancelUpload();
        return;
      }
      $("#" + id).close();
    }
    const action = e.target.closest("[data-action]");
    if (action?.dataset.action === "import") openUpload();
  });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
  $("#menuButton").addEventListener("click", () => {
    const open = !$("#sidebar").classList.contains("open");
    $("#sidebar").classList.toggle("open", open);
    $("#navScrim").hidden = !open;
    $("#menuButton").setAttribute("aria-expanded", String(open));
    if (open) $(".nav-item").focus();
  });
  $("#navScrim").addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
    if (e.key === "Tab" && $("#sidebar").classList.contains("open")) {
      const nodes = $$("a,button", $("#sidebar"));
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0].focus();
      }
    }
  });
  async function confirm(title, text) {
    const dialog = $("#confirmDialog");
    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    dialog.returnValue = "cancel";
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "confirm"),
        { once: true },
      );
      dialog.showModal();
    });
  }
  function applySettings(s) {
    settings = s;
    $("#displayName").value = s.displayName;
    $("#retentionDays").value = s.retentionDays;
    $("#reduceMotion").checked = s.reduceMotion;
    $("#settingsCollect").checked = s.autoCollect;
    $("#collectToggle").checked = s.autoCollect;
    document.documentElement.dataset.motion = s.reduceMotion ? "off" : "on";
    $("#sidebarName").replaceChildren(document.createTextNode(s.displayName));
    const small = document.createElement("small");
    small.textContent = "TANPA LOGIN";
    $("#sidebarName").append(small);
  }
  function renderOverview(data) {
    overview = data;
    SX.limits = data.limits;
    const s = data.stats;
    $("#welcomeName").textContent = "kembali";
    $("#profileName").textContent = data.workspaceName;
    $("#profileInitial").textContent = $("#topAvatar").textContent = (
      data.workspaceName || "S"
    )
      .charAt(0)
      .toUpperCase();
    $("#statMedia").textContent = s.count;
    $("#statImages").textContent = `${s.images} foto`;
    $("#statVideos").textContent = `${s.videos} video`;
    $("#statDownloads").textContent = s.downloads;
    const size = SX.bytes(s.bytes).split(" ");
    $("#statStorage").innerHTML =
      `${esc(size[0])} <small>${esc(size[1])}</small>`;
    $("#statStorageLimit").textContent =
      `Dari ${SX.bytes(data.limits.maxStorageBytes)} kapasitas`;
    const percent = Math.min(
      100,
      (s.bytes / data.limits.maxStorageBytes) * 100,
    );
    $("#storagePercent").textContent = `${percent.toFixed(0)}%`;
    $("#storageBar").style.width = `${percent}%`;
    $("#storageText").textContent =
      `${SX.bytes(s.bytes)} dari ${SX.bytes(data.limits.maxStorageBytes)} terpakai`;
    $("#galleryCount").textContent = s.count;
    $("#uploadLimit").textContent =
      `Maks. 10 file · ${SX.bytes(data.limits.maxFileBytes)} per file`;
    renderWa(data.whatsapp);
    const signature = data.recent.map((m) => m.id).join(",");
    if (signature !== recentSignature) {
      recentSignature = signature;
      renderRecent(data.recent);
    }
  }
  function empty(title, description, type = "image", action = "import") {
    return `<div class="empty-state"><div class="empty-illustration"><span>${icon(type)}</span></div><h3>${esc(title)}</h3><p>${esc(description)}</p>${action === "import" ? `<button class="btn secondary" data-action="import">${icon("plus")} Impor media pertama</button>` : action === "gallery" ? '<button class="btn secondary" data-page="gallery">Buka galeri →</button>' : ""}</div>`;
  }
  async function loadMedia() {
    const result = await SX.api("/media");
    items = result.items;
    selection = new Set(
      [...selection].filter((id) => items.some((m) => m.id === id)),
    );
    renderGallery();
  }
  async function loadHistory() {
    history = (await SX.api("/history")).items;
    renderHistory();
  }
  async function refreshAll() {
    const [data] = await Promise.all([
      SX.api("/overview"),
      loadMedia(),
      loadHistory(),
    ]);
    renderOverview(data);
    return data;
  }
  $("#refreshButton").addEventListener("click", (e) =>
    buttonTask(e.currentTarget, async () => {
      SX.csrf = (await SX.api("/session")).csrfToken;
      await refreshAll();
      $("#bootError").hidden = true;
      SX.toast("Workspace diperbarui.", "success");
    }),
  );
  function filteredItems() {
    const search = $("#mediaSearch").value.toLowerCase().trim();
    let list = items.filter(
      (m) =>
        (filter === "all" || m.type === filter) &&
        m.name.toLowerCase().includes(search),
    );
    const order = $("#mediaSort").value;
    return list.sort((a, b) =>
      order === "old"
        ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
        : order === "name"
          ? a.name.localeCompare(b.name)
          : order === "size"
            ? b.size - a.size
            : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }
  function mediaCard(m, compact = false) {
    const el = document.createElement("article");
    el.className = "media-card" + (selection.has(m.id) ? " selected" : "");
    el.dataset.id = m.id;
    const src = `/api/media/${encodeURIComponent(m.id)}/content`;
    el.innerHTML = `${compact ? "" : `<label class="media-select"><input type="checkbox" aria-label="Pilih ${esc(m.name)}" ${selection.has(m.id) ? "checked" : ""}></label>`}<button class="media-thumb" aria-label="Preview ${esc(m.name)}">${m.type === "image" ? `<img src="${src}" alt="${esc(m.name)}" loading="lazy">` : `<video src="${src}#t=0.1" preload="metadata" muted playsinline aria-hidden="true"></video><span class="video-play"><span>${icon("play")}</span></span>`}<span class="media-type">${m.type === "image" ? "FOTO" : "VIDEO"}</span></button><div class="media-info"><h3 title="${esc(m.name)}">${esc(m.name)}</h3><p>${esc(SX.bytes(m.size))} · ${esc(SX.date(m.createdAt))}</p><div class="media-card-bottom"><span class="source-label">${m.source === "whatsapp" ? "WhatsApp" : "Impor lokal"}</span><div class="media-card-actions"><button class="icon-btn media-download" aria-label="Download ${esc(m.name)}" title="Download">${icon("download")}</button>${compact ? "" : `<button class="icon-btn media-delete" aria-label="Hapus ${esc(m.name)}" title="Hapus">${icon("trash")}</button>`}</div></div></div>`;
    $(".media-thumb", el).addEventListener("click", () => preview(m));
    $(".media-download", el).addEventListener("click", () => enqueue([m.id]));
    $(".media-delete", el)?.addEventListener("click", () =>
      deleteMedia([m.id]),
    );
    $("input", el)?.addEventListener("change", (e) => {
      if (e.target.checked) {
        if (selection.size >= 100) {
          e.target.checked = false;
          return SX.toast("Maksimal 100 file per pilihan.");
        }
        selection.add(m.id);
      } else selection.delete(m.id);
      el.classList.toggle("selected", selection.has(m.id));
      renderSelection();
    });
    $("img", el)?.addEventListener("error", (e) => {
      e.target.remove();
      const placeholder = document.createElement("span");
      placeholder.className = "video-play";
      placeholder.innerHTML = icon("image");
      $(".media-thumb", el).append(placeholder);
    });
    return el;
  }
  function renderRecent(recent) {
    const target = $("#recentMedia");
    target.replaceChildren();
    if (!recent.length) {
      target.innerHTML = empty(
        "Koleksi pertama menunggumu",
        "Belum ada media di sini. Mulai dari file milikmu, atau hubungkan akun yang kamu izinkan.",
      );
      return;
    }
    const grid = document.createElement("div");
    grid.className = "recent-grid";
    recent.forEach((m) => grid.append(mediaCard(m, true)));
    target.append(grid);
  }
  function renderGallery() {
    const list = filteredItems();
    $("#allCount").textContent = items.length;
    $("#gallerySummary").textContent =
      `${Math.min(mediaLimit, list.length)} tampil · ${list.length} hasil`;
    const grid = $("#mediaGrid");
    grid.replaceChildren();
    if (!list.length)
      grid.innerHTML = items.length
        ? empty(
            "Belum ada yang cocok",
            "Coba nama file lain atau ubah filter media.",
            "search",
            null,
          )
        : empty(
            "Ruang untuk momen yang berarti",
            "Tidak ada status contoh atau data palsu. Galeri akan terisi setelah impor atau menerima status berizin.",
          );
    else {
      list.slice(0, mediaLimit).forEach((m) => grid.append(mediaCard(m)));
      if (list.length > mediaLimit) {
        const more = document.createElement("button");
        more.className = "btn secondary load-more";
        more.textContent = `Muat lebih banyak (${list.length - mediaLimit} tersisa)`;
        more.addEventListener("click", () => {
          mediaLimit += 24;
          renderGallery();
        });
        grid.append(more);
      }
    }
    renderSelection();
  }
  function renderSelection() {
    $("#selectionBar").hidden = !selection.size;
    $("#selectionCount").textContent = selection.size;
    const list = filteredItems().slice(0, 100);
    $("#selectAll").checked =
      !!list.length && list.every((m) => selection.has(m.id));
    $("#selectAll").indeterminate =
      list.some((m) => selection.has(m.id)) && !$("#selectAll").checked;
  }
  $$(".filter-tabs button").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      mediaLimit = 24;
      $$(".filter-tabs button").forEach((b) =>
        b.classList.toggle("active", b === button),
      );
      renderGallery();
    }),
  );
  $("#mediaSearch").addEventListener("input", () => {
    mediaLimit = 24;
    renderGallery();
  });
  $("#mediaSort").addEventListener("change", () => {
    mediaLimit = 24;
    renderGallery();
  });
  $("#selectAll").addEventListener("change", (e) => {
    if (e.target.checked) {
      selection = new Set(
        filteredItems()
          .slice(0, 100)
          .map((m) => m.id),
      );
    } else selection.clear();
    renderGallery();
  });
  $("#clearSelection").addEventListener("click", () => {
    selection.clear();
    renderGallery();
  });
  $("#downloadSelected").addEventListener("click", () =>
    enqueue([...selection]),
  );
  $("#deleteSelected").addEventListener("click", () =>
    deleteMedia([...selection]),
  );
  function preview(m) {
    previewId = m.id;
    $("#previewTitle").textContent = m.name;
    $("#previewMeta").textContent =
      `${SX.bytes(m.size)} · ${m.source === "whatsapp" ? "Status WhatsApp" : "Impor lokal"} · ${SX.date(m.createdAt)}`;
    const target = $("#previewContent");
    target.replaceChildren();
    const el = document.createElement(m.type === "image" ? "img" : "video");
    el.src = `/api/media/${m.id}/content`;
    if (m.type === "image") el.alt = m.name;
    else {
      el.controls = true;
      el.playsInline = true;
      el.preload = "metadata";
    }
    el.addEventListener("error", () => {
      target.innerHTML =
        "<p>Preview tidak tersedia untuk codec ini atau file tidak dapat dibaca. Kamu masih dapat mencoba mengunduh file aslinya.</p>";
    });
    target.append(el);
    $("#previewDialog").showModal();
  }
  $("#previewDialog").addEventListener("close", () => {
    const video = $("video", $("#previewContent"));
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    $("#previewContent").replaceChildren();
    previewId = null;
  });
  $("#previewDownload").addEventListener("click", () => {
    if (previewId) enqueue([previewId]);
  });
  $("#previewDelete").addEventListener("click", () => {
    const id = previewId;
    $("#previewDialog").close();
    if (id) deleteMedia([id]);
  });
  async function deleteMedia(ids) {
    if (!ids.length) return;
    if (
      !(await confirm(
        `Hapus ${ids.length} media?`,
        "File dan metadata galeri akan dihapus dari server. Salinan yang sudah diunduh tidak terpengaruh. Tindakan ini tidak bisa dibatalkan.",
      ))
    )
      return;
    try {
      const result = await SX.api("/media", {
        method: "DELETE",
        body: { ids },
      });
      ids.forEach((id) => selection.delete(id));
      await refreshAll();
      SX.toast(`${result.count} media dihapus.`, "success");
    } catch (e) {
      notifyError(e);
    }
  }
  function openUpload() {
    if (uploadXHR) {
      $("#uploadDialog").showModal();
      return;
    }
    uploadFiles = [];
    $("#uploadFiles").value = "";
    $("#uploadConsent").checked = false;
    $("#uploadProgressWrap").hidden = true;
    $("#uploadSubmit").disabled = false;
    renderUploadFiles();
    $("#uploadDialog").showModal();
  }
  function setUploadFiles(files) {
    if (files.length > 10)
      return SX.toast("Maksimal 10 file per impor.", "error");
    const tooBig = files.find((f) => f.size > SX.limits.maxFileBytes);
    if (tooBig)
      return SX.toast(
        `File ${tooBig.name} melebihi ${SX.bytes(SX.limits.maxFileBytes)}.`,
        "error",
      );
    uploadFiles = [...files];
    renderUploadFiles();
  }
  function renderUploadFiles() {
    $("#uploadFileList").replaceChildren();
    uploadFiles.forEach((file, index) => {
      const row = document.createElement("div");
      row.className = "upload-file-row";
      row.innerHTML = `${icon(file.type.startsWith("video/") ? "video" : "image")}<span>${esc(file.name)}</span><small>${SX.bytes(file.size)}</small><button type="button" class="icon-btn" aria-label="Hapus dari pilihan">${icon("close")}</button>`;
      $("button", row).disabled = !!uploadXHR;
      $("button", row).addEventListener("click", () => {
        uploadFiles.splice(index, 1);
        renderUploadFiles();
      });
      $("#uploadFileList").append(row);
    });
  }
  $("#uploadFiles").addEventListener("change", (e) =>
    setUploadFiles([...e.target.files]),
  );
  const drop = $("#dropZone");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragging");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
    if (!uploadXHR) setUploadFiles([...e.dataTransfer.files]);
  });
  function cancelUpload() {
    if (uploadXHR) {
      uploadXHR.abort();
      SX.toast(
        "Upload dibatalkan. File yang sudah selesai diproses server mungkin tetap tersimpan.",
      );
    }
    $("#uploadDialog").close();
  }
  $("#cancelUpload").addEventListener("click", cancelUpload);
  $("#uploadDialog").addEventListener("cancel", () => {
    uploadXHR?.abort();
  });
  $("#uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (uploadXHR) return;
    if (!uploadFiles.length)
      return SX.toast("Pilih setidaknya satu file.", "error");
    if (!$("#uploadConsent").checked)
      return SX.toast("Konfirmasikan izin penggunaan media.", "error");
    $("#uploadSubmit").disabled = true;
    $("#uploadFiles").disabled = true;
    $("#uploadProgressWrap").hidden = false;
    $("#uploadProgressBar").style.width = "0%";
    $("#uploadProgressText").textContent = "Memulai upload…";
    const form = new FormData();
    form.append("authorized", "true");
    uploadFiles.forEach((f) => form.append("files", f));
    try {
      SX.csrf = (await SX.api("/session")).csrfToken;
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXHR = xhr;
        xhr.open("POST", "/api/media/import");
        xhr.setRequestHeader("X-CSRF-Token", SX.csrf);
        xhr.timeout = 180000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            $("#uploadProgressBar").style.width = percent + "%";
            $("#uploadProgressText").textContent =
              percent === 100
                ? "Upload terkirim. Memvalidasi dan menyimpan file…"
                : `Mengunggah ${percent}% · ${SX.bytes(event.loaded)} / ${SX.bytes(event.total)}`;
          }
        };
        xhr.onload = () => {
          let data;
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            return reject(new Error("Respons upload tidak valid."));
          }
          xhr.status >= 200 && xhr.status < 300
            ? resolve(data)
            : reject(new Error(data.error?.message || "Upload ditolak."));
        };
        xhr.onerror = () =>
          reject(new Error("Upload terputus. Periksa jaringan."));
        xhr.ontimeout = () =>
          reject(
            new Error("Upload melewati batas waktu. Coba file lebih kecil."),
          );
        xhr.onabort = () =>
          reject(new DOMException("Dibatalkan", "AbortError"));
        xhr.send(form);
      });
      $("#uploadDialog").close();
      await refreshAll();
      navigate("gallery");
      SX.toast(`${result.items.length} media berhasil diimpor.`, "success");
      if (result.rejected.length)
        SX.toast(
          `${result.rejected.length} file ditolak: ${result.rejected[0].message}`,
          "error",
        );
    } catch (err) {
      notifyError(err);
      loadMedia().catch(() => {});
    } finally {
      uploadXHR = null;
      $("#uploadSubmit").disabled = false;
      $("#uploadFiles").disabled = false;
      renderUploadFiles();
    }
  });
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function enqueue(ids) {
    if (!ids.length) return SX.toast("Pilih media terlebih dahulu.");
    if (
      tasks.filter((t) =>
        ["queued", "preparing", "transferring"].includes(t.status),
      ).length >= 10
    )
      return SX.toast(
        "Antrean maksimal 10 pekerjaan. Tunggu yang lain selesai.",
        "error",
      );
    const entries = ids.map((id) => items.find((m) => m.id === id));
    if (entries.some((m) => !m))
      return SX.toast(
        "Sebagian media sudah tidak tersedia. Perbarui galeri.",
        "error",
      );
    const total = entries.reduce((n, m) => n + m.size, 0);
    if (total > SX.limits.maxBatchBytes)
      return SX.toast(
        `Pilihan melebihi batas paket ${SX.bytes(SX.limits.maxBatchBytes)}.`,
        "error",
      );
    const task = {
      id: crypto.randomUUID(),
      ids,
      name: ids.length > 1 ? `${ids.length} media · ZIP` : entries[0].name,
      status: "queued",
      received: 0,
      total: 0,
      error: null,
      job: null,
      controller: null,
    };
    tasks.unshift(task);
    renderTasks();
    SX.toast("Ditambahkan ke antrean unduhan.", "success");
    processQueue();
  }
  async function acknowledge(task, status) {
    if (!task.job) return;
    try {
      await SX.api(`/downloads/${task.job.id}/complete`, {
        method: "POST",
        body: { status },
      });
    } catch (e) {
      if (e.status === 409) {
        await new Promise((r) => setTimeout(r, 350));
        await SX.api(`/downloads/${task.job.id}/complete`, {
          method: "POST",
          body: { status },
        }).catch(() => {});
      }
    }
  }
  async function processQueue() {
    if (queueBusy) return;
    queueBusy = true;
    try {
      while (tasks.some((t) => t.status === "queued")) {
        const task = [...tasks].reverse().find((t) => t.status === "queued");
        task.controller = new AbortController();
        task.status = "preparing";
        renderTasks();
        const timeout = setTimeout(
          () => task.controller.abort("timeout"),
          240000,
        );
        try {
          const result = await SX.api("/downloads", {
            method: "POST",
            body: { ids: task.ids },
            signal: task.controller.signal,
          });
          task.job = result.job;
          task.name = result.job.name;
          task.total = result.job.size;
          task.status = "transferring";
          renderTasks();
          const response = await fetch(`/api/downloads/${task.job.id}/file`, {
            signal: task.controller.signal,
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error?.message || "Transfer tidak tersedia.");
          }
          const reader = response.body.getReader();
          const chunks = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            task.received += value.byteLength;
            if (task.received > 210 * 1024 * 1024) {
              await reader.cancel();
              throw new Error(
                "Paket terlalu besar untuk memori browser. Pilih media lebih sedikit.",
              );
            }
            chunks.push(value);
            updateTaskProgress(task);
          }
          if (task.received !== task.total)
            throw new Error("Transfer terputus sebelum file lengkap diterima.");
          saveBlob(
            new Blob(chunks, {
              type:
                response.headers.get("content-type") ||
                "application/octet-stream",
            }),
            task.name,
          );
          task.status = "delivered";
          await acknowledge(task, "delivered");
          SX.toast(
            "File diterima browser. Periksa panel unduhan browser.",
            "success",
          );
        } catch (error) {
          task.status = task.controller.signal.aborted ? "cancelled" : "failed";
          task.error =
            task.controller.signal.reason === "timeout"
              ? "Waktu transfer habis."
              : task.status === "cancelled"
                ? "Dibatalkan pengguna."
                : error.message;
          await acknowledge(task, task.status);
          if (task.status === "failed") notifyError(error);
        } finally {
          clearTimeout(timeout);
          renderTasks();
          await loadHistory().catch(() => {});
          SX.api("/overview")
            .then(renderOverview)
            .catch(() => {});
        }
      }
    } finally {
      queueBusy = false;
    }
  }
  function renderTasks() {
    const target = $("#downloadList");
    target.replaceChildren();
    if (!tasks.length) {
      target.innerHTML = empty(
        "Belum ada unduhan",
        "Pilih satu media di galeri, atau seleksi beberapa untuk membuat ZIP.",
        "download",
        "gallery",
      );
    } else
      tasks.forEach((t) => {
        const row = document.createElement("article");
        row.className = "download-row";
        row.dataset.task = t.id;
        const active = ["queued", "preparing", "transferring"].includes(
          t.status,
        );
        row.innerHTML = `<span class="download-file-icon">${icon(t.ids.length > 1 ? "zip" : "download")}</span><div class="download-meta"><h3>${esc(t.name)}</h3><p class="task-detail">${esc(t.error || jobNames[t.status])}</p><div class="progress-track"><span></span></div></div><div class="task-actions"><span class="status-badge ${t.status}">${esc(jobNames[t.status])}</span> <button class="btn secondary">${active ? "Batalkan" : t.status === "delivered" ? "Unduh lagi" : "Coba lagi"}</button></div>`;
        $("button", row).addEventListener("click", () => {
          if (active) {
            if (t.status === "queued") {
              t.status = "cancelled";
              t.error = "Dibatalkan sebelum diproses.";
            } else t.controller?.abort("user");
            renderTasks();
          } else enqueue(t.ids);
        });
        target.append(row);
        updateTaskProgress(t);
      });
    $("#taskCount").textContent =
      tasks.filter((t) =>
        ["queued", "preparing", "transferring"].includes(t.status),
      ).length || "";
  }
  function updateTaskProgress(t) {
    const row = $(`[data-task="${t.id}"]`);
    if (!row) return;
    const pct = t.total ? Math.min(100, (t.received / t.total) * 100) : 0;
    $(".progress-track span", row).style.width = pct + "%";
    if (t.status === "transferring")
      $(".task-detail", row).textContent =
        `${Math.round(pct)}% · ${SX.bytes(t.received)} / ${SX.bytes(t.total)}`;
  }
  $("#clearTasks").addEventListener("click", () => {
    for (let i = tasks.length - 1; i >= 0; i--)
      if (!["queued", "preparing", "transferring"].includes(tasks[i].status))
        tasks.splice(i, 1);
    renderTasks();
  });
  function renderHistory() {
    const target = $("#historyList"),
      q = $("#historySearch").value.toLowerCase().trim();
    target.replaceChildren();
    const list = history.filter((h) => h.name.toLowerCase().includes(q));
    if (!list.length) {
      target.innerHTML = empty(
        history.length ? "Tidak ada hasil pencarian" : "Belum ada riwayat",
        history.length
          ? "Coba nama file atau paket lain."
          : "Unduhan yang disiapkan akan dicatat di sini.",
        "clock",
        history.length ? null : "gallery",
      );
      return;
    }
    list.forEach((h) => {
      const row = document.createElement("div");
      row.className = "history-row";
      const available = h.mediaIds.every((id) =>
        items.some((m) => m.id === id),
      );
      row.innerHTML = `<div class="history-file"><i>${icon(h.kind === "zip" ? "zip" : "image")}</i><div><strong>${esc(h.name)}</strong><small>${esc(SX.date(h.createdAt))} · ${h.mediaIds.length} file</small></div></div><span class="history-size">${SX.bytes(h.size)}</span><div class="history-status"><span class="status-badge ${esc(h.status)}">${esc(jobNames[h.status] || h.status)}</span>${!available ? "<small>Media sudah dihapus</small>" : ""}</div><button class="icon-btn" title="Siapkan ulang unduhan" aria-label="Siapkan ulang ${esc(h.name)}" ${available ? "" : "disabled"}>${icon("refresh")}</button>`;
      $("button", row).addEventListener("click", () => enqueue(h.mediaIds));
      target.append(row);
    });
  }
  $("#historySearch").addEventListener("input", renderHistory);
  $("#clearHistory").addEventListener("click", (e) =>
    buttonTask(e.currentTarget, async () => {
      if (!history.length) return SX.toast("Riwayat sudah kosong.");
      if (
        await confirm(
          "Hapus seluruh riwayat?",
          "Catatan unduhan dan paket sementara akan dibersihkan. File di galeri tidak dihapus.",
        )
      ) {
        await SX.api("/history", { method: "DELETE" });
        await refreshAll();
        SX.toast("Riwayat dibersihkan.", "success");
      }
    }),
  );
  $("#exportHistory").addEventListener("click", () => {
    if (!history.length) return SX.toast("Belum ada riwayat untuk diekspor.");
    saveBlob(
      new Blob(
        [
          JSON.stringify(
            {
              app: "STATUSX",
              exportedAt: new Date().toISOString(),
              items: history,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "statusx-history.json",
    );
  });
  function renderWa(value) {
    wa = value;
    const active = ["connecting", "waiting", "reconnecting"].includes(wa.state),
      online = wa.state === "connected";
    const text = stateNames[wa.state] || "Offline";
    $("#headerConnection").textContent = text;
    $("#statConnection").textContent = online
      ? "Terhubung"
      : active
        ? "Connecting…"
        : wa.state === "failed"
          ? "Gagal"
          : "Offline";
    $("#statConnectionNote").textContent = online
      ? settings.autoCollect
        ? "Koleksi status aktif"
        : "Koleksi otomatis nonaktif"
      : active
        ? "Menunggu perangkatmu"
        : "Siap saat kamu siap";
    [$("#headerDot"), $("#statDot"), $(".nav-connection-dot")].forEach((el) => {
      el.classList.toggle("online-dot", online);
      el.classList.toggle("waiting-dot", active);
    });
    $("#waStateBadge").textContent = online
      ? "CONNECTED"
      : active
        ? "AUTHENTICATING"
        : wa.state === "failed"
          ? "FAILED"
          : "OFFLINE";
    $("#waStateTitle").textContent = text;
    $("#waMessage").textContent = wa.enabled
      ? wa.message
      : "Baileys dinonaktifkan pada server ini. Gunakan impor media lokal.";
    $("#connectButton").disabled =
      !wa.enabled || active || online || wa.savedSession;
    $("#resumeButton").hidden = !wa.savedSession || active || online;
    $("#resumeButton").disabled = !wa.enabled;
    $("#cancelConnection").hidden = !active;
    $("#disconnectButton").hidden = !online && !wa.savedSession;
    $("#pairingPanel").hidden = !wa.pairingCode;
    $("#pairingCode").textContent = wa.pairingCode || "";
    $("#qrPanel").hidden = !wa.qr;
    if (wa.qr && wa.qr !== $("#qrImage").src) $("#qrImage").src = wa.qr;
    else if (!wa.qr) $("#qrImage").removeAttribute("src");
    $("#waNotice").hidden = !wa.notice;
    $("#waNotice").textContent = wa.notice || "";
  }
  async function refreshWa() {
    renderWa(await SX.api("/whatsapp"));
  }
  $$("[data-method]").forEach((button) =>
    button.addEventListener("click", () => {
      method = button.dataset.method;
      $$("[data-method]").forEach((b) =>
        b.classList.toggle("selected", b === button),
      );
      $("#phoneFields").hidden = method !== "pairing";
      $("#qrExplanation").hidden = method !== "qr";
    }),
  );
  async function startConnection(selectedMethod) {
    if (!$("#waConsent").checked)
      throw new Error(
        "Centang konfirmasi kepemilikan/izin akun terlebih dahulu.",
      );
    let phone = "";
    if (selectedMethod === "pairing") {
      const local = $("#phoneInput").value.replace(/[\s()+-]/g, "");
      if (!local || ($("#countryCode").value && local.startsWith("0")))
        throw new Error(
          "Masukkan nomor tanpa awalan 0. Kode negara dipilih terpisah.",
        );
      phone = $("#countryCode").value + local;
      if (!/^[1-9]\d{7,14}$/.test(phone))
        throw new Error("Gunakan nomor lengkap 8–15 digit dengan kode negara.");
    }
    renderWa(
      await SX.api("/whatsapp/connect", {
        method: "POST",
        body: { method: selectedMethod, phone, authorized: true },
      }),
    );
    SX.toast("Koneksi dimulai. Tunggu respons autentikasi dari Baileys.");
  }
  $("#connectionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await buttonTask($("#connectButton"), () => startConnection(method));
    renderWa(wa);
  });
  $("#resumeButton").addEventListener("click", async (e) => {
    await buttonTask(e.currentTarget, () => startConnection("resume"));
    renderWa(wa);
  });
  $("#cancelConnection").addEventListener("click", (e) =>
    buttonTask(e.currentTarget, async () =>
      renderWa(await SX.api("/whatsapp/cancel", { method: "POST" })),
    ),
  );
  $("#disconnectButton").addEventListener("click", (e) =>
    buttonTask(e.currentTarget, async () => {
      if (
        await confirm(
          "Putuskan akun WhatsApp?",
          "Koneksi akan dihentikan dan file sesi lokal dihapus. Media di galeri tetap ada. Periksa juga daftar Perangkat tertaut di WhatsApp.",
        )
      )
        renderWa(await SX.api("/whatsapp/disconnect", { method: "POST" }));
    }),
  );
  $("#collectToggle").addEventListener("change", async (e) => {
    const value = e.target.checked;
    if (
      value &&
      !(await confirm(
        "Aktifkan koleksi status?",
        "Hanya media status baru yang diterima akun akan disimpan. Pastikan kamu memiliki izin dari pemilik media.",
      ))
    ) {
      e.target.checked = false;
      return;
    }
    try {
      const data = await SX.api("/settings", {
        method: "PATCH",
        body: { autoCollect: value },
      });
      applySettings(data.settings);
      renderWa(wa);
      SX.toast(
        value
          ? "Koleksi status otomatis diaktifkan."
          : "Koleksi status otomatis dinonaktifkan.",
        "success",
      );
    } catch (err) {
      e.target.checked = !value;
      notifyError(err);
    }
  });
  $("#settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    buttonTask($("#saveSettings"), async () => {
      const next = {
        displayName: $("#displayName").value.trim(),
        retentionDays: Number($("#retentionDays").value),
        reduceMotion: $("#reduceMotion").checked,
        autoCollect: $("#settingsCollect").checked,
      };
      if (
        next.autoCollect &&
        !settings.autoCollect &&
        !(await confirm(
          "Aktifkan koleksi status?",
          "Pastikan kamu memiliki izin menyimpan media status yang diterima akun terhubung.",
        ))
      )
        return;
      if (
        next.retentionDays &&
        next.retentionDays !== settings.retentionDays &&
        !(await confirm(
          "Ubah retensi media?",
          "Media yang lebih tua dari retensi baru dapat dihapus otomatis pada pembersihan berikutnya.",
        ))
      )
        return;
      const data = await SX.api("/settings", { method: "PATCH", body: next });
      applySettings(data.settings);
      renderWa(wa);
      SX.toast("Pengaturan disimpan.", "success");
    });
  });
  $("#cleanupButton").addEventListener("click", (e) =>
    buttonTask(e.currentTarget, async () => {
      if (
        !(await confirm(
          "Jalankan pembersihan?",
          "Media yang melewati retensi tersimpan akan dihapus permanen. Jika retensi manual, media tidak dihapus.",
        ))
      )
        return;
      const result = await SX.api("/maintenance/cleanup", { method: "POST" });
      await refreshAll();
      SX.toast(`${result.count} media kedaluwarsa dihapus.`, "success");
    }),
  );
  window.addEventListener("beforeunload", (e) => {
    if (
      uploadXHR ||
      tasks.some((t) =>
        ["queued", "preparing", "transferring"].includes(t.status),
      )
    ) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  async function boot() {
    try {
      const session = await SX.api("/session");
      SX.csrf = session.csrfToken;
      const data = await refreshAll();
      applySettings(data.settings);
      renderWa(data.whatsapp);
      $("#bootSkeleton").hidden = true;
      $("#bootError").hidden = true;
    } catch (e) {
      $("#bootSkeleton").hidden = true;
      $("#bootError").hidden = false;
      $("#bootError").textContent =
        e.message + " Gunakan tombol perbarui untuk mencoba lagi.";
    }
  }
  hydrateIcons();
  renderTasks();
  navigate(location.hash.slice(1) || "dashboard");
  boot();
  setInterval(async () => {
    if (pollBusy || document.hidden || !SX.csrf) return;
    pollBusy = true;
    try {
      const data = await SX.api("/overview");
      const changed =
        !overview ||
        data.stats.count !== items.length ||
        data.recent.map((m) => m.id).join() !==
          overview.recent.map((m) => m.id).join();
      renderOverview(data);
      if (changed) await loadMedia();
      if (page === "history") await loadHistory();
    } catch {
    } finally {
      pollBusy = false;
    }
  }, 6000);
})();
