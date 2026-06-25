// BIMFlow shared context — auth guard, nav menu, project switcher, user gear.
(function () {
  'use strict';

  // ── CSS variables — injected once so all dynamic elements respect dark/light ──
  if (!document.getElementById('bfp-vars')) {
    const st = document.createElement('style');
    st.id = 'bfp-vars';
    st.textContent = `
      :root {
        --bfp-bg:     #111827; --bfp-bg2:    #0a1120;
        --bfp-bd:     #374151; --bfp-bd2:    #1e3a5f;
        --bfp-tx:     #e2e8f0; --bfp-sub:    #475569;
        --bfp-acc:    #38bdf8; --bfp-hov:    #1f2937;
        --bfp-abg:    #0c1a2e; --bfp-abd:    #1e3a5f;
        --bfp-tbg:    #111827; --bfp-tbd:    #1f2937;
        --bfp-proj-bg:#1c0f00; --bfp-proj-bd:#713f12; --bfp-proj-tx:#f59e0b;
      }
      [data-theme=light] {
        --bfp-bg:     #ffffff; --bfp-bg2:    #f8fafc;
        --bfp-bd:     #e2e8f0; --bfp-bd2:    #93c5fd;
        --bfp-tx:     #1e293b; --bfp-sub:    #64748b;
        --bfp-acc:    #0284c7; --bfp-hov:    #f1f5f9;
        --bfp-abg:    #e7f3fc; --bfp-abd:    #93c5fd;
        --bfp-tbg:    #ffffff; --bfp-tbd:    #e2e8f0;
        --bfp-proj-bg:#fffbeb; --bfp-proj-bd:#fcd34d; --bfp-proj-tx:#92400e;
      }
      .bfp-drop {
        position:absolute;top:calc(100% + 6px);background:var(--bfp-bg);
        border:1px solid var(--bfp-bd);border-radius:12px;padding:8px;
        min-width:240px;z-index:9999;box-shadow:0 24px 50px rgba(0,0,0,.45);
      }
      .bfp-item {
        display:flex;width:100%;align-items:center;gap:10px;padding:9px 12px;
        border-radius:8px;background:transparent;border:1px solid transparent;
        cursor:pointer;text-align:left;transition:background .12s;
        color:var(--bfp-tx);font-size:13px;font-weight:600;font-family:inherit;
        text-decoration:none;
      }
      .bfp-item:hover { background:var(--bfp-hov); }
      .bfp-item.active {
        background:var(--bfp-abg);border-color:var(--bfp-abd);
        color:var(--bfp-acc);font-weight:800;
      }
      .bfp-item-icon  { font-size:16px;flex-shrink:0 }
      .bfp-item-body  { flex:1;min-width:0 }
      .bfp-item-label { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      .bfp-item-sub   { font-size:10px;color:var(--bfp-sub);margin-top:1px;font-weight:400 }
      .bfp-sep        { height:1px;background:var(--bfp-tbd);margin:6px 0 }
      .bfp-tb-btn {
        display:flex;align-items:center;gap:6px;height:100%;padding:0 12px;
        background:transparent;border:none;cursor:pointer;font-size:13px;
        font-weight:700;color:var(--bfp-acc);white-space:nowrap;font-family:inherit;
        transition:background .15s;
      }
      .bfp-tb-btn:hover { background:var(--bfp-hov); }
      .bfp-proj-pill {
        display:flex;align-items:center;gap:5px;
        background:var(--bfp-proj-bg);border:1px solid var(--bfp-proj-bd);
        border-radius:7px;padding:4px 10px;cursor:pointer;font-size:12px;
        font-weight:700;color:var(--bfp-proj-tx);
        max-width:180px;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;transition:all .2s;font-family:inherit;
      }
      .bfp-proj-pill.has-proj {
        background:var(--bfp-abg);border-color:var(--bfp-abd);
        color:var(--bfp-acc);
      }
      .bfp-gear-btn {
        display:flex;align-items:center;gap:6px;background:transparent;
        border:1px solid var(--bfp-bd);border-radius:8px;
        padding:4px 10px 4px 5px;cursor:pointer;color:var(--bfp-sub);
        transition:all .2s;font-family:inherit;
      }
      .bfp-gear-btn:hover { border-color:var(--bfp-acc);color:var(--bfp-acc); }
    `;
    document.head.appendChild(st);
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function L(fr, en) { return document.documentElement.lang === 'en' ? en : fr; }

  // ── Handle ?bfauth= callback from email confirmation ──
  (function handleAuthCallback() {
    const p = new URLSearchParams(window.location.search);
    const raw = p.get('bfauth');
    if (!raw) return;
    try {
      const data = JSON.parse(decodeURIComponent(raw));
      if (data.email) {
        localStorage.setItem('bimflow_user', JSON.stringify({
          name: data.name || data.email,
          email: data.email,
          plan: data.plan || 'free',
          session: data.session || '',
          initial: (data.name || data.email).charAt(0).toUpperCase(),
        }));
      }
    } catch {}
    const clean = new URL(window.location.href);
    clean.searchParams.delete('bfauth');
    window.history.replaceState({}, '', clean.toString());
  })();

  // ── AUTH GUARD — redirect if not logged in (skip on /accueil.html) ──
  if (window.location.pathname !== '/accueil.html') {
    try {
      const u = JSON.parse(localStorage.getItem('bimflow_user') || 'null');
      if (!u || !u.email) { window.location.replace('/accueil.html'); return; }
    } catch { window.location.replace('/accueil.html'); return; }
  }

  // ── PUBLIC APIs ──
  window.BFProject = {
    get current() {
      try { return JSON.parse(localStorage.getItem('bimflow_project') || 'null'); } catch { return null; }
    },
    clear() { try { localStorage.removeItem('bimflow_project'); } catch {} },
    set(p)  { try { localStorage.setItem('bimflow_project', JSON.stringify(p)); } catch {} },
    qs() {
      const p = this.current;
      if (!p) return '';
      if (p.code && p.code !== '__legacy__') return `?code=${encodeURIComponent(p.code)}`;
      if (p.projectName) return `?project=${encodeURIComponent(p.projectName)}`;
      return '';
    },
    plansUrl() { return '/api/plans' + this.qs(); },
  };

  window.BFUser = {
    get current() {
      try { return JSON.parse(localStorage.getItem('bimflow_user') || 'null'); } catch { return null; }
    },
    clear() { try { localStorage.removeItem('bimflow_user'); } catch {} },
  };

  // Auth header helper — used by all API calls in app pages
  window.BFAuth = {
    headers() {
      const s = (window.BFUser.current || {}).session || '';
      return s ? { 'Authorization': 'Bearer ' + s } : {};
    },
    async fetch(url, opts = {}) {
      opts.headers = { ...this.headers(), ...(opts.headers || {}) };
      return fetch(url, opts);
    },
  };

  // ══════════════════════════════════════════════
  //  INJECT
  // ══════════════════════════════════════════════
  function inject() {
    injectNavMenu();
    const tbr  = document.querySelector('.tbr, .topbar-right');
    if (!tbr) return;
    const meta = document.querySelector('.topbar-meta') || tbr;
    injectReloadButton(tbr);
    injectProjectSwitcher(meta);
    injectUserMenu(tbr);
  }

  function injectReloadButton(tbr) {
    // Skip pages that already provide their own refresh control (e.g. the plan
    // page's #btnRefresh) to avoid a duplicate "🔄 Actualiser" button.
    if (document.getElementById('btnRefresh')) return;
    const btn = document.createElement('button');
    btn.className = 'bfp-gear-btn';
    btn.style.marginRight = '4px';
    btn.innerHTML = `<span style="font-size:14px">🔄</span><span style="font-size:12px;font-weight:700" data-en="Reload">Actualiser</span>`;
    btn.title = "Actualiser les données";
    btn.addEventListener('click', () => window.location.reload());
    tbr.insertBefore(btn, tbr.firstChild);
  }

  // ── Nav hamburger menu ──
  function injectNavMenu() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const existingNav = topbar.querySelector('.nav');
    if (existingNav) existingNav.style.display = 'none';

    const path = window.location.pathname;
    const items = [
      { href: '/',                icon: '🗺', label: 'Plans',            labelEn: 'Plans' },
      { href: '/fiches.html',     icon: '📋', label: 'Fiches de Locaux', labelEn: 'Data Sheets' },
      { href: '/analyse.html',    icon: '📊', label: 'Analyse',          labelEn: 'Analysis' },
      { href: '/parametres.html', icon: '🔧', label: 'Paramètres',       labelEn: 'Parameters' },
      { href: '/projets.html',    icon: '📁', label: 'Projets',          labelEn: 'Projects' },
      { href: '/profil.html',     icon: '👤', label: 'Profil',           labelEn: 'Profile' },
    ];
    const cur = items.find(i => i.href === path)
             || items.find(i => i.href !== '/' && path.startsWith(i.href));

    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:relative;display:flex;align-items:center;height:100%;' +
      'border-right:1px solid var(--bfp-tbd)';

    const btn = document.createElement('button');
    btn.className = 'bfp-tb-btn';
    btn.style.borderRight = 'none';
    const curLabel = cur ? L(cur.label, cur.labelEn) : 'Menu';
    const curLabelEn = cur ? cur.labelEn : 'Menu';
    btn.innerHTML =
      `<span style="font-size:17px;line-height:1">☰</span>` +
      `<span data-en="${_esc(curLabelEn)}">${_esc(curLabel)}</span>` +
      `<span style="font-size:10px;opacity:.5">▾</span>`;

    const drop = document.createElement('div');
    drop.className = 'bfp-drop';
    drop.style.cssText += ';display:none;left:0';

    items.forEach(item => {
      const a = bfpItem(item.icon, item.label, item === cur);
      a.href = item.href;
      a.tagName === 'BUTTON' && (a.onclick = () => { window.location.href = item.href; });
      if (a.tagName === 'BUTTON') {
        // convert to anchor
      }
      const link = document.createElement('a');
      link.href = item.href;
      link.className = 'bfp-item' + (item === cur ? ' active' : '');
      link.innerHTML =
        `<span class="bfp-item-icon">${item.icon}</span>` +
        `<span class="bfp-item-body"><span class="bfp-item-label" data-en="${_esc(item.labelEn)}">${L(item.label, item.labelEn)}</span></span>` +
        (item === cur ? `<span style="color:var(--bfp-acc);font-size:12px">●</span>` : '');
      drop.appendChild(link);
    });

    toggleDrop(btn, drop);
    wrap.appendChild(btn);
    wrap.appendChild(drop);

    const logo = topbar.querySelector('.logo');
    if (logo) topbar.insertBefore(wrap, logo);
    else topbar.insertBefore(wrap, topbar.firstChild);
  }

  // ── Project switcher ──
  function injectProjectSwitcher(tbr) {
    const cur = window.BFProject.current;
    const name = cur ? (cur.displayName || cur.projectName || cur.code) : null;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:flex;align-items:center;margin-right:4px';

    const btn = document.createElement('button');
    btn.className = 'bfp-proj-pill' + (name ? ' has-proj' : '');
    btn.innerHTML =
      `<span>📁</span>` +
      `<span data-en="${name ? _esc(name) : 'All projects'}" style="overflow:hidden;text-overflow:ellipsis;max-width:120px">${name ? _esc(name) : L('Tous les projets','All projects')}</span>` +
      `<span style="font-size:10px;opacity:.5">▾</span>`;

    const drop = document.createElement('div');
    drop.className = 'bfp-drop';
    drop.style.cssText += ';display:none;left:0';

    let loaded = false;

    // Single listener — no double-binding with toggleDrop
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (drop.style.display !== 'none') { drop.style.display = 'none'; return; }
      drop.style.display = 'block';
      if (loaded) return;
      drop.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:var(--bfp-sub)">${L('Chargement…','Loading…')}</div>`;
      try {
        const session = (window.BFUser.current || {}).session || '';
        const r = await fetch('/api/projets', {
          headers: session ? { 'Authorization': 'Bearer ' + session } : {},
        });
        const projects = await r.json();
        loaded = true;
        // If stored project not in accessible list → clear it silently
        const valid = (projects || []).filter(p => p.code !== '__legacy__');
        if (cur && !valid.find(p => p.code === cur.code)) {
          localStorage.removeItem('bimflow_project');
          btn.className = 'bfp-proj-pill';
          btn.innerHTML =
            `<span>📁</span>` +
            `<span style="overflow:hidden;text-overflow:ellipsis;max-width:120px">${L('Mes projets','My projects')}</span>` +
            `<span style="font-size:10px;opacity:.5">▾</span>`;
        }
        renderProjDrop(drop, projects, cur);
      } catch (err) {
        drop.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:#f87171">${L('Erreur : ','Error: ')}${_esc(err.message)}</div>`;
      }
    });

    // Close on outside click; stop propagation inside dropdown
    document.addEventListener('click', () => { drop.style.display = 'none'; });
    drop.addEventListener('click', e => e.stopPropagation());

    wrap.appendChild(btn);
    wrap.appendChild(drop);
    tbr.insertBefore(wrap, tbr.firstChild);
  }

  function renderProjDrop(drop, projects, cur) {
    drop.innerHTML = '';
    const valid = (projects || []).filter(p => p.code !== '__legacy__');

    // "Tous les projets"
    const allBtn = bfpItem('🌐', L('Tous les projets','All projects'), !cur, L('Voir tous les projets sans filtre','View all projects'));
    allBtn.addEventListener('click', () => {
      localStorage.removeItem('bimflow_project');
      window.location.reload();
    });
    drop.appendChild(allBtn);
    drop.appendChild(bfpSep());

    if (!valid.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--bfp-sub)';
      empty.textContent = L('Aucun projet — envoyez des plans depuis Revit','No projects — send plans from Revit');
      drop.appendChild(empty);
    } else {
      valid.forEach(p => {
        const pName = p.displayName || p.projectName || p.code;
        const sel = !!(cur && cur.code === p.code);
        const sub = `${p.code} · ${p.plans || 0} ${L('niv.','lvl.')} · ${p.rooms || 0} ${L('pièces','rooms')}`;
        const item = bfpItem('📁', pName, sel, sub);
        item.addEventListener('click', () => {
          localStorage.setItem('bimflow_project', JSON.stringify({
            code: p.code,
            displayName: pName,
            projectName: p.projectName || '',
          }));
          window.location.reload();
        });
        drop.appendChild(item);
      });
    }

    drop.appendChild(bfpSep());
    const manage = document.createElement('a');
    manage.href = '/projets.html';
    manage.className = 'bfp-item';
    manage.innerHTML = `<span class="bfp-item-icon">⚙</span><span class="bfp-item-body"><span class="bfp-item-label" data-en="Manage projects">${L('Gérer les projets','Manage projects')}</span></span>`;
    drop.appendChild(manage);
  }

  // ── User gear menu ──
  function injectUserMenu(tbr) {
    const user = window.BFUser.current;

    if (!user) {
      const btn = document.createElement('a');
      btn.href = '/accueil.html';
      btn.className = 'bfp-gear-btn';
      btn.innerHTML = `🔐 <span data-en="Sign in">${L('Connexion','Sign in')}</span>`;
      tbr.appendChild(btn);
      return;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:flex;align-items:center';

    const initial = (user.initial || user.name || '?').charAt(0).toUpperCase();
    const avatarHTML = user.picture
      ? `<img src="${_esc(user.picture)}" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--bfp-bd)" alt=""/>`
      : `<div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0">${initial}</div>`;

    const gBtn = document.createElement('button');
    gBtn.className = 'bfp-gear-btn';
    gBtn.innerHTML =
      `${avatarHTML}` +
      `<span style="font-size:12px;font-weight:700;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bfp-tx)">${_esc(user.name.split(' ')[0])}</span>` +
      `<span style="font-size:13px">⚙</span>`;

    const drop = document.createElement('div');
    drop.className = 'bfp-drop';
    drop.style.cssText += ';display:none;right:0;left:auto';

    const planBadge = user.plan === 'pro'
      ? '<span style="background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.35);color:#a78bfa;border-radius:10px;padding:2px 8px;font-size:9px;font-weight:800">PRO</span>'
      : `<span style="background:rgba(29,78,216,.15);border:1px solid rgba(29,78,216,.25);color:#60a5fa;border-radius:10px;padding:2px 8px;font-size:9px;font-weight:800" data-en="FREE">${L('GRATUIT','FREE')}</span>`;

    const header = document.createElement('div');
    header.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--bfp-tbd);margin-bottom:6px';
    header.innerHTML =
      `<div style="font-size:13px;font-weight:800;color:var(--bfp-tx);margin-bottom:2px">${_esc(user.name)}</div>` +
      `<div style="font-size:11px;color:var(--bfp-sub);margin-bottom:6px">${_esc(user.email)}</div>` +
      planBadge;
    drop.appendChild(header);

    [
      ['/profil.html',  '👤', 'Mon profil',  'Paramètres du compte',         'My profile',  'Account settings'],
      ['/projets.html', '📁', 'Mes projets', 'Gérer et créer des projets',    'My projects', 'Manage and create projects'],
    ].forEach(([href, icon, label, sub, labelEn, subEn]) => {
      const a = document.createElement('a');
      a.href = href;
      a.className = 'bfp-item';
      a.innerHTML =
        `<span class="bfp-item-icon">${icon}</span>` +
        `<span class="bfp-item-body"><span class="bfp-item-label" data-en="${_esc(labelEn)}">${L(label,labelEn)}</span>` +
        `<span class="bfp-item-sub" data-en="${_esc(subEn)}">${L(sub,subEn)}</span></span>`;
      drop.appendChild(a);
    });

    drop.appendChild(bfpSep());

    const delBtn = document.createElement('button');
    delBtn.className = 'bfp-item';
    delBtn.style.color = '#f87171';
    delBtn.innerHTML =
      `<span class="bfp-item-icon">🗑</span>` +
      `<span class="bfp-item-body"><span class="bfp-item-label" data-en="Delete my account">${L('Supprimer mon compte','Delete my account')}</span><span class="bfp-item-sub" data-en="Irreversible action">${L('Action irréversible','Irreversible action')}</span></span>`;
    delBtn.addEventListener('click', async () => {
      if (!confirm(L('Supprimer définitivement votre compte ?\n\nVos projets seront transférés à l\'administrateur. Cette action est irréversible.','Permanently delete your account?\n\nYour projects will be transferred to the administrator. This action is irreversible.'))) return;
      try {
        const session = (window.BFUser.current || {}).session || '';
        const r = await fetch('/api/auth/account', {
          method: 'DELETE',
          headers: session ? { 'Authorization': 'Bearer ' + session } : {},
        });
        const d = await r.json();
        if (!r.ok) { alert(L('Erreur : ','Error: ') + (d.error || r.status)); return; }
        localStorage.removeItem('bimflow_user');
        localStorage.removeItem('bimflow_project');
        window.location.href = '/accueil.html';
      } catch (e) { alert(L('Erreur réseau : ','Network error: ') + e.message); }
    });
    drop.appendChild(delBtn);

    drop.appendChild(bfpSep());

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'bfp-item';
    logoutBtn.style.color = '#f87171';
    logoutBtn.innerHTML =
      `<span class="bfp-item-icon">🚪</span>` +
      `<span class="bfp-item-body"><span class="bfp-item-label" data-en="Sign out">${L('Déconnexion','Sign out')}</span></span>`;
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('bimflow_user');
      localStorage.removeItem('bimflow_project');
      window.location.href = '/accueil.html';
    });
    drop.appendChild(logoutBtn);

    toggleDrop(gBtn, drop, wrap);
    wrap.appendChild(gBtn);
    wrap.appendChild(drop);
    tbr.appendChild(wrap);
  }

  // ── Helpers ──
  function bfpItem(icon, label, active, sub) {
    const btn = document.createElement('button');
    btn.className = 'bfp-item' + (active ? ' active' : '');
    btn.innerHTML =
      `<span class="bfp-item-icon">${icon}</span>` +
      `<span class="bfp-item-body">` +
        `<span class="bfp-item-label">${_esc(label)}</span>` +
        (sub ? `<span class="bfp-item-sub">${_esc(sub)}</span>` : '') +
      `</span>` +
      (active ? `<span style="color:var(--bfp-acc);font-size:13px">✓</span>` : '');
    return btn;
  }

  function bfpSep() {
    const d = document.createElement('div');
    d.className = 'bfp-sep';
    return d;
  }

  function toggleDrop(btn, drop, stopEl) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { drop.style.display = 'none'; });
    if (stopEl) stopEl.addEventListener('click', e => e.stopPropagation());
    else drop.addEventListener('click', e => e.stopPropagation());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
