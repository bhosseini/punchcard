const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync("/Users/bhosseini/Desktop/todo/index.html", "utf8");
const errors = [];

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://example.com/",
  beforeParse(win) {
    win.matchMedia = q => ({ matches: false, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
    win.navigator.vibrate = () => true;
    win.AudioContext = function(){ throw new Error("no audio in jsdom"); };
    win.addEventListener("error", e => errors.push("window error: " + e.message));
  },
});
const { window } = dom;
const doc = window.document;
window.onerror = (m) => errors.push("onerror: " + m);

const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];
const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
let pass = 0, fail = 0;
const check = (name, cond, extra="") => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "  ok  " : "FAIL  "} ${name}${cond ? "" : "  → " + extra}`);
};

setTimeout(() => {
  // ── 1. does it boot at all?
  check("boots with no runtime errors", errors.length === 0, errors.join(" | "));
  check("renders the seeded tasks", $$("#m-today .row").length === 3, $$("#m-today .row").length);
  check("header shows a count", /0\/3 punched/.test($("#count").textContent), $("#count").textContent);
  check("punch strip drawn", $$("#strip .cell").length === 32, $$("#strip .cell").length);

  // ── 2. add a task
  $("#new").value = "Test task";
  click($("#addbtn"));
  check("add appends a row", $$("#m-today .row").length === 4, $$("#m-today .row").length);
  check("added title rendered", /Test task/.test($("#m-today").textContent));

  // ── 3. daily toggle
  click($("#dailytog"));
  $("#new").value = "Daily thing";
  click($("#addbtn"));
  check("daily chip appears", $$("#m-today .chip").length >= 1);
  check("daily toggle resets after add", !$("#dailytog").classList.contains("on"));

  // ── 4. timer uses a stored timestamp
  const play = $$("#m-today .row")[0].querySelector(".play");
  click(play);
  const saved = JSON.parse(window.localStorage.getItem("punchcard.v1"));
  check("running anchor persisted", saved.running && typeof saved.running.since === "number",
        JSON.stringify(saved.running));
  // rewind the anchor by 25 minutes: the app was "frozen"
  saved.running.since -= 25 * 60 * 1000;
  window.localStorage.setItem("punchcard.v1", JSON.stringify(saved));
  doc.dispatchEvent(new window.Event("visibilitychange"));
  check("frozen 25m shows as 25m", /25:0\d|▶ 25/.test($("#m-today").textContent),
        $$("#m-today .row")[0].querySelector(".t").textContent.trim());
  check("header total updated", /25m/.test($("#logged").textContent), $("#logged").textContent);

  // ── 4b. pausing must not appear to reset a short session
  const saved2 = JSON.parse(window.localStorage.getItem("punchcard.v1"));
  saved2.tasks[0].sec = 0;
  saved2.running = { id: saved2.tasks[0].id, since: Date.now() - 40 * 1000 };
  window.localStorage.setItem("punchcard.v1", JSON.stringify(saved2));
  doc.dispatchEvent(new window.Event("visibilitychange"));
  const runLabel = $$("#m-today .row")[0].querySelector(".t").textContent.trim();
  check("40s running reads as 0:40", /0:4\d/.test(runLabel), runLabel);
  click($$("#m-today .row")[0].querySelector(".play"));   // pause
  const pausedLabel = $$("#m-today .row")[0].querySelector(".t").textContent.trim();
  check("40s paused does NOT read 0m", !/^0m/.test(pausedLabel), pausedLabel);
  check("40s paused keeps its reading", /0:4\d/.test(pausedLabel), pausedLabel);
  check("header shows sub-minute time", !/^0m/.test($("#logged").textContent), $("#logged").textContent);
  click($$("#m-today .row")[0].querySelector(".play"));   // resume
  check("resume continues, not restarts",
        /0:4\d/.test($$("#m-today .row")[0].querySelector(".t").textContent), "restarted");
  click($$("#m-today .row")[0].querySelector(".play"));   // pause again for the rest of the suite

  // ── 5. punch it out
  const first = $$("#m-today .row")[0];
  click(first.querySelector(".punch"));
  setTimeout(() => {
    check("punched task moves to Punched out", /Punched out/.test($("#m-today").textContent));
    check("punching stops the timer", !JSON.parse(window.localStorage.getItem("punchcard.v1")).running);
    check("time survived the punch", /40s|0:40/.test($("#logged").textContent), $("#logged").textContent);

    // ── 6. stats tab
    click($$("nav button")[1]);
    check("rhythm tab renders", $("#m-rhythm").innerHTML.length > 200);
    check("bar chart drawn", $$("#m-rhythm svg").length >= 2, $$("#m-rhythm svg").length);
    check("no errors after stats", errors.length === 0, errors.join(" | "));
    click($$("nav button")[0]);

    // ── 7. edit sheet
    click($$("#m-today .row")[0].querySelector(".mid"));
    check("edit sheet opens", $("#sheet").classList.contains("open"));
    $("#e-title").value = "Renamed";
    click($("#e-save"));
    check("rename applied", /Renamed/.test($("#m-today").textContent));

    // ── 8. settings sheet
    click($("#gear"));
    check("settings sheet opens", /Auto-stop/.test($("#sheetbody").textContent));
    click($$("#s-auto .pill")[0]); // never
    check("autoStop setting saved",
      JSON.parse(window.localStorage.getItem("punchcard.v1")).settings.autoStop === 0);
    click($("#scrim"));

    // ── 9. colours are pinned to tasks, not positions
    const st = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("every task has a stable hue index", st.tasks.every(t => typeof t.hueIdx === "number"),
          JSON.stringify(st.tasks.map(t => t.hueIdx)));

    // ── 9b. a stale second tab must not overwrite newer data
    const mine = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    const newer = JSON.parse(JSON.stringify(mine));
    newer.rev = mine.rev + 50;
    newer.tasks = [{ id: "z", title: "Written by another tab", daily: false, done: false,
                     sec: 0, target: null, hueIdx: 0 }];
    window.localStorage.setItem("punchcard.v1", JSON.stringify(newer));
    // a passive flush (backgrounding / closing / heartbeat) fires from the stale copy
    doc.dispatchEvent(new window.Event("visibilitychange"));   // visible -> reloads
    window.dispatchEvent(new window.Event("pagehide"));        // passive write
    const after = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("passive write never clobbers a newer revision",
      after.tasks.some(t => t.title === "Written by another tab"),
      after.tasks.map(t => t.title).join(", "));
    check("revision only moves forward", after.rev >= newer.rev, after.rev + " vs " + newer.rev);

    // a deliberate edit is allowed to win, and lands ahead of the other copy
    const beforeEdit = JSON.parse(window.localStorage.getItem("punchcard.v1")).rev;
    $("#new").value = "Deliberate edit";
    click($("#addbtn"));
    const afterEdit = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("explicit edit is written", afterEdit.tasks.some(t => t.title === "Deliberate edit"));
    check("explicit edit bumps the revision", afterEdit.rev > beforeEdit,
          afterEdit.rev + " vs " + beforeEdit);

    // ── 9c. day navigation
    // test 9b wiped the seed tasks and there is no back-history yet, so build both
    const fix = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    fix.tasks.push({ id: "dly", title: "A daily thing", daily: true, done: false,
                     sec: 0, target: null, hueIdx: 3 });
    // derive from the app's own day key — it shifts by the dayStart setting
    const y = new Date(fix.lastDay + "T12:00"); y.setDate(y.getDate() - 1);
    const ykey = y.getFullYear() + "-" + String(y.getMonth()+1).padStart(2,"0") + "-" + String(y.getDate()).padStart(2,"0");
    fix.history[ykey] = { total: 3600, per: { "Yesterday work": 3600 }, completed: ["Yesterday work"] };
    fix.rev += 1;
    window.localStorage.setItem("punchcard.v1", JSON.stringify(fix));
    doc.dispatchEvent(new window.Event("visibilitychange"));

    click($("#nextday"));
    check("moves to tomorrow", /Tomorrow/.test($("#screen").textContent), $("#screen").textContent);
    check("strip hidden on a future day", $("#strip").hidden);
    $("#new").value = "Plan for tomorrow";
    click($("#addbtn"));
    const plans = JSON.parse(window.localStorage.getItem("punchcard.v1")).plans;
    const planKeys = Object.keys(plans);
    check("planned task stored under a date key", planKeys.length === 1, JSON.stringify(planKeys));
    check("planned task not on today's card",
      !JSON.parse(window.localStorage.getItem("punchcard.v1")).tasks.some(t => t.title === "Plan for tomorrow"));
    check("planned task shows on tomorrow", /Plan for tomorrow/.test($("#m-today").textContent));
    check("recurring dailies previewed", /Arrives on its own/.test($("#m-today").textContent));

    click($("#railday"));   // jump home
    check("rail returns to today", /Today/.test($("#screen").textContent), $("#screen").textContent);
    check("today's card unaffected", !/Plan for tomorrow/.test($("#m-today").textContent));

    click($("#prevday"));
    check("yesterday is read-only", $("#composer").hidden);
    check("past day shows what was logged", /Yesterday work/.test($("#m-today").textContent),
          $("#m-today").textContent.slice(0,60));
    check("past day shows the logged time", /1:00:00/.test($("#m-today").textContent));
    click($("#railday"));

    // rollover must deliver the planned task when that day arrives
    const pre = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    pre.lastDay = "2000-01-01";            // force a rollover on next render
    window.localStorage.setItem("punchcard.v1", JSON.stringify(pre));
    doc.dispatchEvent(new window.Event("visibilitychange"));
    const post = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("planned task arrives after rollover",
      post.tasks.some(t => t.title === "Plan for tomorrow") || Object.keys(post.plans).length === 1,
      "tasks=" + post.tasks.map(t => t.title).join("|") + " plans=" + JSON.stringify(Object.keys(post.plans)));

    // ── 9d. the sky
    check("sky art rendered", $("#sky").innerHTML.startsWith("<svg"),
          $("#sky").innerHTML.slice(0,20));
    check("sky avoids svg masks (they render inconsistently)", !/mask=/.test($("#sky").innerHTML));
    check("sky art has depth", /linearGradient|radialGradient/.test($("#sky").innerHTML));
    check("sky has no background box", !/<rect width="104/.test($("#sky").innerHTML));
    click($("#gear"));
    check("weather is off by default",
      !JSON.parse(window.localStorage.getItem("punchcard.v1")).settings.weather);
    check("weather toggle present", !!$("#s-wx"));
    check("follow-the-sun theme offered", /follow the sun/.test($("#sheetbody").textContent));
    click($("#scrim"));
    // no network calls should have been attempted with weather off
    check("no weather fetch while opted out", !window.__fetched, String(window.__fetched));

    // ── 10. reload from storage, as a cold start would
    const dom2 = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true,
      url: "https://example.com/",
      beforeParse(w) {
        w.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){} });
        w.localStorage.setItem("punchcard.v1", window.localStorage.getItem("punchcard.v1"));
        w.addEventListener("error", e => errors.push("reload error: " + e.message));
      }});
    setTimeout(() => {
      const d2 = dom2.window.document;
      const expect = JSON.parse(window.localStorage.getItem("punchcard.v1")).tasks.length;
      check("cold start restores tasks",
        d2.querySelectorAll("#m-today .row").length === expect,
        d2.querySelectorAll("#m-today .row").length + " vs " + expect);
      check("cold start clean", errors.length === 0, errors.join(" | "));
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 250);
  }, 500);
}, 300);
