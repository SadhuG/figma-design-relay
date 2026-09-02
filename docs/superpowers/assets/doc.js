/* Figma Design Relay — document behaviours.
   Three jobs, nothing more: read out a hanger, remember which plan steps are
   done, and keep the rail in sync with the section you're reading. */

(function () {
  "use strict";

  /* ---- 1. Span readout ---------------------------------------------------
     Each hanger carries its own copy so the page still says everything it
     needs to without JavaScript; this only promotes it into the readout. */

  var readout = document.querySelector("[data-readout]");
  if (readout) {
    var nameEl = readout.querySelector("[data-readout-name]");
    var textEl = readout.querySelector("[data-readout-text]");
    var statusEl = readout.querySelector("[data-readout-status]");
    var pinned = false;

    var show = function (btn) {
      nameEl.textContent = btn.dataset.tool;
      textEl.childNodes[0].nodeValue = btn.dataset.note + " ";
      statusEl.textContent = btn.dataset.statusLabel;
      statusEl.className = "status status--" + btn.dataset.status;
    };

    document.querySelectorAll(".hanger__btn").forEach(function (btn) {
      btn.addEventListener("mouseenter", function () {
        if (!pinned) show(btn);
      });
      btn.addEventListener("focus", function () {
        show(btn);
      });
      btn.addEventListener("click", function () {
        pinned = true;
        show(btn);
      });
    });
  }

  /* ---- 2. Step persistence ----------------------------------------------
     Someone executing this plan will close the tab. Remember where they got
     to, per document, and tension each task's cable to match. */

  var boxes = Array.prototype.slice.call(document.querySelectorAll(".step input[type=checkbox]"));

  if (boxes.length) {
    var key = "fmb-plan:" + document.body.dataset.doc;
    var saved = {};

    try {
      saved = JSON.parse(localStorage.getItem(key) || "{}");
    } catch (err) {
      saved = {};
    }

    var save = function () {
      var state = {};
      boxes.forEach(function (box) {
        if (box.checked) state[box.id] = 1;
      });
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch (err) {
        /* Private browsing — the checkboxes still work for this session. */
      }
    };

    var paint = function () {
      document.querySelectorAll(".task").forEach(function (task) {
        var own = task.querySelectorAll(".step input[type=checkbox]");
        var done = task.querySelectorAll(".step input:checked").length;
        var fill = task.querySelector(".tension__fill");
        var count = task.querySelector(".tension__count");
        if (fill) fill.style.width = own.length ? (done / own.length) * 100 + "%" : "0%";
        if (count) count.textContent = done + " / " + own.length + " steps";

        var link = document.querySelector('.rail a[href="#' + task.id + '"]');
        if (link) {
          var tag = link.querySelector(".rail__done");
          if (tag) tag.textContent = done === own.length && own.length ? "done" : "";
        }
      });
    };

    boxes.forEach(function (box) {
      if (saved[box.id]) box.checked = true;
      box.closest(".step").classList.toggle("is-done", box.checked);
      box.addEventListener("change", function () {
        box.closest(".step").classList.toggle("is-done", box.checked);
        save();
        paint();
      });
    });

    paint();
  }

  /* ---- 3. Rail scroll-spy ------------------------------------------------ */

  var targets = Array.prototype.slice.call(document.querySelectorAll("[data-spy]"));
  var links = Array.prototype.slice.call(document.querySelectorAll(".rail a"));

  if (targets.length && links.length && "IntersectionObserver" in window) {
    var current = null;
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          if (current === entry.target.id) return;
          current = entry.target.id;
          links.forEach(function (link) {
            link.classList.toggle("is-current", link.getAttribute("href") === "#" + current);
          });
        });
      },
      { rootMargin: "-88px 0px -70% 0px", threshold: 0 }
    );
    targets.forEach(function (target) {
      observer.observe(target);
    });
  }
})();
