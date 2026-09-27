// Mobile scroll/load perf harness for the Ahia Aylon site.
// Usage: node qa/perf.cjs [url|siteDir] [label] [cpuThrottle] [runs]   (default: ../dist)
// Env: SWR=1 software raster (low-end GPU proxy), ABLATE_CSS="..." inject CSS, VW/VH viewport,
//      NORAF=1 skip the rAF frame sampler. "missed" = rAF-sampled vsync misses (use with SWR=1, 60Hz);
//      ccDropped counts every dropped pipeline frame incl. ones Chrome marks as not affecting smoothness.
// Emulates a mid-range phone (390x844 @3x, touch, CPU throttled), then
// synthesizes touch-scroll gestures through each section and reports
// frame pacing + main-thread cost per segment.
const path = require("path");
const fs = require("fs");
const puppeteer = require(path.join(
  "C:/Users/zvi29/OneDrive/Desktop/תכנות/פרויקטים אישיים/0.2 NZ-web/NZ-web 1.2/node_modules/puppeteer-core"
));

// argv[2] may be a URL or a local directory (served in-process on an ephemeral port)
let url = process.argv[2] || path.join(__dirname, "..", "dist");
const http = require("http");
let server = null;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml" };
async function maybeServe() {
  if (/^https?:/.test(url)) return;
  const root = path.resolve(url);
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
}
const label = process.argv[3] || "run";
const cpu = Number(process.argv[4] || 4);
const runs = Number(process.argv[5] || 2);
const width = Number(process.env.VW || 390);
const height = Number(process.env.VH || 844);
const OUT = path.join(require("os").tmpdir(), "ahia-perf-results");
fs.mkdirSync(OUT, { recursive: true });

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
};

async function traceSegment(page, client, name, fromY, toY, speed) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), fromY);
  await new Promise((r) => setTimeout(r, 700));
  if (!process.env.NORAF) await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__rafOn = true;
    const loop = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__rafOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const tracePath = path.join(OUT, `${label}-${name}.json`);
  await page.tracing.start({
    path: tracePath,
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "blink",
      "cc",
      "gpu",
      "toplevel"
    ]
  });
  const distance = toY - fromY;
  await client.send("Input.synthesizeScrollGesture", {
    x: Math.round(width / 2),
    y: Math.round(height * 0.7),
    yDistance: -Math.round(distance / 2),
    speed,
    gestureSourceType: "mouse",
    repeatCount: 1
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.tracing.stop();
  const frames = process.env.NORAF ? [] : await page.evaluate(() => {
    window.__rafOn = false;
    return window.__frames.slice(2);
  });
  const endY = await page.evaluate(() => window.scrollY);

  // Main-thread + raster breakdown from the trace
  const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
  const events = trace.traceEvents || trace;
  const sums = {};
  let dropped = 0;
  let presented = 0;
  const states = {};
  const add = (k, d) => (sums[k] = (sums[k] || 0) + d);
  for (const e of events) {
    if (e.name === "PipelineReporter" && e.ph === "b") {
      const fr = e.args?.frame_reporter || e.args?.chrome_frame_reporter || {};
      if (fr.frame_type === "FORKED") continue; // one entry per vsync
      const st = fr.state;
      states[st] = (states[st] || 0) + 1;
      if (st === "STATE_DROPPED") dropped++;
      if (st === "STATE_PRESENTED_ALL" || st === "STATE_PRESENTED_PARTIAL") presented++;
    }
    if (e.dur == null) continue;
    const ms = e.dur / 1000;
    switch (e.name) {
      case "UpdateLayoutTree":
      case "RecalculateStyles":
        add("style", ms); break;
      case "Layout":
        add("layout", ms); break;
      case "Paint":
        add("paint", ms); break;
      case "PrePaint":
        add("prepaint", ms); break;
      case "Layerize":
      case "UpdateLayer":
      case "CompositeLayers":
        add("composite", ms); break;
      case "RasterTask":
      case "Rasterize":
        add("raster", ms); break;
      case "ImageDecodeTask":
      case "Decode Image":
        add("decode", ms); break;
      case "FunctionCall":
      case "EvaluateScript":
      case "FireAnimationFrame":
        add("script", ms); break;
      case "RunTask":
        if (ms > 50) add("longTasks>50ms", 1);
        break;
    }
  }
  fs.unlinkSync(tracePath);
  Object.keys(sums).forEach((k) => (sums[k] = +sums[k].toFixed(1)));
  const jank = frames.filter((f) => f > 34).length;
  const med = pct(frames, 50) || 7;
  const missed = frames.reduce((n, f) => n + (f > med * 1.6 ? Math.round(f / med) - 1 : 0), 0);
  const scrolled = Math.abs(endY - fromY);
  return {
    segment: name,
    from: fromY,
    to: toY,
    endY,
    frames: frames.length,
    p50: pct(frames, 50),
    p95: pct(frames, 95),
    max: pct(frames, 100),
    over34ms: jank,
    missedVsyncs: missed,
    missedPct: +((missed / Math.max(1, frames.length + missed)) * 100).toFixed(1),
    scrolled,
    states,
    jankPct: frames.length ? +((jank / frames.length) * 100).toFixed(1) : 0,
    droppedFramesTrace: dropped,
    presentedTrace: presented,
    thread: sums
  };
}

(async () => {
  await maybeServe();
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: process.env.SWR
      ? ["--no-first-run", "--hide-scrollbars", "--disable-gpu", "--disable-gpu-compositing"]
      : ["--no-first-run", "--hide-scrollbars", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]
  });
  const all = [];
  for (let run = 0; run < runs; run++) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const client = await page.createCDPSession();
    await page.setViewport({ width, height, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36"
    );
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    if (process.env.ABLATE_CSS) {
      await page.evaluateOnNewDocument((css) => {
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = css;
          document.head.appendChild(st);
        });
      }, process.env.ABLATE_CSS);
    }
    await page.evaluateOnNewDocument(() => {
      window.__lt = [];
      window.__lcp = 0;
      window.__cls = 0;
      try {
        new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true });
      } catch (e) {}
    });
    const t0 = Date.now();
    await page.goto(url + (url.includes("?") ? "&" : "?") + "r=" + t0, { waitUntil: "load", timeout: 60000 });
    const loadMs = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 3000));
    const load = await page.evaluate(() => ({
      lcp: Math.round(window.__lcp),
      cls: +window.__cls.toFixed(3),
      longTasks: window.__lt.length,
      tbt: Math.round(window.__lt.reduce((s, d) => s + Math.max(0, d - 50), 0)),
      docHeight: document.documentElement.scrollHeight
    }));
    const geo = await page.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY) };
      };
      return { hero: r(".hero"), journey: r(".journey"), manifesto: r(".manifesto"), doc: document.documentElement.scrollHeight - innerHeight };
    });
    const segs = [];
    segs.push(await traceSegment(page, client, "hero", 0, geo.journey.top - 200, 1400));
    segs.push(await traceSegment(page, client, "journey", geo.journey.top - 200, geo.journey.bottom - 300, 1400));
    segs.push(await traceSegment(page, client, "rest", geo.journey.bottom - 300, geo.doc, 1800));
    all.push({ run, loadMs, load, geo, segs });
    await context.close();
  }
  await browser.close();
  if (server) server.close();
  const outFile = path.join(OUT, `${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(all, null, 2));
  for (const r of all) {
    console.log(`\n[${label}] run ${r.run} cpu x${cpu} ${width}x${height}  load=${r.loadMs}ms`, JSON.stringify(r.load), "geo", JSON.stringify(r.geo));
    for (const s of r.segs) {
      console.log(
        `  ${s.segment.padEnd(8)} ${s.from}->${s.to} (end ${s.endY}) frames=${s.frames} p50=${s.p50} p95=${s.p95} max=${s.max} >34ms=${s.over34ms} (${s.jankPct}%) missed=${s.missedVsyncs} (${s.missedPct}%) scrolled=${s.scrolled} ccDropped=${s.droppedFramesTrace}/${s.droppedFramesTrace + s.presentedTrace} (${((100 * s.droppedFramesTrace) / Math.max(1, s.droppedFramesTrace + s.presentedTrace)).toFixed(1)}%)`,
        JSON.stringify(s.thread), JSON.stringify(s.states)
      );
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
