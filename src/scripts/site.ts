const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Code blocks: a bar with the language and a copy button. Headings: a link to their section.
(() => {
  const names: Record<string, string> = {
    go: 'Go', python: 'Python', py: 'Python', ts: 'TypeScript', typescript: 'TypeScript', js: 'JavaScript',
    javascript: 'JavaScript', sql: 'SQL', tsql: 'T-SQL', bash: 'Shell', sh: 'Shell', shell: 'Shell',
    json: 'JSON', yaml: 'YAML', yml: 'YAML', hcl: 'Terraform', terraform: 'Terraform', cypher: 'Cypher',
    toml: 'TOML', dockerfile: 'Dockerfile', html: 'HTML', css: 'CSS',
  };
  document.querySelectorAll<HTMLPreElement>('.prose pre').forEach((pre) => {
    const lang = (pre.dataset.language || '').toLowerCase();
    const wrap = document.createElement('div');
    wrap.className = 'codeblock';
    const bar = document.createElement('div');
    bar.className = 'code-bar';
    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = names[lang] || (lang && lang !== 'plaintext' && lang !== 'text' ? lang : 'Code');
    bar.append(label);
    if (navigator.clipboard) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'code-copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(pre.innerText);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed';
        }
        setTimeout(() => (copy.textContent = 'Copy'), 1800);
      });
      bar.append(copy);
    }
    pre.replaceWith(wrap);
    wrap.append(bar, pre);
  });
  document.querySelectorAll<HTMLElement>('.prose h2[id], .prose h3[id]').forEach((h) => {
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = `#${h.id}`;
    a.setAttribute('aria-label', `Link to “${h.textContent}”`);
    a.textContent = '#';
    h.append(a);
  });
})();

// Post bodies come from Markdown, so their blocks are marked for the entrance here.
document.querySelectorAll<HTMLElement>('.prose > *').forEach((el) => el.setAttribute('data-reveal', ''));

// Reveal once when an element enters the viewport. Never leaves content hidden.
(() => {
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal], .bars');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );
  targets.forEach((el) => io.observe(el));
  window.addEventListener('load', () =>
    setTimeout(() => {
      targets.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    }, 2500),
  );
})();

// Phone menu.
(() => {
  const button = document.querySelector<HTMLButtonElement>('[data-menu]');
  const nav = document.getElementById('head-nav');
  if (!button || !nav) return;
  button.hidden = false;
  const set = (open: boolean) => {
    button.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  };
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) set(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      set(false);
      button.focus();
    }
  });
})();

// The live systems panel: ask each deployed system from the visitor's browser and time the answer.
(() => {
  const button = document.querySelector<HTMLButtonElement>('[data-wake-all]');
  const rows = [...document.querySelectorAll<HTMLElement>('[data-wake]')];
  if (!button || !rows.length) return;

  const ask = async (row: HTMLElement) => {
    const state = row.querySelector<HTMLElement>('.status-state')!;
    const text = state.querySelector<HTMLElement>('[data-state-text]')!;
    state.dataset.state = 'waiting';
    text.textContent = 'Checking';
    const started = performance.now();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 25000);
    try {
      // no-cors: the answer is opaque, but it only arrives once the service has responded
      await fetch(row.dataset.wake!, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      const ms = performance.now() - started;
      const time = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
      state.dataset.state = 'up';
      text.textContent = ms > 2500 ? `Up, woke in ${time}` : `Up, ${time}`;
    } catch {
      state.dataset.state = 'down';
      text.textContent = 'No answer';
    } finally {
      clearTimeout(timeout);
    }
  };

  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    await Promise.all(rows.map(ask));
    button.disabled = false;
    busy = false;
  };
  button.addEventListener('click', run);

  // Check once on its own when the panel is first seen.
  const panel = button.closest('.status');
  if (panel && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      run();
    });
    io.observe(panel);
  }
})();

// About: the photograph quietly changes.
(() => {
  const frame = document.querySelector<HTMLElement>('[data-fade]');
  if (!frame || reduced) return;
  const imgs = [...frame.querySelectorAll('img')];
  if (imgs.length < 2) return;
  let i = 0;
  let timer: number | undefined;
  const start = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      imgs[i].classList.remove('is-on');
      i = (i + 1) % imgs.length;
      imgs[i].classList.add('is-on');
    }, 6000);
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? window.clearInterval(timer) : start()));
  start();
})();

// Contact: copy the email address, for people without a mail app set up.
(() => {
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
    if (!navigator.clipboard) return;
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy!);
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy failed';
      }
      setTimeout(() => (button.textContent = 'Copy'), 2000);
    });
  });
})();

// Writing: show one kind of post at a time.
(() => {
  const group = document.querySelector<HTMLElement>('[data-filters]');
  if (!group) return;
  group.hidden = false;
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('[data-filter]')];
  const rows = [...document.querySelectorAll<HTMLElement>('.post-row')];
  group.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-filter]');
    if (!button) return;
    const kind = button.dataset.filter;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    rows.forEach((row) => (row.hidden = kind !== 'all' && row.dataset.kind !== kind));
  });
})();

// Figures count up once, when they come into view.
(() => {
  const figures = [...document.querySelectorAll<HTMLElement>('[data-count]')];
  if (!figures.length || reduced || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      const el = entry.target as HTMLElement;
      const to = parseFloat(el.dataset.count!);
      const decimals = (el.dataset.count!.split('.')[1] || '').length;
      const suffix = el.dataset.suffix || '';
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / 1100);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = (to * eased).toFixed(decimals) + suffix;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.6 });
  figures.forEach((el) => io.observe(el));
})();

// Demo: CortexAI's router.
document.querySelectorAll<HTMLElement>('[data-demo="router"]').forEach((demo) => {
  const buttons = [...demo.querySelectorAll<HTMLButtonElement>('[data-agent]')];
  const out = (name: string) => demo.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      out('agent').textContent = button.dataset.agent!;
      out('how').textContent = button.dataset.how!;
      const file = button.dataset.file;
      out('why').textContent = file
        ? `because a ${file.endsWith('.pdf') ? 'PDF' : 'image'} is attached`
        : 'by the Auto classifier';
    }),
  );
});

// Demo: MemLedger's retraction.
document.querySelectorAll<HTMLElement>('[data-demo="revoke"]').forEach((demo) => {
  const act = demo.querySelector<HTMLButtonElement>('[data-revoke]')!;
  const reset = demo.querySelector<HTMLButtonElement>('[data-reset]')!;
  const result = demo.querySelector<HTMLElement>('[data-result]')!;
  const rows = [...demo.querySelectorAll<HTMLElement>('[data-source]')];
  act.addEventListener('click', () => {
    const hit = rows.filter((r) => r.dataset.source === act.dataset.revoke);
    hit.forEach((r) => {
      r.classList.add('is-revoked');
      r.querySelector('[data-state]')!.textContent = 'revoked';
    });
    result.textContent = `One traversal withdrew ${hit.length} facts. The runbook's answer stands.`;
    act.disabled = true;
    reset.hidden = false;
  });
  reset.addEventListener('click', () => {
    rows.forEach((r) => {
      r.classList.remove('is-revoked');
      r.querySelector('[data-state]')!.textContent = 'active';
    });
    result.textContent = '';
    act.disabled = false;
    reset.hidden = true;
    act.focus();
  });
});

// Demo: HazeBusters' source choice and outdoor decision (backend/src/air/decision_rules.md).
document.querySelectorAll<HTMLElement>('[data-demo="decide"]').forEach((demo) => {
  const input = (name: string) => demo.querySelector<HTMLInputElement>(`[data-in="${name}"]`)!;
  const show = (name: string) => demo.querySelector<HTMLElement>(`[data-show="${name}"]`)!;
  const out = (name: string) => demo.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
  const categories: [number, string, string][] = [
    [50, 'Good', 'Yes'],
    [100, 'Satisfactory', 'Yes'],
    [200, 'Moderate', 'Limit'],
    [300, 'Poor', 'No'],
    [400, 'Very poor', 'No'],
    [500, 'Severe', 'No'],
  ];
  const update = () => {
    const km = +input('km').value;
    const age = +input('age').value;
    const aqi = +input('aqi').value;
    show('km').textContent = String(km);
    show('age').textContent = String(age);
    show('aqi').textContent = String(aqi);
    const station = km <= 25 && age < 3;
    out('source').textContent = station
      ? 'Nearest station'
      : `CAMS model ×1.25 (station ${km > 25 ? 'too far' : 'too old'})`;
    const [, category, verdict] = categories.find(([max]) => aqi <= max)!;
    out('category').textContent = category;
    out('verdict').textContent = verdict;
  };
  demo.addEventListener('input', update);
  update();
});

// Demo: AQI Vision's split.
document.querySelectorAll<HTMLElement>('[data-demo="split"]').forEach((demo) => {
  const buttons = [...demo.querySelectorAll<HTMLButtonElement>('[data-acc]')];
  const out = (name: string) => demo.querySelector<HTMLElement>(`[data-out="${name}"]`)!;
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      const acc = parseFloat(button.dataset.acc!);
      out('bar').style.setProperty('--v', String(acc));
      out('acc').textContent = `${Math.round(acc * 100)}%`;
      out('note').textContent = button.dataset.note!;
    }),
  );
});

// Post contents: mark the section being read.
(() => {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.toc a')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute('aria-current'));
        byId.get(entry.target.id)?.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '0px 0px -70% 0px' },
  );
  byId.forEach((_, id) => {
    const heading = document.getElementById(id);
    if (heading) io.observe(heading);
  });
})();

// Colour theme: follows the system until the visitor picks one; the choice is kept per visitor.
(() => {
  const menu = document.querySelector<HTMLElement>('[data-themes]');
  if (!menu) return;
  menu.hidden = false;
  const root = document.documentElement;
  const toggle = menu.querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
  const list = menu.querySelector<HTMLElement>('#theme-list')!;
  const buttons = [...list.querySelectorAll<HTMLButtonElement>('[data-theme-set]')];
  const show = () => {
    const current = root.dataset.theme || 'auto';
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === current)));
  };
  const open = (yes: boolean) => {
    toggle.setAttribute('aria-expanded', String(yes));
    list.hidden = !yes;
  };
  show();
  toggle.addEventListener('click', () => open(list.hidden));
  list.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-set]');
    if (!button) return;
    const theme = button.dataset.themeSet!;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch {}
    show();
  });
  document.addEventListener('click', (event) => {
    if (!list.hidden && !menu.contains(event.target as Node)) open(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !list.hidden) {
      open(false);
      toggle.focus();
    }
  });
})();
