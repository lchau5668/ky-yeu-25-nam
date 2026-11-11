const book = document.querySelector("#book");
const frame = document.querySelector(".book-frame");
const sheets = [...book.querySelectorAll(":scope > .sheet")];
const rail = document.querySelector("#rail");
const menuBtn = document.querySelector("#menu-btn");
const scrim = document.querySelector("#scrim");
const status = document.querySelector("#page-status");
const links = [...rail.querySelectorAll("a")];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phoneQuery = window.matchMedia("(max-width: 760px)");
const pageCount = sheets.length * 2;

let cursor = 0;
let busy = false;
let drag = null;
let phoneSide = "right";
let phoneCurl = false;
const seen = new WeakSet();

function format(value, decimals) {
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function runCounters(face) {
  if (!face) return;
  face.querySelectorAll("[data-count]").forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const target = Number(el.dataset.count);
    const decimals = Number(el.dataset.decimals || 0);
    const suffix = el.dataset.suffix || "";
    if (reduced) {
      el.textContent = `${format(target, decimals)}${suffix}`;
      return;
    }
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = `${format(target * eased, decimals)}${suffix}`;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function pageBox() {
  const box = book.getBoundingClientRect();
  const width = sheets[0].offsetWidth;
  const height = sheets[0].offsetHeight;
  return { left: box.left + box.width / 2, top: box.top, width, height };
}

function phoneOn() {
  return phoneQuery.matches;
}

function applyPhoneFrame() {
  const on = phoneOn();
  document.body.classList.toggle("phone", on);
  document.body.classList.toggle("side-left", on && phoneSide === "left");
  document.body.classList.toggle("side-right", on && phoneSide === "right");
  if (!frame.classList.contains("is-live")) frame.style.transform = "";
}

function syncFrameToTurn(turn) {
  if (!phoneOn()) return;
  frame.classList.add("is-live");
  frame.style.transform = `translateX(${(-75 + 50 * clamp(turn, 0, 1)).toFixed(2)}%)`;
}

function releaseFrame() {
  frame.classList.remove("is-live");
  frame.style.transform = "";
  applyPhoneFrame();
}

function clipHalf(w, h, nx, ny, midX, midY, keepPositive) {
  const inside = (x, y) => {
    const side = nx * (x - midX) + ny * (y - midY);
    return keepPositive ? side >= -0.6 : side <= 0.6;
  };
  const cross = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denom = nx * dx + ny * dy;
    const t = denom === 0 ? 0 : -(nx * (a[0] - midX) + ny * (a[1] - midY)) / denom;
    const u = clamp(t, 0, 1);
    return [a[0] + dx * u, a[1] + dy * u];
  };
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const ain = inside(a[0], a[1]);
    const bin = inside(b[0], b[1]);
    if (ain && bin) out.push(b);
    else if (ain && !bin) out.push(cross(a, b));
    else if (!ain && bin) {
      out.push(cross(a, b));
      out.push(b);
    }
  }
  return out;
}

function polygon(points) {
  if (points.length < 3) return "polygon(0px 0px, 0px 0px, 0px 0px)";
  return `polygon(${points.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(",")})`;
}

function scriptedPoint(progress, w, h, corner) {
  const p = clamp(progress, 0, 1);
  const x = w - p * w * 2.05;
  const bow = Math.sin(Math.PI * p) * (1 - p) ** 0.45;
  const lift = bow * h * 0.62;
  return corner === "top" ? { x, y: lift } : { x, y: h - lift };
}

function restSheet(sheet, turned) {
  sheet.classList.remove("is-curling");
  sheet.style.clipPath = "";
  sheet.style.transformStyle = "preserve-3d";
  sheet.style.transformOrigin = "1px center";
  sheet.style.transform = turned ? "rotateY(-180deg)" : "rotateY(0deg)";
  book.style.perspective = "3400px";
  sheet.style.setProperty("--shade", "0");
  sheet.style.setProperty("--lift", "0");
  sheet.querySelectorAll(".face:not(.curl-print)").forEach((face) => {
    face.style.clipPath = "";
    face.style.transform = "";
    face.style.transformOrigin = "";
    face.style.backfaceVisibility = "";
    face.style.overflow = "";
    face.style.visibility = "";
  });
  sheet.classList.toggle("is-turned", turned);
}

// Soft curl: the crease slides from the fore-edge to the spine.
// The spine edge never translates. The flap is the back of the sheet, folded flat across the crease.
function curl(sheet, angle, corner = "bottom", point = null) {
  const turned = angle <= -90;
  const p = clamp(Math.abs(angle) / 180, 0, 1);
  const front = sheet.querySelector(".front");
  const back = sheet.querySelector(".back");
  const w = front.offsetWidth;
  const h = front.offsetHeight;
  if (p < 0.012 || p > 0.988) {
    restSheet(sheet, p > 0.5);
    return;
  }
  const edge = corner === "top" ? "top" : "bottom";
  const origin = edge === "top" ? { x: w, y: 0 } : { x: w, y: h };
  const raw = point || scriptedPoint(p, w, h, edge);
  const target = {
    x: clamp(raw.x, -w * 1.08, w),
    y: clamp(raw.y, -h * 0.08, h * 1.08),
  };
  let vx = target.x - origin.x;
  let vy = target.y - origin.y;
  const length = Math.hypot(vx, vy);
  if (length < 4) {
    restSheet(sheet, turned);
    return;
  }
  vx /= length;
  vy /= length;
  const midX = (origin.x + target.x) / 2;
  const midY = (origin.y + target.y) / 2;
  const spineSide = clipHalf(w, h, vx, vy, midX, midY, true);
  const flapSide = clipHalf(w, h, vx, vy, midX, midY, false);
  const landed = flapSide.map(([x, y]) => {
    const along = vx * (x - midX) + vy * (y - midY);
    return [x - 2 * along * vx, y - 2 * along * vy];
  });
  sheet.classList.add("is-curling");
  front.style.visibility = "visible";
  sheet.style.clipPath = `inset(-8px 0px -8px ${-w}px)`;
  sheet.style.transform = "none";
  sheet.style.setProperty("--shade", (Math.sin(p * Math.PI) * 0.35).toFixed(3));
  sheet.style.setProperty("--lift", "0.12");
  book.style.perspective = "3400px";
  front.style.overflow = "hidden";
  front.style.transform = "";
  front.style.transformOrigin = "";
  front.style.clipPath = polygon(spineSide);
  back.style.visibility = "hidden";
  back.style.transform = "";
  back.style.clipPath = "";
  const flap = sheet.querySelector(".curl-flap");
  if (flap) {
    flap.style.left = `${-w}px`;
    flap.style.width = `${w * 2}px`;
    flap.style.clipPath = polygon(landed.map(([x, y]) => [x + w, y]));
    const print = flap.querySelector(".curl-print");
    if (print) {
      const ar = 1 - 2 * vx * vx;
      const br = -2 * vy * vx;
      const cr = -2 * vx * vy;
      const dr = 1 - 2 * vy * vy;
      const er = 2 * vx * (vx * midX + vy * midY);
      const fr = 2 * vy * (vx * midX + vy * midY);
      const a = -ar;
      const b = -br;
      const c = cr;
      const d = dr;
      const e = ar * w + er;
      const f = br * w + fr;
      print.style.left = `${w}px`;
      print.style.width = `${w}px`;
      print.style.transform = `matrix(${a.toFixed(4)}, ${b.toFixed(4)}, ${c.toFixed(4)}, ${d.toFixed(4)}, ${e.toFixed(2)}, ${f.toFixed(2)})`;
    }
  }
  const shade = sheet.querySelector(".curl-shade");
  if (shade) {
    const cast = (Math.atan2(-vx, -vy) * 180) / Math.PI;
    shade.style.transformOrigin = "0px 50%";
    shade.style.transform = `translate(${midX.toFixed(1)}px, ${midY.toFixed(1)}px) rotate(${cast.toFixed(2)}deg)`;
  }
}

const tracks = [
  {
    id: "gym",
    label: "Gymnopédie",
    src: "audio/piano-gymnopedie.mp3",
    credit: "Erik Satie, Gymnopédie số 1. Bản thu CC0.",
  },
  {
    id: "lune",
    label: "Clair de lune",
    src: "audio/piano-lune.mp3",
    credit: "Debussy, Clair de lune. Piano: Laurens Goedhart, 2011. CC BY 3.0. https://creativecommons.org/licenses/by/3.0/",
  },
  {
    id: "trang",
    label: "Ánh trăng",
    src: "audio/piano-trang.mp3",
    credit: "Beethoven, Sonata ánh trăng, chương 1. Piano: Paul Pitman. Phạm vi công cộng.",
  },
  {
    id: "nocturne",
    label: "Nokturn",
    src: "audio/piano-nocturne.mp3",
    credit: "Chopin, Nokturn Mi giáng trưởng, khúc 9 số 2. Piano: Frank Lévy. Phạm vi công cộng.",
  },
];

let audioCtx = null;
let rustle = null;
let musicAudio = null;
let musicBoost = null;
let musicOffset = 0;
let musicPaused = false;
let musicLevel = 60;
let trackId = tracks[0].id;
try {
  if (localStorage.getItem("anpham-music") === "off") musicPaused = true;
  const savedTrack = localStorage.getItem("anpham-music-track");
  if (tracks.some((track) => track.id === savedTrack)) trackId = savedTrack;
  const savedLevel = localStorage.getItem("anpham-music-volume");
  if (savedLevel !== null && Number.isFinite(Number(savedLevel))) musicLevel = clamp(Number(savedLevel), 0, 100);
} catch { /* bộ nhớ trình duyệt bị chặn */ }

function currentTrack() {
  return tracks.find((track) => track.id === trackId) || tracks[0];
}

function targetGain() {
  return (musicLevel / 100) * 2.1;
}

function rememberMusic() {
  try {
    localStorage.setItem("anpham-music", musicPaused ? "off" : "on");
    localStorage.setItem("anpham-music-track", trackId);
    localStorage.setItem("anpham-music-volume", String(musicLevel));
  } catch { /* bộ nhớ trình duyệt bị chặn */ }
}

function ensureAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function ensureMusic() {
  if (!musicAudio) {
    musicAudio = new Audio();
    musicAudio.loop = true;
    musicAudio.preload = "auto";
  }
  const track = currentTrack();
  if (musicAudio.dataset.track !== track.id) {
    // no background music in standalone github build
    musicAudio.dataset.track = track.id;
    if (musicOffset > 0) musicAudio.currentTime = musicOffset;
  }
  wireMusic();
  applyVolume();
  return musicAudio;
}

function wireMusic() {
  if (musicBoost || !musicAudio || !audioCtx) return;
  const source = audioCtx.createMediaElementSource(musicAudio);
  const comp = audioCtx.createDynamicsCompressor();
  musicBoost = audioCtx.createGain();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  source.connect(musicBoost);
  musicBoost.connect(comp);
  comp.connect(audioCtx.destination);
  musicAudio.volume = 1;
  musicBoost.gain.value = targetGain();
}

function applyVolume() {
  if (!musicAudio) return;
  if (musicBoost && audioCtx) {
    const now = audioCtx.currentTime;
    musicBoost.gain.cancelScheduledValues(now);
    musicBoost.gain.setValueAtTime(musicBoost.gain.value, now);
    musicBoost.gain.linearRampToValueAtTime(targetGain(), now + 0.05);
    return;
  }
  musicAudio.volume = Math.min(1, targetGain());
}

function startBed() {
  if (musicPaused) return;
  ensureAudio();
  const audio = ensureMusic();
  if (!audio.paused) return;
  const pending = audio.play();
  if (pending) pending.catch(() => { /* trình duyệt chờ thao tác của người xem */ });
}

function pauseBed() {
  musicPaused = true;
  if (!musicAudio) return;
  musicOffset = musicAudio.currentTime || 0;
  musicAudio.pause();
}

function resumeBed() {
  musicPaused = false;
  startBed();
}

let flipAudio = null;

function playFlip() {
  if (reduced) return;
  startBed();
  const src = window.INLINE_FLIP_SOUND || "audio/lat_giay.mp3";
  if (!flipAudio) {
    flipAudio = new Audio(src);
    flipAudio.preload = "auto";
  }
  try {
    flipAudio.currentTime = 0;
    const pending = flipAudio.play();
    if (pending) pending.catch(() => {});
  } catch { /* trình duyệt chờ thao tác của người xem */ }
}

function applySheet(sheet, angle, corner = "bottom", point = null) {
  curl(sheet, angle, corner || "bottom", point);
}

function visibleFaces() {
  const right = cursor < sheets.length ? sheets[cursor].querySelector(".front") : null;
  const left = cursor > 0 ? sheets[cursor - 1].querySelector(".back") : null;
  return { left, right };
}

function stack() {
  sheets.forEach((sheet, i) => {
    const turned = i < cursor;
    applySheet(sheet, turned ? -180 : 0);
    sheet.style.zIndex = turned ? String(20 + i) : String(60 - i);
    sheet.style.pointerEvents = i === cursor || i === cursor - 1 ? "auto" : "none";
  });
  const { left, right } = visibleFaces();
  const shown = phoneOn() ? (phoneSide === "left" ? left : right) : null;
  sheets.forEach((sheet) => {
    sheet.querySelectorAll(".face:not(.curl-print)").forEach((face) => {
      const visible = phoneOn() ? face === shown : face === left || face === right;
      face.setAttribute("aria-hidden", visible ? "false" : "true");
    });
  });
  const open = [left, right].filter(Boolean);
  const chapters = new Set(open.map((face) => face.dataset.chapter));
  if (phoneOn()) {
    const pageNo = phoneSide === "right" && cursor < sheets.length
      ? cursor * 2 + 1
      : phoneSide === "left" && cursor > 0
        ? cursor * 2
        : 0;
    status.textContent = pageNo ? `${pageNo} / ${pageCount}` : (phoneSide === "left" ? "Bìa trong" : "Hết");
  } else if (cursor === 0) status.textContent = `Trang 1 / ${pageCount}`;
  else if (cursor === sheets.length) status.textContent = `Trang ${pageCount} / ${pageCount}`;
  else status.textContent = `Trang ${cursor * 2}–${cursor * 2 + 1} / ${pageCount}`;
  applyPhoneFrame();
  updateTurnButtons();
  links.forEach((link) => {
    const face = document.getElementById(link.getAttribute("href").slice(1));
    link.classList.toggle("is-active", Boolean(face && chapters.has(face.dataset.chapter)));
  });
  runCounters(left);
  runCounters(right);
}

function remember() {
  const { left, right } = visibleFaces();
  const face = phoneOn() ? (phoneSide === "left" ? left : right) : (right || left);
  if (face?.id) history.replaceState(null, "", `#${face.id}`);
}

function glide(sheet, from, to, done, corner = "bottom", fromPoint = null) {
  busy = true;
  sheet.style.zIndex = "220";
  if (reduced) {
    applySheet(sheet, to, corner);
    done();
    return;
  }
  const page = pageBox();
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / 1000);
    const eased = easeInOut(t);
    const angle = from + (to - from) * eased;
    let point = null;
    if (fromPoint) {
      const scripted = scriptedPoint(Math.abs(angle) / 180, page.width, page.height, corner || "bottom");
      const blend = Math.min(1, t / 0.28);
      point = {
        x: fromPoint.x * (1 - blend) + scripted.x * blend,
        y: fromPoint.y * (1 - blend) + scripted.y * blend,
      };
    }
    applySheet(sheet, angle, corner, point);
    if (phoneCurl) syncFrameToTurn(Math.abs(angle) / 180);
    if (t < 1) requestAnimationFrame(frame);
    else done();
  }
  requestAnimationFrame(frame);
}

function go(to, corner = "bottom", follow = false) {
  to = clamp(to, 0, sheets.length);
  if (busy || to === cursor) {
    if (to === cursor) {
      stack();
      remember();
    }
    return;
  }
  const forward = to > cursor;
  if (reduced || Math.abs(to - cursor) > 1 || (phoneOn() && !follow)) {
    cursor = to;
    stack();
    remember();
    return;
  }
  phoneCurl = Boolean(follow);
  const sheet = sheets[forward ? cursor : cursor - 1];
  playFlip();
  glide(sheet, forward ? 0 : -180, forward ? -180 : 0, () => {
    cursor = to;
    if (follow) phoneSide = forward ? "left" : "right";
    phoneCurl = false;
    busy = false;
    book.classList.remove("is-grabbing");
    releaseFrame();
    stack();
    remember();
  }, corner);
}

function updateTurnButtons() {
  const prev = document.querySelector(".turn-prev");
  const next = document.querySelector(".turn-next");
  if (!prev || !next) return;
  if (phoneOn()) {
    prev.disabled = cursor <= 0;
    next.disabled = cursor >= sheets.length && phoneSide === "right";
  } else {
    prev.disabled = cursor <= 0;
    next.disabled = cursor >= sheets.length;
  }
}

function turnPage(direction) {
  if (phoneOn()) step(direction);
  else go(cursor + direction);
}

document.querySelector(".turn-prev")?.addEventListener("click", () => turnPage(-1));
document.querySelector(".turn-next")?.addEventListener("click", () => turnPage(1));

function step(direction) {
  if (busy) return;
  if (direction > 0) {
    if (phoneSide === "left") {
      phoneSide = "right";
      stack();
      remember();
    } else go(cursor + 1, "bottom", true);
  } else if (phoneSide === "right") {
    phoneSide = "left";
    stack();
    remember();
  } else go(cursor - 1, "bottom", true);
}

function cursorFor(id) {
  const face = document.getElementById(id);
  const sheet = face?.closest(".sheet");
  const index = sheets.indexOf(sheet);
  if (index < 0) return -1;
  return face.classList.contains("back") ? index + 1 : index;
}

function closeMenu() {
  rail.classList.remove("is-open");
  menuBtn.setAttribute("aria-expanded", "false");
  scrim.hidden = true;
}

menuBtn.addEventListener("click", () => {
  const open = !rail.classList.contains("is-open");
  rail.classList.toggle("is-open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
});
scrim.addEventListener("click", closeMenu);

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-goto], a[href^='#']");
  if (!trigger) return;
  const id = trigger.dataset.goto || trigger.getAttribute("href").slice(1);
  const next = cursorFor(id);
  if (next < 0) return;
  event.preventDefault();
  closeMenu();
  const face = document.getElementById(id);
  if (face) phoneSide = face.classList.contains("back") ? "left" : "right";
  go(next);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") phoneOn() ? step(1) : go(cursor + 1);
  if (event.key === "ArrowLeft") phoneOn() ? step(-1) : go(cursor - 1);
  if (event.key === "Escape") closeMenu();
});

book.addEventListener("pointerdown", (event) => {
  if (busy || event.button !== 0 || drag) return;
  if (event.target.closest("a, button")) return;
  if (!phoneOn()) event.preventDefault();
  const box = book.getBoundingClientRect();
  const py = (event.clientY - box.top) / box.height;
  const spine = box.left + box.width / 2;
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    side: event.clientX < spine ? "left" : "right",
    corner: py < 0.45 ? "top" : "bottom",
    radius: Math.max(72, Math.abs(event.clientX - spine)),
    active: false,
    lastX: event.clientX,
    lastT: performance.now(),
    vx: 0,
    mode: "curl",
  };
  if (!phoneOn()) {
    try { book.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
  }
});

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const now = performance.now();
  const dt = Math.max(8, now - drag.lastT);
  drag.vx = (event.clientX - drag.lastX) / dt;
  drag.lastX = event.clientX;
  drag.lastT = now;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.active) {
    if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
    const next = dx < 0 && drag.side === "right" && cursor < sheets.length;
    const prev = dx > 0 && drag.side === "left" && cursor > 0;
    const slideNext = phoneOn() && dx < 0 && drag.side === "left";
    const slidePrev = phoneOn() && dx > 0 && drag.side === "right";
    if (!next && !prev && !slideNext && !slidePrev) return;
    drag.active = true;
    if (phoneOn()) {
      event.preventDefault();
      try { book.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
    }
    if (slideNext || slidePrev) {
      drag.mode = "slide";
      drag.direction = slideNext ? "next" : "prev";
      frame.classList.add("is-live");
      book.classList.add("is-grabbing");
      return;
    }
    drag.mode = "curl";
    phoneCurl = phoneOn();
    drag.direction = next ? "next" : "prev";
    drag.sheet = sheets[next ? cursor : cursor - 1];
    drag.sheet.style.zIndex = "220";
    drag.shown = next ? 0 : -180;
    book.classList.add("is-grabbing");
    playFlip();
  }
  if (drag.mode === "slide") {
    const width = pageBox().width || 1;
    const shift = clamp((phoneSide === "left" ? -25 : -75) + ((event.clientX - drag.x) / width) * 50, -75, -25);
    frame.classList.add("is-live");
    frame.style.transform = `translateX(${shift.toFixed(2)}%)`;
    drag.shift = shift;
    return;
  }
  const page = pageBox();
  const local = { x: event.clientX - page.left, y: event.clientY - page.top };
  const progress = clamp((page.width - local.x) / (page.width * 2), 0, 1);
  drag.shown = -progress * 180;
  drag.point = local;
  applySheet(drag.sheet, drag.shown, drag.corner, local);
  if (phoneCurl) syncFrameToTurn(progress);
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const state = drag;
  drag = null;
  if (!state.active) {
    book.classList.remove("is-grabbing");
    return;
  }
  if (state.mode === "slide") {
    const width = pageBox().width || 1;
    const progress = Math.abs(state.lastX - state.x) / width;
    const flicked = state.direction === "next" ? state.vx < -0.35 : state.vx > 0.35;
    book.classList.remove("is-grabbing");
    if (progress > 0.22 || flicked) phoneSide = state.direction === "next" ? "right" : "left";
    releaseFrame();
    stack();
    remember();
    return;
  }
  const progress = state.direction === "next"
    ? Math.abs(state.shown) / 180
    : (state.shown + 180) / 180;
  const flicked = state.direction === "next" ? state.vx < -0.45 : state.vx > 0.45;
  const commit = progress >= 0.5 || (flicked && progress > 0.12);
  const dest = state.direction === "next" ? (commit ? -180 : 0) : (commit ? 0 : -180);
  const cursorBefore = cursor;
  const to = commit ? cursor + (state.direction === "next" ? 1 : -1) : cursor;
  glide(state.sheet, state.shown, dest, () => {
    cursor = to;
    if (phoneOn() && to !== cursorBefore) phoneSide = state.direction === "next" ? "left" : "right";
    phoneCurl = false;
    busy = false;
    book.classList.remove("is-grabbing");
    releaseFrame();
    stack();
    remember();
  }, state.corner, state.point);
}

window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);

sheets.forEach((sheet) => {
  const flap = document.createElement("div");
  flap.className = "curl-flap";
  flap.setAttribute("aria-hidden", "true");
  const print = sheet.querySelector(".back").cloneNode(true);
  print.classList.add("curl-print");
  print.removeAttribute("id");
  print.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  print.inert = true;
  flap.appendChild(print);
  sheet.appendChild(flap);
  const shade = document.createElement("div");
  shade.className = "curl-shade";
  shade.setAttribute("aria-hidden", "true");
  sheet.appendChild(shade);
});

let hoverOn = false;
book.addEventListener("pointermove", (event) => {
  if (drag || busy || reduced || phoneOn()) return;
  const page = pageBox();
  const box = book.getBoundingClientRect();
  const y = (event.clientY - box.top) / box.height;
  const corner = y < 0.5 ? "top" : "bottom";
  const onRight = cursor < sheets.length && event.clientX > page.left + page.width * 0.84 && event.clientX < page.left + page.width + 12;
  const onLeft = cursor > 0 && event.clientX < box.left + page.width * 0.16 && event.clientX > box.left - 12;
  if (!onRight && !onLeft) {
    if (hoverOn) {
      hoverOn = false;
      stack();
    }
    return;
  }
  hoverOn = true;
  const sheet = sheets[onRight ? cursor : cursor - 1];
  sheet.style.zIndex = "220";
  const progress = onRight ? 0.07 : 0.93;
  applySheet(sheet, -progress * 180, corner);
});
book.addEventListener("pointerleave", () => {
  if (drag || busy || !hoverOn) return;
  hoverOn = false;
  stack();
});

const musicTrack = document.querySelector("#music-track");
const musicToggle = document.querySelector("#music-toggle");
const musicSpeaker = document.querySelector("#music-speaker");
const musicVolume = document.querySelector("#music-volume");
let volumeBeforeMute = musicLevel > 0 ? musicLevel : 60;

tracks.forEach((track) => {
  const option = document.createElement("option");
  option.value = track.id;
  option.textContent = track.label;
  option.title = track.credit;
  musicTrack.appendChild(option);
});

const iconPlay = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12 8 5.2z"/></svg>`;
const iconPause = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5h3.4v14H6.5zm7.6 0H17.5v14h-3.4z"/></svg>`;
const iconVolDown = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.4h2.8L11 6v12l-4.2-3.4H4z"/><path d="M14 9.5a3.4 3.4 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const iconVolMute = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.4h2.8L11 6v12l-4.2-3.4H4z"/><path d="M15 9.5l5 5M20 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const iconVolUp = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.4h2.6L10 6v12l-4.4-3.4H3z"/><path d="M13 8.2a5.2 5.2 0 0 1 0 7.6M15.6 6a8.2 8.2 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

function showMusic() {
  musicTrack.value = trackId;
  musicTrack.title = currentTrack().credit;
  musicToggle.innerHTML = musicPaused ? iconPlay : iconPause;
  musicToggle.setAttribute("aria-pressed", String(!musicPaused));
  musicToggle.setAttribute("aria-label", musicPaused ? "Tiếp tục nhạc nền" : "Tạm dừng nhạc nền");
  musicVolume.value = String(musicLevel);
  musicVolume.style.setProperty("--vol", `${musicLevel}%`);
  musicVolume.setAttribute("aria-valuenow", String(musicLevel));
  musicVolume.setAttribute("aria-valuetext", `${musicLevel}%`);
  musicSpeaker.innerHTML = musicLevel <= 0 ? iconVolMute : musicLevel < 45 ? iconVolDown : iconVolUp;
  musicSpeaker.setAttribute("aria-pressed", String(musicLevel <= 0));
  musicSpeaker.setAttribute("aria-label", musicLevel <= 0 ? "Bật âm lượng" : "Tắt tiếng");
}
showMusic();

musicTrack.addEventListener("change", () => {
  if (!tracks.some((track) => track.id === musicTrack.value)) return;
  trackId = musicTrack.value;
  musicOffset = 0;
  if (musicAudio) {
    musicAudio.pause();
    musicAudio.dataset.track = "";
  }
  rememberMusic();
  if (!musicPaused) startBed();
  showMusic();
});
musicToggle.addEventListener("click", () => {
  if (musicPaused) resumeBed();
  else pauseBed();
  rememberMusic();
  showMusic();
});
musicVolume.addEventListener("input", () => {
  musicLevel = clamp(Number(musicVolume.value), 0, 100);
  if (musicLevel > 0) volumeBeforeMute = musicLevel;
  applyVolume();
  rememberMusic();
  showMusic();
});
musicSpeaker.addEventListener("click", () => {
  if (musicLevel <= 0) musicLevel = volumeBeforeMute || 60;
  else {
    volumeBeforeMute = musicLevel;
    musicLevel = 0;
  }
  applyVolume();
  rememberMusic();
  showMusic();
});
ensureMusic();
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".music-bar")) return;
  if (!musicPaused) startBed();
});

const opened = document.getElementById(location.hash.slice(1));
if (opened?.classList.contains("back")) phoneSide = "left";
const initial = cursorFor(location.hash.slice(1));
cursor = initial >= 0 ? initial : 0;
stack();
remember();
phoneQuery.addEventListener("change", () => {
  releaseFrame();
  stack();
});

// Background progressive preloader for remaining pages after initial load
window.addEventListener("load", () => {
  setTimeout(() => {
    document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
      img.loading = "eager";
    });
  }, 600);
});
