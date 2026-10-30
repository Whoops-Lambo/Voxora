const paths = {
  shield: 'M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6l-9-4ZM12 7v6M12 16h.01',
  thread: "M5 3h14v12H9l-4 4V3ZM9 7h6M9 11h4",
  bookmark: "M6 3h12v19l-6-4-6 4V3Z",
  compass: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM16 8l-3 5-5 3 3-5 5-3Z",
  calendar: "M4 5h16v16H4V5ZM8 2v6M16 2v6M4 10h16M8 14h2M14 14h2M8 18h2",
  announcement: "M3 10v4h4l10 5V5L7 10H3ZM7 14l2 7h3l-2-6M21 8v8",
  poll: "M4 3h16v18H4V3ZM8 16v-4M12 16V7M16 16v-6",
  hash: "M9 3 7 21M17 3l-2 18M4 8h17M3 16h17",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  chevron: "m6 9 6 6 6-6",
  right: "m9 6 6 6-6 6",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  friends:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  people:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M15 3a4 4 0 0 1 0 8M23 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  micOff:
    "m2 2 20 20M9 9v3a3 3 0 0 0 5 2M15 9V5a3 3 0 0 0-5.7-1.3M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8",
  headphones:
    "M3 14v-3a9 9 0 0 1 18 0v3M3 13h4v8H5a2 2 0 0 1-2-2v-6ZM21 13h-4v8h2a2 2 0 0 0 2-2v-6Z",
  deafen:
    "m2 2 20 20M3 14v-3a9 9 0 0 1 2-5.7M9 2.5A9 9 0 0 1 21 11v3M3 13h4v8H5a2 2 0 0 1-2-2v-6ZM21 17v2a2 2 0 0 1-2 2h-2v-8",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l1-2h4l1 2 3 2 2-.1 2 3-1 2v4l1 2-2 3-2-.1-3 2-1 2h-4l-1-2-3-2-2 .1-2-3 1-2v-4l-1-2 2-3L6 5Z",
  speaker: "m11 5-6 5H2v4h3l6 5V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14",
  pin: "m16 3 5 5-4 1-3 5-1 4-7-7 4-1 5-3 1-4ZM2 22l6-6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  inbox: "M4 3h16l2 13v5H2v-5L4 3ZM2 16h6l2 3h4l2-3h6",
  help: "M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  emoji:
    "M8 14s1.5 3 4 3 4-3 4-3M8 8h.01M16 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  send: "m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13",
  gift: "M3 8h18v4H3V8ZM5 12v9h14v-9M12 8v13M12 8H7a3 3 0 1 1 3-3l2 3ZM12 8h5a3 3 0 1 0-3-3l-2 3Z",
  reply: "m9 10 5-5M9 10l5 5M9 10h7a6 6 0 0 1 6 6v3",
  edit: "m16 3 5 5-13 13H3v-5L16 3ZM13 6l5 5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  check: "m4 12 5 5L20 6",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.7l-1.3 1.3a16 16 0 0 0 4.7 4.7l1.3-1.3a2 2 0 0 1 1.7-.6l3 .5a2 2 0 0 1 1.6 1.9Z",
  disconnect:
    "M3 16a14 14 0 0 1 18 0l1-4a18 18 0 0 0-20 0l1 4ZM7 14v4H3M17 14v4h4",
  video: "m16 8 6-4v16l-6-4M2 5h14v14H2V5",
  screen: "M2 3h20v14H2V3ZM8 21h8M12 17v4M8 10l4-4 4 4M12 6v7",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  download: "M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5",
  file: "M14 2H4v20h16V8l-6-6ZM14 2v6h6M8 13h8M8 17h6",
  crown: "m2 6 5 4 5-7 5 7 5-4-3 14H5L2 6Z",
  logout: "M9 3H3v18h6M14 7l5 5-5 5M8 12h12",
  menu: "M3 6h18M3 12h18M3 18h18",
  shield: "m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4Zm-4 10 3 3 5-5",
  volume: "M4 4v16M9 8v8M14 2v20M19 6v12",
  at: "M16 8v7a3 3 0 0 0 6 0v-3a10 10 0 1 0-4 8M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  globe:
    "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20M12 2a20 20 0 0 1 0 20 20 20 0 0 1 0-20Z",
  lock: "M5 10h14v12H5V10ZM8 10V6a4 4 0 0 1 8 0v4",
  copy: "M9 9h12v12H9V9ZM15 5V2H2v13h3",
  arrow: "M4 12h16m-6-6 6 6-6 6",
};
export function icon(name, size = 20) {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.hash}"/></svg>`;
  return span;
}
