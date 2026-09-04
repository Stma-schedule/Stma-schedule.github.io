(function(){
  "use strict";

  /* =========================================================
     DATA LOADING — bell times and calendar dates live in
     schedule-data.json (see that file to edit dates/times).
     ========================================================= */
  var DATA_URL = "schedule-data.json";
  var data = null; // populated once fetch resolves

  function toMinutes(hhmm){
    // "H:MM" or "HH:MM" (24-hour) -> minutes since midnight
    var parts = hhmm.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function lunchBlock(spec, lunch, periodName){
    // Builds the Period-3 sub-segments for a given lunch letter, from a
    // {preStart?, lunchStart, lunchEnd?, blockEnd} spec in schedule-data.json.
    // B and C lunches split the period into two class chunks around the
    // lunch break — that's a real split in STMA's own schedule, not a
    // duplicate, so each chunk is labeled to make that clear.
    var lunchStart = toMinutes(spec.lunchStart);
    var blockEnd = toMinutes(spec.blockEnd);
    var segs = [];

    if (lunch === "A"){
      var lunchEndA = toMinutes(spec.lunchEnd);
      segs.push({name:"Lunch", start:lunchStart, end:lunchEndA, type:"lunch"});
      segs.push({name:periodName, start:lunchEndA, end:blockEnd, type:"class"});
    } else if (lunch === "D"){
      var preStartD = toMinutes(spec.preStart);
      segs.push({name:periodName, start:preStartD, end:lunchStart, type:"class"});
      segs.push({name:"Lunch", start:lunchStart, end:blockEnd, type:"lunch"});
    } else {
      // B or C: class, lunch, class
      var preStart = toMinutes(spec.preStart);
      var lunchEnd = toMinutes(spec.lunchEnd);
      segs.push({name:periodName+" (before lunch)", start:preStart, end:lunchStart, type:"class"});
      segs.push({name:"Lunch", start:lunchStart, end:lunchEnd, type:"lunch"});
      segs.push({name:periodName+" (after lunch)", start:lunchEnd, end:blockEnd, type:"class"});
    }
    return segs;
  }

  function buildFromSchedule(sched, lunch, includeHomeroom){
    var segs = [];
    if (includeHomeroom && sched.homeroom){
      segs.push({name:"Homeroom", start:toMinutes(sched.homeroom.start), end:toMinutes(sched.homeroom.end), type:"home"});
    }
    segs.push({name:"Period 1", start:toMinutes(sched.period1.start), end:toMinutes(sched.period1.end), type:"class"});
    segs.push({name:"Period 2", start:toMinutes(sched.period2.start), end:toMinutes(sched.period2.end), type:"class"});
    if (sched.snap){
      segs.push({name:"SNAP", start:toMinutes(sched.snap.start), end:toMinutes(sched.snap.end), type:"snap"});
    }
    segs = segs.concat(lunchBlock(sched.period3[lunch], lunch, "Period 3"));
    segs.push({name:"Period 4", start:toMinutes(sched.period4.start), end:toMinutes(sched.period4.end), type:"class"});
    segs.push({name:"Period 5", start:toMinutes(sched.period5.start), end:toMinutes(sched.period5.end), type:"class"});
    return segs;
  }

  function buildRegular(lunch, snap){
    var sched = snap ? data.schedules.withSnap : data.schedules.noSnap;
    return buildFromSchedule(sched, lunch, true);
  }

  function buildLateStart(lunch){
    return buildFromSchedule(data.schedules.lateStart, lunch, false);
  }

  /* =========================================================
     TIME HELPERS — everything anchored to America/Chicago,
     regardless of the visitor's own device timezone.
     ========================================================= */
  function centralParts(){
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone:"America/Chicago",
      weekday:"short", year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
    });
    var parts = {};
    fmt.formatToParts(new Date()).forEach(function(p){ parts[p.type]=p.value; });
    // hour12:false can return "24" for midnight in some engines — normalize.
    var hour = parseInt(parts.hour,10); if (hour===24) hour=0;
    return {
      weekday: parts.weekday,           // "Mon","Tue",...
      dateStr: parts.year+"-"+parts.month+"-"+parts.day,
      hour: hour,
      minute: parseInt(parts.minute,10),
      second: parseInt(parts.second,10),
      minutesSinceMidnight: hour*60+parseInt(parts.minute,10)+parseInt(parts.second,10)/60
    };
  }

  function fmtClock(mins){
    var h = Math.floor(mins/60), m = Math.round(mins%60);
    if (m===60){m=0;h+=1;}
    var ap = h>=12 ? "PM":"AM";
    var h12 = h%12; if (h12===0) h12=12;
    return h12+":"+(m<10?"0":"")+m+" "+ap;
  }
  function fmtDuration(mins){
    mins = Math.max(0, Math.round(mins));
    var h = Math.floor(mins/60), m = mins%60;
    if (h>0) return h+"h "+m+"m";
    return m+"m";
  }

  var WEEKDAY_MAP = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};

  /* =========================================================
     LUNCH STATE — remembered across visits via a cookie
     (works once this file is hosted, e.g. on GitHub Pages;
     cookies don't persist from file:// previews).
     ========================================================= */
  var LUNCH_COOKIE = "stma_lunch";
  var LUNCH_COOKIE_DAYS = 365;

  function getCookie(name){
    var match = document.cookie.match(new RegExp("(?:^|; )"+name+"=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function setCookie(name, value, days){
    var expires = new Date(Date.now() + days*24*60*60*1000).toUTCString();
    document.cookie = name+"="+encodeURIComponent(value)+"; expires="+expires+"; path=/; SameSite=Lax";
  }

  var lunch = getCookie(LUNCH_COOKIE); // "A" | "B" | "C" | "D" | null
  var modalBackdrop = document.getElementById("modalBackdrop");
  var lunchLabel = document.getElementById("lunchLabel");
  var lunchPillWrap = document.getElementById("lunchPillWrap");

  function openModal(){ modalBackdrop.hidden = false; document.body.style.overflow="hidden"; }
  function closeModal(){ modalBackdrop.hidden = true; document.body.style.overflow=""; }

  if (lunch){ lunchLabel.textContent = lunch; lunchLabel.hidden = false; }

  document.querySelectorAll(".lunch-opt").forEach(function(btn){
    btn.addEventListener("click", function(){
      lunch = btn.getAttribute("data-lunch");
      setCookie(LUNCH_COOKIE, lunch, LUNCH_COOKIE_DAYS);
      lunchLabel.textContent = lunch;
      lunchLabel.hidden = false;
      lunchPillWrap.innerHTML = '<span class="lunch-pill">Lunch '+lunch+'</span>';
      closeModal();
      render();
    });
  });
  document.getElementById("changeLunchBtn").addEventListener("click", openModal);

  /* =========================================================
     RENDER
     ========================================================= */
  var timelineEl = document.getElementById("timeline");
  var pointerEl = document.getElementById("pointer");

  function render(){
    if (!data) return; // JSON not loaded yet

    var now = centralParts();
    document.getElementById("dateLine").textContent =
      new Date().toLocaleDateString("en-US",{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric"});
    document.getElementById("clockNow").textContent = fmtClock(now.minutesSinceMidnight);

    var dow = WEEKDAY_MAP[now.weekday]; // 0=Sun..6=Sat
    var isWeekend = (dow===0 || dow===6);
    var isNoSchool = data.noSchoolDates.indexOf(now.dateStr) !== -1;
    var isLateStart = data.lateStartDates.indexOf(now.dateStr) !== -1;

    var stateLine = document.getElementById("stateLine");
    var subLine = document.getElementById("subLine");
    var scheduleName = document.getElementById("scheduleName");
    var timelineTitle = document.getElementById("timelineTitle");

    // ---- Not a school day at all ----
    if (isWeekend || isNoSchool){
      stateLine.textContent = "No school today";
      stateLine.classList.add("no-school");
      subLine.textContent = isWeekend
        ? "It's the weekend — enjoy it."
        : "This date is marked as a no-school day on the school calendar.";
      scheduleName.textContent = "—";
      timelineTitle.textContent = "No periods today";
      timelineEl.innerHTML = "";
      pointerEl.hidden = true;
      currentSegs = null;
      return;
    }
    stateLine.classList.remove("no-school");

    // ---- Ask for lunch before building a real schedule ----
    if (!lunch){
      stateLine.textContent = "Pick a lunch to see today's schedule";
      subLine.textContent = "";
      scheduleName.textContent = "—";
      timelineEl.innerHTML = "";
      pointerEl.hidden = true;
      currentSegs = null;
      openModal();
      return;
    }

    // ---- Build today's segment list ----
    var snapDay = (dow===2 || dow===4); // Tue/Thu
    var segs, schedLabel;
    if (isLateStart){
      segs = buildLateStart(lunch);
      schedLabel = data.schedules.lateStart.label;
    } else if (snapDay){
      segs = buildRegular(lunch, true);
      schedLabel = data.schedules.withSnap.label;
    } else {
      segs = buildRegular(lunch, false);
      schedLabel = data.schedules.noSnap.label;
    }
    scheduleName.textContent = schedLabel + " · Lunch " + lunch;
    timelineTitle.textContent = "Today's periods";

    var dayStart = segs[0].start;
    var dayEnd = segs[segs.length-1].end;
    var nowM = now.minutesSinceMidnight;

    // ---- Status card text ----
    if (nowM < dayStart){
      stateLine.textContent = "School hasn't started yet";
      subLine.textContent = (segs[0].type==="home" ? "Homeroom" : "Period 1")+" begins at "+fmtClock(dayStart)+" — "+fmtDuration(dayStart-nowM)+" to go.";
    } else if (nowM >= dayEnd){
      stateLine.textContent = "The school day is over";
      subLine.textContent = "Period 5 ended at "+fmtClock(dayEnd)+". See you tomorrow.";
    } else {
      var active = null;
      for (var i=0;i<segs.length;i++){
        if (nowM >= segs[i].start && nowM < segs[i].end){ active = segs[i]; break; }
      }
      if (active){
        var remaining = active.end - nowM;
        stateLine.textContent = active.name;
        subLine.textContent = fmtDuration(remaining)+" left · until "+fmtClock(active.end);
      }
    }

    // ---- Build timeline DOM ----
    timelineEl.innerHTML = "";
    timelineEl.appendChild(pointerEl);
    segs.forEach(function(seg){
      var div = document.createElement("div");
      var state = nowM >= seg.end ? "done" : (nowM >= seg.start && nowM < seg.end ? "now" : "upcoming");
      div.className = "seg " + (seg.type==="lunch" ? "lunch " : "") + state;
      div.innerHTML =
        '<div class="seg-row">'+
          '<span class="seg-name">'+seg.name+(state==="now" ? '<span class="now-tag">Now</span>' : '')+'</span>'+
          '<span class="seg-time">'+fmtClock(seg.start)+' – '+fmtClock(seg.end)+'</span>'+
        '</div>';
      timelineEl.appendChild(div);
    });

    // Remember today's schedule so the fast per-second tick can
    // reposition the pointer without rebuilding the whole timeline.
    currentSegs = segs;
    currentDayStart = dayStart;
    currentDayEnd = dayEnd;
    pointerEl.hidden = false;
    updatePointer();
  }

  /* =========================================================
     POINTER — repositioned every second on its own, separate
     from the full render, so it glides continuously instead of
     jumping each time the timeline redraws.
     ========================================================= */
  var currentSegs = null, currentDayStart = null, currentDayEnd = null;

  function updatePointer(){
    if (!currentSegs || pointerEl.hidden) return;
    var now = centralParts();
    var nowM = now.minutesSinceMidnight;
    var segs = currentSegs;

    requestAnimationFrame(function(){
      var railTop = timelineEl.getBoundingClientRect().top;
      var segEls = timelineEl.querySelectorAll(".seg");
      if (!segEls.length) return;
      var targetY;

      if (nowM < currentDayStart){
        targetY = segEls[0].getBoundingClientRect().top - railTop + 3;
      } else if (nowM >= currentDayEnd){
        var last = segEls[segEls.length-1];
        var r = last.getBoundingClientRect();
        targetY = (r.top - railTop) + r.height - 6;
      } else {
        for (var i=0;i<segs.length;i++){
          if (nowM >= segs[i].start && nowM < segs[i].end){
            var r2 = segEls[i].getBoundingClientRect();
            var frac = (nowM - segs[i].start) / (segs[i].end - segs[i].start);
            targetY = (r2.top - railTop) + frac * r2.height;
            break;
          }
        }
      }
      if (targetY !== undefined) pointerEl.style.top = targetY + "px";
    });
  }

  /* =========================================================
     BOOT — fetch the JSON config, then start rendering.
     ========================================================= */
  fetch(DATA_URL)
    .then(function(res){
      if (!res.ok) throw new Error("HTTP "+res.status);
      return res.json();
    })
    .then(function(json){
      data = json;
      render();
      setInterval(render, 15000);       // rebuild timeline/status text periodically
      setInterval(updatePointer, 1000); // glide the pointer every second
    })
    .catch(function(err){
      var stateLine = document.getElementById("stateLine");
      stateLine.textContent = "Couldn't load schedule data";
      document.getElementById("subLine").textContent =
        "schedule-data.json failed to load (" + err.message + "). If you're opening this file directly " +
        "from disk, run it through a local server instead — browsers block fetch() on file:// pages.";
    });
})();
