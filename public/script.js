import * as pdfjs from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";

const socket = io();
const viewer = document.getElementById("viewer");
const pageBadge = document.getElementById("pageBadge");
const btnPrev = document.getElementById("prev");
const btnNext = document.getElementById("next");
const btnLead = document.getElementById("lead")
const btnFollow = document.getElementById("follow")
const btnSolo = document.getElementById("solo")

let lastEmittedPage = null;      // last page we sent to server
let pendingEmitPage = null;      // page waiting to be emitted after debounce
let emitTimer = null;            // debounce timer id
const EMIT_DEBOUNCE_MS = 200;    // wait for this many ms of stability before emitting




const PDF_URL = "/repertuar1.pdf";

let pdfDoc = null;
let totalPages = 0;
let pageEls = [];         
let currentPage = 1;
let isScrollingFromSync = false;  //da ignoriramo pgrogramski scroll (da ne emit'amo iste strani še enkrat)
let pendingInitPage = null;      //stran pdf-ja če jo dobimo preden se pdf nalozi
let state = 0; // 0-follow 1-lead 2-solo

//const updateBadge = () => pageBadge.textContent = `${currentPage} / ${totalPages || "–"}`;


function updateBadge() {
  const total = totalPages || "–";
  pageBadge.textContent = `${currentPage} / ${total}`;
}


function changeState(newState) {
  // If user wants to become leader -> confirm then request server
  if (newState === 1) {
    if (!confirm("Želiš voditi špil?")) return;

    // choose page to lead from (prefer visible page)
    const pageToEmit = (Array.isArray(pageEls) && pageEls.length && typeof getPrimaryVisiblePage === "function")
      ? getPrimaryVisiblePage()
      : currentPage;

    socket.emit("pdf:become-leader", pageToEmit);

    // DON'T locally set state = 1 here — wait for server to confirm via 'leader:changed'
    return;
  }

  // For follow/solo we can set locally
  state = newState;

  const ids = ["follow", "lead", "solo"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.backgroundColor = "rgb(179, 159, 198)";
  }
  const activeId = ids[state];
  const activeEl = document.getElementById(activeId);
  if (activeEl) activeEl.style.backgroundColor = "rgb(147, 77, 212)";

  console.log("Current state:", state);
}


btnLead.addEventListener("click", () => changeState(1));
btnFollow.addEventListener("click", () => changeState(0));
btnSolo.addEventListener("click", () => changeState(2));

changeState(state);

//tipke
document.addEventListener("keydown", function(event) {
if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    document.getElementById("prev").click();
}
if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    document.getElementById("next").click();
}
});

async function renderPage(num) {
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: 2 });

    const wrapper = document.createElement("div");
    wrapper.className = "page";
    wrapper.dataset.pageNumber = String(num);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    wrapper.appendChild(canvas);
    viewer.appendChild(wrapper);

    await page.render({ canvasContext: ctx, viewport }).promise;
    pageEls.push({ num, el: wrapper, canvas });
}

async function loadPdf() {
    const task = pdfjs.getDocument(PDF_URL);
    pdfDoc = await task.promise;
    totalPages = pdfDoc.numPages;
    updateBadge();

    for (let i = 1; i <= totalPages; i++) {
    await renderPage(i);
    }

    if (pendingInitPage != null) {
    scrollToPage(pendingInitPage, false);
    pendingInitPage = null;
    } else {
    scrollToPage(1, false);
    }
}

function getPrimaryVisiblePage() {
    const containerRect = viewer.getBoundingClientRect();
    let best = { num: 1, overlap: -Infinity };
    for (const { num, el } of pageEls) {
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, containerRect.top);
    const bottom = Math.min(r.bottom, containerRect.bottom);
    const visible = Math.max(0, bottom - top);
    if (visible > best.overlap) best = { num, overlap: visible };
    }
    return best.num;
}

function throttle(fn, ms) {
    let last = 0, timer = null;
    return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
        last = now; fn(...args);
    } else if (!timer) {
        const wait = ms - (now - last);
        timer = setTimeout(() => { last = Date.now(); timer = null; fn(...args); }, wait);
    }
    };
}
 
function scrollToPage(num, smooth = true) {
    const entry = pageEls.find(p => p.num === num);
    if (!entry) {
    pendingInitPage = num;
    return;
    }
    isScrollingFromSync = true;
    entry.el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    setTimeout(() => { isScrollingFromSync = false; }, 400);
    currentPage = num;
    updateBadge();
}

viewer.addEventListener("scroll", throttle(() => {
  if (isScrollingFromSync) return;

  const visible = getPrimaryVisiblePage();
  if (visible !== currentPage) {
    currentPage = visible;
    updateBadge();

    if (state === 1) { // only leaders emit
      pendingEmitPage = visible;

      if (emitTimer) clearTimeout(emitTimer);
      emitTimer = setTimeout(() => {
        if (pendingEmitPage != null && pendingEmitPage !== lastEmittedPage) {
          socket.emit("pdf:page", pendingEmitPage);
          lastEmittedPage = pendingEmitPage;
          console.log("Leader emitted page (debounced):", pendingEmitPage);
        }
        pendingEmitPage = null;
        emitTimer = null;
      }, EMIT_DEBOUNCE_MS);
    }
  }
}, 150));

btnPrev.addEventListener("click", () => {
  const nextNum = Math.max(1, currentPage - 1);
  scrollToPage(nextNum);

  if (state === 1) {
    if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; pendingEmitPage = null; }
    if (nextNum !== lastEmittedPage) {
      socket.emit("pdf:page", nextNum);
      lastEmittedPage = nextNum;
      console.log("Leader emitted page (button):", nextNum);
    }
  }
});

btnNext.addEventListener("click", () => {
  const nextNum = Math.min(totalPages, currentPage + 1);
  scrollToPage(nextNum);

  if (state === 1) {
    if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; pendingEmitPage = null; }
    if (nextNum !== lastEmittedPage) {
      socket.emit("pdf:page", nextNum);
      lastEmittedPage = nextNum;
      console.log("Leader emitted page (button):", nextNum);
    }
  }
});


socket.on("pdf:page", (pageNum) => {
    if (state !== 0) return;
    if (pageNum !== currentPage) scrollToPage(pageNum);
});

socket.on("pdf:init", ({ page }) => {
    if (page) scrollToPage(page, false);
});

socket.on("connect", () => console.log("socket connected", socket.id));
socket.on("disconnect", () => console.log("socket disconnected"));

// when server says "this is the leader now"
socket.on("leader:changed", ({ leaderId, page }) => {
  if (leaderId === socket.id) {
    // we are the leader
    state = 1;
    console.log("You are now leader. Page:", page);
    // update UI buttons
    const ids = ["follow", "lead", "solo"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.backgroundColor = "rgb(179, 159, 198)";
    }
    const activeEl = document.getElementById("lead");
    if (activeEl) activeEl.style.backgroundColor = "rgb(147, 77, 212)";
    // ensure server and others are synced
    if (page && page !== currentPage) scrollToPage(page);
  } else {
    // someone else is leader -> we must be follower
    const ids = ["follow", "lead", "solo"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.backgroundColor = "rgb(179, 159, 198)";
    }
    const activeEl = document.getElementById("follow");
    if (activeEl) activeEl.style.backgroundColor = "rgb(147, 77, 212)";

    state = 0; // follow
    console.log("Leader changed:", leaderId, "we are follower now.");
    // follow the new leader's page immediately
    if (typeof page === "number" && page !== currentPage) scrollToPage(page);
  }
});

// optional: when leader disconnects
socket.on("leader:left", () => {
  console.log("Leader left — no active leader now.");
  // you can choose default behavior: remain follower, or enable users to become leader
  // e.g. set UI to follow by default:
  state = 0;
  const ids = ["follow", "lead", "solo"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.backgroundColor = "rgb(179, 159, 198)";
  }
  const activeEl = document.getElementById("follow");
  if (activeEl) activeEl.style.backgroundColor = "rgb(147, 77, 212)";
});


loadPdf().catch(err => {
    console.error("Failed to load PDF:", err);
    alert("Failed to load PDF. Put a file at /public/sample.pdf or change PDF_URL.");
});