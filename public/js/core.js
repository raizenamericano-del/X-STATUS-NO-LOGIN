"use strict";
window.SX = {
  csrf: "",
  limits: {},
  escape: (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  bytes: (n) => {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  },
  date: (value) =>
    new Date(value).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  async api(url, options = {}) {
    const { body, method = "GET", _csrfRetry = false, ...rest } = options;
    const response = await fetch("/api" + url, {
      ...rest,
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-CSRF-Token": SX.csrf } : {}),
        ...rest.headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Server tidak dapat dijangkau. Periksa koneksi dan coba lagi.",
      );
    }
    if (!response.ok) {
      if (
        response.status === 403 &&
        data.error?.code === "CSRF_REJECTED" &&
        !_csrfRetry
      ) {
        const session = await SX.api("/session");
        SX.csrf = session.csrfToken;
        return SX.api(url, { ...options, _csrfRetry: true });
      }
      const e = new Error(data.error?.message || "Permintaan belum berhasil.");
      e.status = response.status;
      e.code = data.error?.code;
      throw e;
    }
    return data;
  },
  toast(message, type = "info") {
    const region = document.querySelector("#toasts");
    if (!region) return;
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.innerHTML =
      sxIcon(type === "success" ? "check" : "info") +
      `<span>${SX.escape(message)}</span>`;
    region.append(el);
    setTimeout(() => el.remove(), 5500);
  },
};
