"use strict";
window.SXIcons = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  image: "M3 3h18v18H3z m0 14 5-5 4 4 4-6 5 7 M8 7h.01",
  video: "M3 5h12v14H3z m12 5 6-4v12l-6-4",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  upload: "M12 16V4 m-5 5 5-5 5 5 M4 16v5h16v-5",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  settings:
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  help: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4 M12 16v.1",
  lock: "M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6",
  phone: "M7 2h10v20H7z M10 5h4 M11 18h2",
  link: "m10 13 4-4 M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  wifi: "M2 8a16 16 0 0 1 20 0 M5 12a11 11 0 0 1 14 0 M8 16a6 6 0 0 1 8 0 M12 20h.01",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  external: "M6 18 18 6 M6 6h12v12",
  plus: "M12 5v14 M5 12h14",
  close: "m6 6 12 12 M6 18 18 6",
  check: "m5 12 4 4L19 6",
  chevron: "m6 9 6 6 6-6",
  search: "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0 m-2 6 6 6",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  play: "m8 4 12 8-12 8z",
  folder: "M3 5h6l3 3h9v12H3z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  logout: "M9 4H3v16h6 M10 12h11 m-5-5 5 5-5 5",
  refresh:
    "M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 14-2l1 6 M4 12l1 6a8 8 0 0 0 14-2",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7v.1",
  disk: "M4 3h13l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8",
  spark: "m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8z",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.1 M3 12h.1 M3 18h.1",
  moon: "M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10",
  zip: "M5 3h10l4 4v14H5z M11 3v3h2v3h-2v3h2v4h-3v-4",
  whatsapp:
    "M20.5 3.5A12 12 0 0 0 1.8 18.2L0 24l6-1.6A12 12 0 0 0 24 12a12 12 0 0 0-3.5-8.5 M8 7c0 6 3 9 9 10l1-3-3-1-1 1c-2-1-3-2-4-4l1-1-1-3z",
};
window.sxIcon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${SXIcons[name] || SXIcons.grid}"/></svg>`;
window.hydrateIcons = (root = document) =>
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = sxIcon(el.dataset.icon)));
