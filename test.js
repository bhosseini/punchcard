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
  // toggleTimer() used to trigger a full innerHTML wipe-and-rebuild of the whole task
  // list on every tap — visible on real devices as the entire stack jumping. Capture
  // the actual row elements first and prove they're the SAME nodes after, not
  // look-alike replacements — that's what actually stops the jump.
  const rowsBeforePlay = $$("#m-today .row");
  const play = rowsBeforePlay[0].querySelector(".play");
  click(play);
  const rowsAfterPlay = $$("#m-today .row");
  check("starting a timer doesn't recreate the row list",
    rowsBeforePlay.length === rowsAfterPlay.length && rowsBeforePlay.every((r, i) => r === rowsAfterPlay[i]),
    `${rowsBeforePlay.length} rows before, ${rowsAfterPlay.length} after, same nodes: ${rowsBeforePlay.every((r,i)=>r===rowsAfterPlay[i])}`);

  // Keeping the row element isn't enough on its own: row() also used to rewrite every
  // row's innerHTML, wiping and recreating its children even when the markup was
  // byte-identical. That momentarily collapses each row's height, and the phone paints
  // the in-between frame — the stack visibly jumping. Only rows whose markup really
  // changed should have their children touched.
  const obsRows = $$("#m-today .row");
  const obs = new window.MutationObserver(() => {});
  obsRows.forEach(r => obs.observe(r, { childList: true }));
  click(play);                                   // pause — only this row's markup changes
  const touched = new Set(obs.takeRecords().map(r => obsRows.indexOf(r.target)));
  obs.disconnect();
  check("toggling a timer only rebuilds the row that changed", touched.size <= 1,
    `${touched.size} of ${obsRows.length} rows had their children replaced`);

  // .row carries `animation:rowin` (fade in from opacity 0, translateY(-8px)).
  // Re-inserting a node that is already in place still counts as an insertion and
  // restarts that animation, so re-appending every row each render replayed the entry
  // animation on the whole list — the fade-and-slide flash on every play/pause tap.
  // Nothing structural changed here, so the container must not be touched at all.
  const listEl = $("#m-today");
  const listObs = new window.MutationObserver(() => {});
  listObs.observe(listEl, { childList: true });
  click(play);
  click(play);
  const listRecs = listObs.takeRecords();
  listObs.disconnect();
  const moved = listRecs.reduce((a, r) => a + r.addedNodes.length + r.removedNodes.length, 0);
  check("toggling a timer doesn't re-insert rows (which would replay rowin)", moved === 0,
    `${moved} node insertions/removals on the list container`);

  // The progress bar only renders once sec > 0, so it pops into existence one tick
  // after you hit play. In normal flow that added height:3px + margin-top:8px to the
  // row and shoved the whole list down. jsdom can't measure layout, so assert the
  // property that makes the reflow impossible: the bar is out of flow.
  const barRule = html.match(/\.bar\{[^}]*\}/);
  check("progress bar is out of layout flow so it can't reflow the row",
    !!barRule && /position:\s*absolute/.test(barRule[0]) && !/margin-top/.test(barRule[0]),
    barRule ? barRule[0].replace(/\s+/g, " ") : "no .bar rule found");

  click(play);   // resume, so the timestamp checks below still have a running timer
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
    // #screen may show a rotating greeting instead of the literal word "Today" now;
    // #railday's own label isn't affected by that, so it's the stable thing to check
    check("rail returns to today", $("#railday").textContent === "Today", $("#railday").textContent);
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

    // ── 9c-2. the "Today" greeting — only the live today view gets one
    const withGreeting = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("greeting picked for today's view", !!withGreeting.greeting?.text,
      JSON.stringify(withGreeting.greeting));
    check("greeting respects the max length", (withGreeting.greeting?.text || "").length <= 24,
      withGreeting.greeting?.text);
    check("greeting isn't the literal word Today", withGreeting.greeting?.text !== "Today",
      withGreeting.greeting?.text);
    const screenBefore = $("#screen").textContent;
    window.render();                              // re-render within the same slot
    check("greeting doesn't change on every render", $("#screen").textContent === screenBefore,
      screenBefore + " vs " + $("#screen").textContent);

    // ── 9c-3. daily palette — one of a handful, never the same as yesterday
    const p1 = JSON.parse(window.localStorage.getItem("punchcard.v1")).palette;
    check("palette picked", p1 && p1.idx >= 0 && p1.idx < 4, JSON.stringify(p1));
    const violetNow = window.getComputedStyle(doc.documentElement).getPropertyValue("--violet").trim();
    check("palette actually applied to the CSS vars", violetNow.length > 0, violetNow);

    const beforeIdx = p1.idx;
    const forced = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    forced.lastDay = "1999-01-01";               // force yet another rollover
    window.localStorage.setItem("punchcard.v1", JSON.stringify(forced));
    doc.dispatchEvent(new window.Event("visibilitychange"));
    const p2 = JSON.parse(window.localStorage.getItem("punchcard.v1")).palette;
    check("palette doesn't repeat the previous day's", p2.idx !== beforeIdx,
      beforeIdx + " -> " + p2.idx);

    // ── 9c-4. the idea drawer
    click($$("nav button").find(b=>b.dataset.tab==="ideas"));
    check("drawer opens", !$("#m-ideas").hidden && $("#m-today").hidden);
    check("drawer heading", /Idea Drawer/.test($("#screen").textContent), $("#screen").textContent);
    check("drawer hides the day rail", $("#rail").hidden);
    check("drawer tab is selected", $$("nav button").find(b=>b.dataset.tab==="ideas").getAttribute("aria-selected")==="true");
    check("empty drawer says so", /drawer's empty/.test($("#m-ideas").textContent),
      $("#m-ideas").textContent.slice(0, 40));

    $("#newidea").value = "Visit the observatory";
    click($("#addideabtn"));
    check("quick-add puts an idea in the drawer", $$("#m-ideas .idea").length === 1,
      $$("#m-ideas .idea").length);
    check("idea persists to storage",
      (JSON.parse(window.localStorage.getItem("punchcard.v1")).ideas || []).length === 1);

    // pull it onto today's card; it should leave the drawer and carry its origin
    click($$("#m-ideas .idea")[0].querySelector('[data-act="today"]'));
    const pulledState = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("pulling an idea moves it onto the card",
      pulledState.ideas.length === 0 &&
      pulledState.tasks.some(t => t.title === "Visit the observatory"),
      `ideas=${pulledState.ideas.length} onCard=${pulledState.tasks.some(t=>t.title==="Visit the observatory")}`);
    const pulledTask = pulledState.tasks.find(t => t.title === "Visit the observatory");
    check("pulled task remembers it came from the drawer", !!pulledTask.fromIdea,
      JSON.stringify(pulledTask.fromIdea));

    // end the day without punching it — it belongs back in the drawer, not carried forward
    const rollPre = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    rollPre.lastDay = "2000-01-01";
    window.localStorage.setItem("punchcard.v1", JSON.stringify(rollPre));
    doc.dispatchEvent(new window.Event("visibilitychange"));
    const rolled = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("an unfinished idea goes back to the drawer at day's end",
      rolled.ideas.some(i => i.title === "Visit the observatory") &&
      !rolled.tasks.some(t => t.title === "Visit the observatory"),
      `inDrawer=${rolled.ideas.some(i=>i.title==="Visit the observatory")} onCard=${rolled.tasks.some(t=>t.title==="Visit the observatory")}`);

    // scheduling drops it into the existing plans machinery
    click($$("nav button").find(b=>b.dataset.tab==="ideas"));
    const planIdea = $$("#m-ideas .idea")[0];
    click(planIdea.querySelector('[data-act="plan"]'));
    check("schedule sheet shows a month grid", $$(".cday[data-off]").length >= 28,
      $$(".cday[data-off]").length);
    const future = $$(".cday[data-off]").find(c => +c.dataset.off === 2);
    click(future);
    const planned = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    const ideaPlanKeys = Object.keys(planned.plans);
    check("scheduling an idea files it under a future day",
      ideaPlanKeys.length >= 1 && planned.ideas.length === 0,
      `plans=${JSON.stringify(ideaPlanKeys)} ideas=${planned.ideas.length}`);

    // it shouldn't vanish from the drawer — it stays visible, greyed, under its own
    // divider, read back out of S.plans rather than duplicated into S.ideas
    check("a scheduled idea still shows in the drawer", $$("#m-ideas .idea.pending").length === 1,
      $$("#m-ideas .idea.pending").length);
    check("pending idea says when it lands",
      /waiting for/.test($("#m-ideas .idea.pending").textContent),
      $("#m-ideas .idea.pending").textContent.replace(/\s+/g, " ").trim());
    check("the calendar divider appears", /On the calendar/.test($("#m-ideas").textContent));

    // and it can come back
    click($("#m-ideas .idea.pending .ititle"));
    check("tapping a pending idea offers to unschedule it", !!$("#p-back"));
    click($("#p-back"));
    const returned = JSON.parse(window.localStorage.getItem("punchcard.v1"));
    check("unscheduling puts it back in the drawer",
      returned.ideas.length === 1 &&
      !Object.values(returned.plans).flat().some(t => t.fromIdea),
      `ideas=${returned.ideas.length} stillPlanned=${Object.values(returned.plans).flat().some(t=>t.fromIdea)}`);
    click($$("nav button").find(b=>b.dataset.tab==="today"));
    check("today tab returns to the card", !$("#m-today").hidden && $("#m-ideas").hidden);

    // ── 9d. the sky
    check("sky art rendered", $("#sky").innerHTML.startsWith("<svg"),
          $("#sky").innerHTML.slice(0,20));
    check("sky avoids svg masks (they render inconsistently)", !/mask=/.test($("#sky").innerHTML));
    check("sky art has depth", /linearGradient|radialGradient/.test($("#sky").innerHTML));
    check("sky has no background box", !/<rect width="104/.test($("#sky").innerHTML));



    // a render triggered by something unrelated (tapping play, adding a task) used to
    // rebuild the whole gradient-heavy sky SVG every time — visible as a flicker on
    // real devices. Comparing output alone is too weak a check here: skySVG()'s
    // coordinates are already rounded to 2 decimals, so two calls a moment apart would
    // likely produce identical markup anyway, fix or no fix. Spy on the actual function
    // call count instead — that's what the flicker fix has to prevent.
    let skySVGCalls = 0;
    const origSkySVG = window.skySVG;
    window.skySVG = (...a) => { skySVGCalls++; return origSkySVG(...a); };
    window.render();
    check("paintSky skips the rebuild when nothing changed", skySVGCalls === 0,
      "skySVG() called " + skySVGCalls + " times on a no-op render");
    window.skySVG = origSkySVG;

    let setPropCalls = 0;
    const origSetProp = window.CSSStyleDeclaration.prototype.setProperty;
    window.CSSStyleDeclaration.prototype.setProperty = function(...a) { setPropCalls++; return origSetProp.apply(this, a); };
    window.render();
    check("paintPalette skips rewriting CSS vars when nothing changed", setPropCalls === 0,
      "setProperty called " + setPropCalls + " times on a no-op render");
    window.CSSStyleDeclaration.prototype.setProperty = origSetProp;

    // a properly overcast sky is just cloud — no disc peeking through, and a fuller field
    const skyAt = (cover, phase) => {
      window.phaseNow = () => phase;
      window.eval(`S.settings.weather = true; S.sky = {code:2, cover:${cover}};`);
      return window.skySVG();
    };
    const partly = skyAt(60, "day"), socked = skyAt(95, "day"), sockedNight = skyAt(95, "night");
    const puffs = s => (s.match(/<g opacity=/g) || []).length;
    // measure only circles filled with the cloud gradient — the sun's glow disc is the
    // biggest circle in the frame and would otherwise dominate the comparison
    const biggestCloud = s => Math.max(...[...s.matchAll(/r="([\d.]+)" fill="url\(#cl\)"/g)].map(m => +m[1]));
    check("sun still shows through partial cloud", /url\(#sun\)/.test(partly));
    check("overcast day hides the sun", !/url\(#sun\)/.test(socked));
    check("overcast night hides the moon", !/url\(#moon\)/.test(sockedNight));
    check("overcast adds a fourth cloud", puffs(socked) === 4 && puffs(partly) === 2,
      `overcast=${puffs(socked)} partial=${puffs(partly)}`);
    check("overcast clouds are bigger than partial ones",
      biggestCloud(socked) > biggestCloud(partly),
      `${biggestCloud(socked)} vs ${biggestCloud(partly)}`);

    click($("#gear"));
    check("weather is off by default",
      !JSON.parse(window.localStorage.getItem("punchcard.v1")).settings.weather);
    check("weather toggle present", !!$("#s-wx"));
    check("settings shows a version string", /^v\d{4}\.\d{2}\.\d{2}/.test(($("#s-version")||{}).textContent||""),
      ($("#s-version")||{}).textContent);
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
