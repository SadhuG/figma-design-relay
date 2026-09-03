/**
 * Renders a plan written in the repo's strict plan-markdown format into the
 * illustrated HTML page that sits beside it.
 *
 * The markdown is the single source of truth — it is what executor agents read
 * and what `superpowers:writing-plans` produces. This script only adds the
 * presentation layer: the task spine, the tension cables, and the live step
 * checklist.
 *
 * Usage:  node docs/superpowers/_src/build-plans.mjs [--check] [file.md ...]
 * With no files, every plan listed in PLANS is rebuilt.
 *
 * Expected markdown shape (see any plan for a worked example):
 *
 *   # <Title> Implementation Plan
 *   > **For agentic workers:** ...
 *   **Goal:** ...   **Architecture:** ...   **Tech Stack:** ...   **Spec:** ...
 *   ## Global Constraints
 *   ### Task N: <Name>
 *   **Files:** / **Interfaces:**
 *   - [ ] **Step N: <Label>**
 *   ## Done when
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLANS_DIR = join(HERE, "..", "plans");

/** Plans this script owns, with the per-page metadata markdown cannot carry. */
const PLANS = [
  {
    md: "2026-09-01-serializer-enrichment.md",
    docKey: "serializer-plan",
    phase: 2,
    eyebrow: "Implementation plan · Phase 2 · 2026-09-01",
    description:
      "Phase 2 implementation plan: teach the serializer to carry component identity, bound variables, style names, layout intent and annotations.",
    railTitles: [
      "Reference resolution",
      "Component identity",
      "Layout &amp; intent",
      "Async serializer",
      "Call sites",
      "Verify &amp; document",
    ],
  },
  {
    md: "2026-09-01-design-context-v2.md",
    docKey: "design-context-plan",
    phase: 3,
    eyebrow: "Implementation plan · Phase 3 · 2026-09-01",
    description:
      "Phase 3 implementation plan: get_design_context returns reference code, an inline screenshot, token names and exported assets in one response.",
    railTitles: [
      "Multi-part results",
      "Token extraction",
      "React codegen",
      "CSS &amp; HTML codegen",
      "Asset export",
      "Rewire the tool",
      "Verify &amp; document",
    ],
  },
  {
    md: "2026-09-01-code-connect.md",
    docKey: "code-connect-plan",
    phase: 4,
    eyebrow: "Implementation plan · Phase 4 · 2026-09-01",
    description:
      "Phase 4 implementation plan: parse local Code Connect files, map Figma component keys to real codebase components, and surface snippets in design context.",
    railTitles: [
      "URL parsing",
      "File discovery",
      "Call parsing",
      "get_code_connect_map",
      "Component context",
      "Suggestions",
      "Writing mappings",
      "Verify &amp; document",
    ],
  },
  {
    md: "2026-09-01-library-reach.md",
    docKey: "library-reach-plan",
    phase: 5,
    eyebrow: "Implementation plan · Phase 5 · 2026-09-01",
    description:
      "Phase 5 implementation plan: team library reach and identity — manifest permissions, whoami, get_libraries, import-by-key, and an honestly-scoped design system search.",
    railTitles: [
      "Manifest permissions",
      "Permission errors",
      "whoami",
      "get_libraries",
      "Import by key",
      "Design system search",
      "Verify &amp; document",
    ],
  },
  {
    md: "2026-09-01-figjam-slides-diagrams.md",
    docKey: "figjam-plan",
    phase: 6,
    eyebrow: "Implementation plan · Phase 6 · 2026-09-01",
    description:
      "Phase 6 implementation plan: FigJam and Slides editor support, plus a Mermaid-to-FigJam diagram tool.",
    railTitles: [
      "Capability table",
      "Manifest &amp; editors",
      "FigJam reads",
      "FigJam writes",
      "Slides scope",
      "Mermaid parsing",
      "Diagram rendering",
      "Verify &amp; document",
    ],
  },
];

/* ---------- inline + block markdown ---------------------------------------- */

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Renders the inline subset the plans use: code spans, bold, italics, links.
 * Code spans are extracted first so their contents are never re-parsed.
 */
/** Placeholder used to park code spans while inline markdown is escaped. */
const SENTINEL = "\u0001";

const inline = (text) => {
  const spans = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return `${SENTINEL}${spans.length - 1}${SENTINEL}`;
  });
  out = escapeHtml(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return out.replace(/\u0001(\d+)\u0001/g, (_, i) => spans[Number(i)]);
};

/**
 * Turns a `Run:` / `Expected:` pair into the instrument readout. A leading
 * PASS / FAIL / prints verdict is colour-coded; the rest is inline markdown.
 */
const renderExpect = (runLine, expectLine) => {
  const parts = [];
  if (runLine) parts.push(`<b>Run</b> ${inline(runLine)}`);
  if (expectLine) {
    const verdict = expectLine.match(/^(PASS|FAIL|prints)\b/i);
    if (verdict) {
      const state = /^fail$/i.test(verdict[1]) ? "fail" : "pass";
      const rest = expectLine.slice(verdict[0].length);
      parts.push(`<b>Expect</b> <span class="${state}">${verdict[0]}</span>${inline(rest)}`);
    } else {
      parts.push(`<b>Expect</b> ${inline(expectLine)}`);
    }
  }
  return `<p class="expect">\n  ${parts.join("<br />\n  ")}\n</p>`;
};

/**
 * Renders a run of block-level markdown: paragraphs, lists, fenced code,
 * blockquotes, and the Run/Expected readout convention.
 */
const blocks = (lines) => {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code
    if (line.startsWith("```")) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    // Run: / Expected: readout
    if (/^Run:\s/.test(line) || /^Expected:\s/.test(line)) {
      let run = null;
      let expect = null;
      while (i < lines.length && (/^Run:\s/.test(lines[i]) || /^Expected:\s/.test(lines[i]))) {
        if (lines[i].startsWith("Run:")) run = lines[i].slice(4).trim();
        else expect = lines[i].slice(9).trim();
        i++;
      }
      out.push(renderExpect(run, expect));
      continue;
    }

    // A label for the code block that follows
    if (/^_.+_$/.test(line.trim())) {
      out.push(`<p class="pre-label">${inline(line.trim().slice(1, -1))}</p>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const body = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>\n${blocks(body)}\n</blockquote>`);
      continue;
    }

    // Lists
    if (/^(\s*)([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items = [];
      while (i < lines.length && /^(\s*)([-*]|\d+\.)\s/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s/, "");
        i++;
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s*([-*]|\d+\.)\s/.test(lines[i])
        ) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(`  <li>${inline(item)}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag} class="plain">\n${items.join("\n")}\n</${tag}>`);
      continue;
    }

    // Paragraph
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^(\s*)([-*]|\d+\.)\s/.test(lines[i]) &&
      !/^Run:\s/.test(lines[i]) &&
      !/^Expected:\s/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return out.join("\n");
};

/* ---------- plan parsing ---------------------------------------------------- */

const parsePlan = (md) => {
  const lines = md.split("\n");
  const plan = { meta: {}, constraints: [], tasks: [], doneWhen: [], blockquote: [] };

  let i = 0;
  plan.title = lines[i++].replace(/^#\s+/, "").replace(/\s+Implementation Plan$/, "");

  for (; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("> ")) {
      plan.blockquote.push(line.replace(/^>\s?/, ""));
      continue;
    }

    const meta = line.match(/^\*\*(Goal|Architecture|Tech Stack|Spec):\*\*\s*(.*)$/);
    if (meta) {
      const body = [meta[2]];
      while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !lines[i + 1].startsWith("**")) {
        body.push(lines[++i].trim());
      }
      plan.meta[meta[1]] = body.join(" ").trim();
      continue;
    }

    if (line.startsWith("## Global Constraints")) {
      i++;
      const body = [];
      while (i < lines.length && !lines[i].startsWith("### Task")) body.push(lines[i++]);
      i--;
      plan.constraints = body.filter((l) => l.trim() !== "" && l.trim() !== "---");
      continue;
    }

    if (line.startsWith("### Task ")) {
      const m = line.match(/^### Task (\d+):\s*(.*)$/);
      const task = {
        no: m[1],
        title: m[2],
        intro: [],
        files: [],
        interfaces: [],
        steps: [],
        chips: [],
      };
      const chip = task.title.match(/\s*\[(R[^\]]+)\]$/);
      if (chip) {
        task.chips = chip[1].split(/\s*,\s*/);
        task.title = task.title.replace(/\s*\[R[^\]]+\]$/, "");
      }
      i++;

      const body = [];
      while (
        i < lines.length &&
        !lines[i].startsWith("### Task ") &&
        !lines[i].startsWith("## Done when")
      ) {
        body.push(lines[i++]);
      }
      i--;

      let j = 0;
      while (
        j < body.length &&
        !/^\*\*(Files|Interfaces):\*\*/.test(body[j]) &&
        !/^- \[ \]/.test(body[j])
      ) {
        task.intro.push(body[j++]);
      }
      /**
       * Collects the bullets under a `**Files:**` / `**Interfaces:**` marker.
       * Prettier puts a blank line after the marker, so skip blanks before the
       * list and stop at the first one after it.
       */
      const collectBullets = (into) => {
        j++;
        while (j < body.length && body[j].trim() === "") j++;
        while (j < body.length && body[j].startsWith("- ")) {
          let item = body[j++].slice(2);
          // Prettier wraps long bullets onto continuation lines.
          while (j < body.length && /^\s{2,}\S/.test(body[j]) && !body[j].startsWith("- ")) {
            item += " " + body[j++].trim();
          }
          into.push(item);
        }
      };

      while (j < body.length && !/^- \[ \]/.test(body[j])) {
        if (/^\*\*Files:\*\*/.test(body[j])) collectBullets(task.files);
        else if (/^\*\*Interfaces:\*\*/.test(body[j])) collectBullets(task.interfaces);
        else j++;
      }
      while (j < body.length) {
        const step = body[j].match(/^- \[ \] \*\*Step (\d+):\s*(.*?)\*\*$/);
        if (!step) {
          j++;
          continue;
        }
        const sBody = [];
        j++;
        while (j < body.length && !/^- \[ \] \*\*Step /.test(body[j])) sBody.push(body[j++]);
        task.steps.push({ no: step[1], label: step[2], body: sBody });
      }

      plan.tasks.push(task);
      continue;
    }

    if (line.startsWith("## Done when")) {
      i++;
      const body = [];
      while (i < lines.length) body.push(lines[i++]);
      plan.doneWhen = body.filter((l) => l.trim() !== "" && l.trim() !== "---");
    }
  }

  return plan;
};

/* ---------- HTML emission --------------------------------------------------- */

const fileLine = (raw) => {
  const m = raw.match(/^(Create|Modify|Extend|Delete|Test):\s*(.*)$/);
  if (!m) return `  <li>${inline(raw)}</li>`;
  return `  <li><span class="verb">${m[1]}</span>${inline(m[2])}</li>`;
};

const renderTask = (task, htmlSlug) => {
  const chips = task.chips
    .map((c) => `<span class="chip chip--phase">${c}</span>`)
    .join("\n              ");

  const steps = task.steps
    .map((step) => {
      const id = `${htmlSlug}t${task.no}s${step.no}`;
      return `              <li class="step">
                <div class="step__top">
                  <input type="checkbox" id="${id}" />
                  <label class="step__label" for="${id}">${inline(step.label)}</label>
                </div>
                <div class="step__body">
${blocks(step.body)}
                </div>
              </li>`;
    })
    .join("\n\n");

  const consumes = task.interfaces.find((t) => t.startsWith("Consumes:"));
  const produces = task.interfaces.find((t) => t.startsWith("Produces:"));

  return `          <article class="task" id="task-${task.no}" data-spy>
            <div class="task__head">
              <span class="task__no">Task ${String(task.no).padStart(2, "0")}</span>
              <h2>${inline(task.title)}</h2>
              ${chips}
            </div>
${blocks(task.intro)}

            <div class="tension">
              <span class="tension__count"></span><span class="tension__fill"></span>
            </div>

            <dl class="files">
              <dt>Files</dt>
              <dd>
                <ul>
${task.files
  .map(fileLine)
  .map((l) => `              ${l}`)
  .join("\n")}
                </ul>
              </dd>
              <dt>Interfaces</dt>
              <dd>
                ${consumes ? `<strong>Consumes</strong> — ${inline(consumes.replace(/^Consumes:\s*/, ""))}<br />` : ""}
                ${produces ? `<strong>Produces</strong> — ${inline(produces.replace(/^Produces:\s*/, ""))}` : ""}
              </dd>
            </dl>

            <ol class="steps">
${steps}
            </ol>
          </article>`;
};

const renderHtml = (plan, cfg) => {
  const slug = cfg.docKey.replace(/-plan$/, "").replace(/[^a-z0-9]/g, "");
  const stepCount = plan.tasks.reduce((n, t) => n + t.steps.length, 0);

  const rail = plan.tasks
    .map(
      (t, idx) => `            <li>
              <a href="#task-${t.no}"
                ><span>${cfg.railTitles[idx] ?? inline(t.title)} <b class="rail__done"></b></span
              ></a>
            </li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${inline(plan.title)} · Figma Design Relay plan</title>
    <meta name="description" content="${cfg.description}" />
    <link rel="stylesheet" href="../assets/doc.css" />
  </head>
  <body data-doc="${cfg.docKey}">
    <a class="skip" href="#main">Skip to the plan</a>

    <div class="shell">
      <header class="masthead">
        <p class="eyebrow">${cfg.eyebrow}</p>
        <h1>${inline(plan.title)}</h1>
        <p class="standfirst">${inline(plan.meta.Goal ?? "")}</p>

        <dl class="masthead__meta">
          <div>
            <b>Spec</b> —
            <a href="../specs/2026-09-01-official-figma-mcp-parity.html">Parity analysis</a>, phase
            ${cfg.phase}
          </div>
          <div><b>Tasks</b> — ${plan.tasks.length}</div>
          <div><b>Steps</b> — ${stepCount}</div>
          <div><b>Progress</b> — saved in this browser</div>
        </dl>
      </header>

      <blockquote>
${blocks(plan.blockquote)}
      </blockquote>

      <section class="brief">
        <h2 id="brief" data-spy>The shape of it</h2>
        <p><strong>Architecture.</strong> ${inline(plan.meta.Architecture ?? "")}</p>
        <p><strong>Tech stack.</strong> ${inline(plan.meta["Tech Stack"] ?? "")}</p>

        <h3>Global constraints</h3>
        <p>Every task's requirements implicitly include these.</p>
${blocks(plan.constraints)}
      </section>

      <div class="layout">
        <nav class="rail" aria-label="Tasks">
          <p class="rail__title">Tasks</p>
          <ol>
${rail}
          </ol>
        </nav>

        <main id="main">
${plan.tasks.map((t) => renderTask(t, slug)).join("\n\n")}

          <section class="done-when" id="done" data-spy>
            <h2>Done when</h2>
${blocks(plan.doneWhen)}
          </section>

          <footer class="colophon">
            <span>Figma Design Relay</span>
            <span>Plan · Phase ${cfg.phase} · 2026-09-01</span>
            <span>Source: <code>docs/superpowers/plans/${cfg.md}</code></span>
            <span><a href="../specs/2026-09-01-official-figma-mcp-parity.html">← Parity spec</a></span>
          </footer>
        </main>
      </div>
    </div>

    <script src="../assets/doc.js"></script>
  </body>
</html>
`;
};

/* ---------- run -------------------------------------------------------------- */

const args = process.argv.slice(2);
const explicit = args.filter((a) => !a.startsWith("--"));
const targets = explicit.length
  ? PLANS.filter((p) => explicit.some((a) => basename(a) === p.md))
  : PLANS;

for (const cfg of targets) {
  const mdPath = join(PLANS_DIR, cfg.md);
  const plan = parsePlan(readFileSync(mdPath, "utf8"));
  const htmlPath = mdPath.replace(/\.md$/, ".html");
  writeFileSync(htmlPath, renderHtml(plan, cfg));
  const steps = plan.tasks.reduce((n, t) => n + t.steps.length, 0);
  console.log(`${cfg.md} → ${basename(htmlPath)}  (${plan.tasks.length} tasks, ${steps} steps)`);
}
