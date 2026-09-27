// Functional regression suite for the Ahia Aylon site (headless Chrome).
// Usage: node qa/func.cjs [siteDir]   (default: ../dist next to this file)
// Never hits the real form endpoint: window.fetch is stubbed before submit.
const path = require("path"), fs = require("fs"), http = require("http");
const puppeteer = require("C:/Users/zvi29/OneDrive/Desktop/תכנות/פרויקטים אישיים/0.2 NZ-web/NZ-web 1.2/node_modules/puppeteer-core");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain" };
const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));
const requested = [];
const serve = () => new Promise((r) => {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    requested.push(p);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(dir, p);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  s.listen(0, "127.0.0.1", () => r(s));
});
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });

  const open = async (url, vp, opts = {}) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });
    await page.setViewport(vp);
    if (opts.reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(base + url, { waitUntil: "load" });
    await sleep(1200);
    return { page, ctx, errors };
  };
  const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const DESK = { width: 1440, height: 900, deviceScaleFactor: 1 };
  const to = async (page, y) => { await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), y); await frames(page, 4); await sleep(250); };
  const progress = (page) => page.evaluate(() => { const m = getComputedStyle(document.querySelector(".scroll-progress span")).transform; return m === "none" ? 1 : +new DOMMatrix(m).a.toFixed(3); });

  // ---------------------------------------------------------------- mobile
  {
    const { page, ctx, errors } = await open("", MOBILE);
    await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => (i.loading = "eager")));
    await sleep(800);
    check("mobile: header not scrolled at top", !(await page.$eval("[data-header]", (h) => h.classList.contains("is-scrolled"))));
    await to(page, 100);
    check("mobile: header .is-scrolled after 100px", await page.$eval("[data-header]", (h) => h.classList.contains("is-scrolled")));
    await to(page, 15);
    check("mobile: header back to normal at 15px", !(await page.$eval("[data-header]", (h) => h.classList.contains("is-scrolled"))));

    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await to(page, 0); const p0 = await progress(page);
    await to(page, Math.round(max / 2)); const p50 = await progress(page);
    await to(page, max); const p100 = await progress(page);
    check("mobile: progress bar 0 → .5 → 1", p0 <= 0.01 && Math.abs(p50 - 0.5) < 0.03 && p100 >= 0.99, `${p0} / ${p50} / ${p100}`);
    const origin = await page.$eval(".scroll-progress span", (e) => getComputedStyle(e).transformOrigin);
    check("mobile: progress grows from the right edge (RTL)", origin.startsWith("390px"), origin);

    // off-screen loop pause
    await to(page, 0);
    const heroOff0 = await page.$eval(".hero", (h) => h.classList.contains("is-offscreen"));
    await to(page, 5200);
    const heroOff1 = await page.$eval(".hero", (h) => h.classList.contains("is-offscreen"));
    const tickerOff1 = await page.$eval(".ticker", (h) => h.classList.contains("is-offscreen"));
    const orbitState = await page.$eval(".orbit-one", (e) => getComputedStyle(e).animationPlayState);
    check("mobile: hero/ticker loops pause off-screen", !heroOff0 && heroOff1 && tickerOff1 && orbitState === "paused", `${heroOff0} ${heroOff1} ${tickerOff1} ${orbitState}`);
    await to(page, 0);
    const orbitBack = await page.$eval(".orbit-one", (e) => getComputedStyle(e).animationPlayState);
    check("mobile: loops resume back at the hero", orbitBack === "running", orbitBack);

    // sticky stack geometry
    const trackTop = await page.$eval(".journey-track", (e) => e.getBoundingClientRect().top + scrollY);
    const cardH = await page.$eval(".journey-card", (e) => e.offsetHeight);
    const gap = await page.$eval(".journey-track", (e) => parseFloat(getComputedStyle(e).rowGap));
    await to(page, Math.round(trackTop + 3 * (cardH + gap) - 114));
    const tops = await page.$$eval(".journey-card", (cs) => cs.map((c) => Math.round(c.getBoundingClientRect().top)));
    check("mobile: all 4 cards stacked at 84/94/104/114", JSON.stringify(tops) === "[84,94,104,114]", JSON.stringify(tops));
    const styles = await page.$$eval(".journey-card", (cs) => cs.map((c) => { const s = getComputedStyle(c); return [s.position, s.opacity, getComputedStyle(c.querySelector(".journey-card-copy")).opacity, getComputedStyle(c.querySelector(".journey-card-top")).opacity].join(","); }));
    check("mobile: cards sticky, opaque, copy + chips visible", styles.every((s) => s === "sticky,1,1,1"), styles.join(" | "));
    const depth = await page.$$eval(".journey-card", (cs) => cs.map((c) => getComputedStyle(c).scale + "/" + (+getComputedStyle(c, "::after").opacity).toFixed(2)));
    check("mobile: covered cards dimmed+scaled, top card clean", depth[0] === "0.94/0.42" && depth[1] === "0.94/0.42" && depth[2] === "0.94/0.42" && /^(none|1)\//.test(depth[3]), depth.join(" "));
    const status = await page.$eval(".journey-scroll-status", (e) => getComputedStyle(e).display);
    check("mobile: old carousel dots hidden", status === "none", status);

    // menu: real scroll lock, stack stays stuck
    const yBefore = await page.evaluate(() => scrollY);
    await page.click(".menu-toggle");
    await frames(page, 3);
    const lock = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).overflowY, body: getComputedStyle(document.body).overflowY, open: document.body.classList.contains("menu-open") }));
    const topsMenu0 = await page.$$eval(".journey-card", (cs) => cs.map((c) => Math.round(c.getBoundingClientRect().top)));
    await page.mouse.move(195, 600);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: 200 }); await sleep(80); }
    await sleep(400);
    const yDuring = await page.evaluate(() => scrollY);
    const topsMenu = await page.$$eval(".journey-card", (cs) => cs.map((c) => Math.round(c.getBoundingClientRect().top)));
    check("mobile: menu open locks the page (html overflow hidden, body not a scroller)", lock.open && lock.html === "hidden" && lock.body === "visible" && yDuring === yBefore, JSON.stringify(lock) + ` y ${yBefore}->${yDuring}`);
    check("mobile: stacked cards stay put while the menu is open", JSON.stringify(topsMenu0) === "[84,94,104,114]" && JSON.stringify(topsMenu) === "[84,94,104,114]", JSON.stringify(topsMenu0) + " " + JSON.stringify(topsMenu));
    const navVisible = await page.$eval(".main-nav", (n) => getComputedStyle(n).visibility);
    check("mobile: menu panel visible", navVisible === "visible", navVisible);
    await page.keyboard.press("Escape");
    await frames(page, 3);
    const unlocked = await page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: 200 }); await sleep(80); }
    await sleep(400);
    const yAfter = await page.evaluate(() => scrollY);
    check("mobile: menu closed → page scrolls again", unlocked !== "hidden" && yAfter > yBefore, `${unlocked} y ${yAfter}`);


    // requests: grain tile loaded, dead symbols font not requested
    check("mobile: hero-grain.webp requested", requested.includes("/assets/hero-grain.webp"));
    check("mobile: unused symbols font not requested", !requested.some((r) => r.includes("symbols")));
    check("mobile: no console errors / failed requests", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- tablet touch: invisible WhatsApp label
  {
    const { page, ctx } = await open("", { width: 700, height: 1000, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const hit = await page.evaluate(() => {
      const l = document.querySelector(".whatsapp-label").getBoundingClientRect();
      const i = document.querySelector(".whatsapp-icon").getBoundingClientRect();
      const onLabel = document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2);
      const onIcon = document.elementFromPoint(i.left + i.width / 2, i.top + i.height / 2);
      return { labelW: Math.round(l.width), label: !!onLabel?.closest(".whatsapp-float"), icon: !!onIcon?.closest(".whatsapp-float") };
    });
    check("tablet touch: invisible WhatsApp label no longer catches taps, icon still does", hit.labelW > 50 && !hit.label && hit.icon, JSON.stringify(hit));
    await ctx.close();
  }

  // ---------------------------------------------------------------- FAQ + form + modal (mobile)
  {
    const { page, ctx, errors } = await open("", MOBILE);
    const sums = await page.$$(".faq-list summary");
    await sums[0].click(); await sleep(150); await sums[1].click(); await sleep(150);
    const openStates = await page.$$eval(".faq-list details", (d) => d.map((x) => x.open));
    check("faq: only one answer open at a time", JSON.stringify(openStates) === "[false,true,false,false]", JSON.stringify(openStates));

    await page.evaluate(() => { window.__fetchCalls = []; window.fetch = (url, init) => { window.__fetchCalls.push(String(url)); return Promise.resolve(new Response(JSON.stringify({ success: "true" }), { status: 200, headers: { "Content-Type": "application/json" } })); }; });
    await page.$eval(".form-submit", (b) => b.scrollIntoView({ block: "center" }));
    await page.click(".form-submit");
    await sleep(200);
    const invalid = await page.evaluate(() => ({ status: document.querySelector(".form-status").classList.contains("is-visible"), errs: document.querySelectorAll(".lead-form label.has-error").length, calls: window.__fetchCalls.length }));
    check("form: empty submit shows errors, sends nothing", invalid.status && invalid.errs === 3 && invalid.calls === 0, JSON.stringify(invalid));
    await page.type("input[name=name]", "בדיקה אוטומטית");
    await page.type("input[name=phone]", "050-000-0000");
    await page.type("textarea[name=dream_car]", "בדיקה בלבד — לא לשלוח");
    await page.click(".form-submit");
    await sleep(700);
    const sent = await page.evaluate(() => ({ calls: window.__fetchCalls, modal: !document.querySelector("#success-modal").hidden, bodyCls: document.body.classList.contains("modal-open"), html: getComputedStyle(document.documentElement).overflowY, wa: getComputedStyle(document.querySelector(".whatsapp-icon"), "::after").animationPlayState }));
    check("form: valid submit → stubbed Netlify Forms POST, success modal, page locked, pulse paused", sent.calls.length === 1 && sent.calls[0] === "/" && sent.modal && sent.bodyCls && sent.html === "hidden" && sent.wa === "paused", JSON.stringify(sent));
    await page.click("[data-close-success]");
    await sleep(600);
    const closed = await page.evaluate(() => ({ hidden: document.querySelector("#success-modal").hidden, html: getComputedStyle(document.documentElement).overflowY }));
    check("form: modal closes and unlocks", closed.hidden && closed.html !== "hidden", JSON.stringify(closed));
    check("form page: no console errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- reduced motion
  {
    const { page, ctx, errors } = await open("", MOBILE, { reduced: true });
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await to(page, Math.round(max / 2));
    const p = await progress(page);
    check("reduced motion: progress bar still tracks", Math.abs(p - 0.5) < 0.03, String(p));
    const trackTop = await page.$eval(".journey-track", (e) => e.getBoundingClientRect().top + scrollY);
    await to(page, Math.round(trackTop + 1200));
    const depth = await page.$$eval(".journey-card", (cs) => cs.map((c) => getComputedStyle(c).scale + "/" + getComputedStyle(c).position + "/" + getComputedStyle(c.querySelector(".journey-card-copy")).opacity));
    check("reduced motion: plain sticky stack, no depth animation, copy visible", depth.every((d) => /^none\/sticky\/1$/.test(d)), depth.join(" "));
    check("reduced motion: no console errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- desktop
  {
    const { page, ctx, errors } = await open("", DESK);
    await to(page, 100);
    check("desktop: header .is-scrolled after 100px", await page.$eval("[data-header]", (h) => h.classList.contains("is-scrolled")));
    const grid = await page.$$eval(".journey-card", (cs) => cs.map((c) => getComputedStyle(c).position + ":" + getComputedStyle(c).scale + ":" + Math.round(c.getBoundingClientRect().width)));
    check("desktop: journey bento grid untouched (no sticky / no scale)", grid.every((g) => g.startsWith("relative:none:")), grid.join(" "));
    const priceTop = await page.$eval("#price", (e) => e.getBoundingClientRect().top + scrollY);
    await to(page, Math.round(priceTop));
    await sleep(300);
    const activePrice = await page.$$eval(".main-nav a.is-active", (a) => a.map((x) => x.getAttribute("href")));
    await to(page, 0);
    await sleep(300);
    const activeTop = await page.$$eval(".main-nav a.is-active", (a) => a.map((x) => x.getAttribute("href")));
    check("desktop: nav highlights #price, clears back at the hero", JSON.stringify(activePrice) === '["#price"]' && activeTop.length === 0, JSON.stringify(activePrice) + " / " + JSON.stringify(activeTop));
    const hoverOk = await page.evaluate(() => matchMedia("(hover: hover)").matches);
    check("desktop: hover media matches (hover effects kept)", hoverOk);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check("desktop: no horizontal overflow", noOverflow);
    check("desktop: no console errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- old-browser simulation: no overflow-x:clip support
  {
    const { page, ctx } = await open("", MOBILE);
    await page.addStyleTag({ content: "html,body,main{overflow-x:visible!important}" });
    await frames(page, 2);
    const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
    check("no-clip browsers: honeypot no longer widens the page", sw.sw <= sw.w + 20, JSON.stringify(sw));
    await ctx.close();
  }

  // ---------------------------------------------------------------- legal pages
  for (const p of ["privacy.html", "accessibility.html", "404.html"]) {
    const { page, ctx, errors } = await open(p, MOBILE);
    const hasHeader = await page.$("[data-header]");
    if (hasHeader && p !== "404.html") {
      await to(page, 200);
      check(`${p}: header .is-scrolled after scroll`, await page.$eval("[data-header]", (h) => h.classList.contains("is-scrolled")));
    }
    check(`${p}: no console errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
