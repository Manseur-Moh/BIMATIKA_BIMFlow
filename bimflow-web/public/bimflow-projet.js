// Shared context injected on all app pages.
// Manages: auth guard, project switcher dropdown, user gear menu.
(function () {
  'use strict';

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ══════════════════════════════════════════════
  //  AUTH GUARD  — redirect to /accueil.html if not logged in
  //  (skipped on accueil.html itself)
  // ══════════════════════════════════════════════
  if (window.location.pathname !== '/accueil.html') {
    try {
      const u = JSON.parse(localStorage.getItem('bimflow_user') || 'null');
      if (!u || !u.email) { window.location.replace('/accueil.html'); return; }
    } catch { window.location.replace('/accueil.html'); return; }
  }

  // ══════════════════════════════════════════════
  //  PROJECT  public API
  // ══════════════════════════════════════════════
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

  // ══════════════════════════════════════════════
  //  USER SESSION
  // ══════════════════════════════════════════════
  window.BFUser = {
    get current() {
      try { return JSON.parse(localStorage.getItem('bimflow_user') || 'null'); } catch { return null; }
    },
    clear() { try { localStorage.removeItem('bimflow_user'); } catch {} },
  };

  // ══════════════════════════════════════════════
  //  INJECT TOPBAR ELEMENTS
  // ══════════════════════════════════════════════
  function inject() {
    const tbr = document.querySelector('.tbr, .topbar-right');
    if (!tbr) return;
    injectProjectSwitcher(tbr);
    injectUserMenu(tbr);
  }

  // ── Project switcher dropdown ──
  function injectProjectSwitcher(tbr) {
    const cur = window.BFProject.current;
    const name = cur ? (cur.displayName || cur.projectName || cur.code) : null;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:flex;align-items:center;margin-right:4px';

    const btn = document.createElement('button');
    btn.id = 'bfp-proj-btn';
    btn.style.cssText =
      `display:flex;align-items:center;gap:5px;` +
      `background:${name ? '#0c1a2e' : '#1c0f00'};` +
      `border:1px solid ${name ? '#1e3a5f' : '#713f12'};` +
      `border-radius:7px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:700;` +
      `color:${name ? '#38bdf8' : '#f59e0b'};max-width:180px;white-space:nowrap;` +
      `overflow:hidden;text-overflow:ellipsis;transition:all .2s`;
    btn.innerHTML =
      `<span>📁</span>` +
      `<span style="overflow:hidden;text-overflow:ellipsis;max-width:120px">${name ? _esc(name) : 'Tous les projets'}</span>` +
      `<span style="font-size:10px;opacity:.6">▾</span>`;

    const drop = document.createElement('div');
    drop.id = 'bfp-proj-drop';
    drop.style.cssText =
      'position:absolute;top:calc(100% + 8px);left:0;background:#111827;border:1px solid #374151;' +
      'border-radius:12px;padding:8px;min-width:260px;display:none;z-index:9999;' +
      'box-shadow:0 24px 50px rgba(0,0,0,.65)';

    let loaded = false;

    btn.onclick = async (e) => {
      e.stopPropagation();
      if (drop.style.display !== 'none') { drop.style.display = 'none'; return; }
      drop.style.display = 'block';
      if (loaded) return;
      drop.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:#475569">Chargement…</div>';
      try {
        const r = await fetch('/api/projets');
        const projects = await r.json();
        loaded = true;
        renderProjDrop(drop, projects, cur);
      } catch (err) {
        drop.innerHTML = `<div style="padding:10px 12px;font-size:12px;color:#f87171">Erreur : ${err.message}</div>`;
      }
    };

    document.addEventListener('click', () => { drop.style.display = 'none'; });
    drop.addEventListener('click', e => e.stopPropagation());

    wrap.appendChild(btn);
    wrap.appendChild(drop);
    tbr.insertBefore(wrap, tbr.firstChild);
  }

  function renderProjDrop(drop, projects, cur) {
    const valid = (projects || []).filter(p => p.code !== '__legacy__');
    let html = '';

    // "Tous les projets" item
    const allSel = !cur;
    html += projItem(null, '🌐', 'Tous les projets', 'Voir tous les projets sans filtre', allSel, 'bfSwitchProject(null)');
    html += '<div style="height:1px;background:#1f2937;margin:6px 0"></div>';

    if (!valid.length) {
      html += '<div style="padding:8px 12px;font-size:12px;color:#475569">Aucun projet — envoyez des plans depuis Revit</div>';
    } else {
      valid.forEach(p => {
        const pName = p.displayName || p.projectName || p.code;
        const sel = cur && cur.code === p.code;
        const sub = `${p.code} · ${p.plans||0} niv. · ${p.rooms||0} pièces`;
        const payload = JSON.stringify({code: p.code, displayName: pName, projectName: p.projectName||''}).replace(/'/g, "\\'");
        html += projItem(p, '📁', _esc(pName), sub, sel, `bfSwitchProject('${payload}')`);
      });
    }

    html += '<div style="height:1px;background:#1f2937;margin:6px 0"></div>';
    html += `<a href="/projets.html"
      style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;
             color:#64748b;text-decoration:none;font-size:12px;font-weight:600"
      onmouseover="this.style.background='#1f2937'" onmouseout="this.style.background='transparent'">
      <span>⚙</span> Gérer les projets</a>`;

    drop.innerHTML = html;
  }

  window.bfSwitchProject = function(payload) {
    if (!payload) {
      localStorage.removeItem('bimflow_project');
    } else {
      const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
      localStorage.setItem('bimflow_project', JSON.stringify(obj));
    }
    window.location.reload();
  };

  function projItem(p, icon, label, sub, active, onclick) {
    const activeBg   = active ? '#0c1a2e' : 'transparent';
    const activeBdr  = active ? '1px solid #1e3a5f' : '1px solid transparent';
    const labelColor = active ? '#38bdf8' : '#e2e8f0';
    return `<button onclick="${onclick}"
      style="display:flex;width:100%;align-items:center;gap:10px;padding:8px 12px;
             border-radius:8px;background:${activeBg};border:${activeBdr};
             cursor:pointer;text-align:left;"
      onmouseover="this.style.background='#1f2937'" onmouseout="this.style.background='${activeBg}'">
      <span style="font-size:16px">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:${active?'800':'600'};color:${labelColor};
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</div>
        <div style="font-size:10px;color:#475569;margin-top:1px">${sub}</div>
      </div>
      ${active ? '<span style="color:#38bdf8;font-size:13px">✓</span>' : ''}
    </button>`;
  }

  // ── User gear menu ──
  function injectUserMenu(tbr) {
    const user = window.BFUser.current;

    if (!user) {
      const btn = document.createElement('a');
      btn.href = '/accueil.html';
      btn.style.cssText =
        'display:flex;align-items:center;gap:5px;background:transparent;border:1px solid #334155;' +
        'border-radius:7px;padding:4px 10px;font-size:12px;font-weight:700;color:#64748b;text-decoration:none;white-space:nowrap';
      btn.innerHTML = '🔐 Connexion';
      tbr.appendChild(btn);
      return;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:flex;align-items:center';

    const initial = (user.initial || user.name || '?').charAt(0).toUpperCase();
    const avatarHTML = user.picture
      ? `<img src="${_esc(user.picture)}" style="width:24px;height:24px;border-radius:50%;border:1px solid #334155" alt=""/>`
      : `<div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff">${initial}</div>`;

    const gBtn = document.createElement('button');
    gBtn.id = 'bfp-gear';
    gBtn.style.cssText =
      'display:flex;align-items:center;gap:6px;background:transparent;border:1px solid #334155;' +
      'border-radius:8px;padding:4px 10px 4px 5px;cursor:pointer;color:#94a3b8;transition:all .2s';
    gBtn.innerHTML =
      `${avatarHTML}` +
      `<span style="font-size:12px;font-weight:700;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(user.name.split(' ')[0])}</span>` +
      `<span style="font-size:13px">⚙</span>`;

    const drop = document.createElement('div');
    drop.style.cssText =
      'position:absolute;top:calc(100% + 8px);right:0;background:#111827;border:1px solid #374151;' +
      'border-radius:12px;padding:8px;min-width:220px;display:none;z-index:9999;' +
      'box-shadow:0 24px 50px rgba(0,0,0,.6)';

    const planBadge = user.plan === 'pro'
      ? '<span style="background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.35);color:#a78bfa;border-radius:10px;padding:2px 8px;font-size:9px;font-weight:800">PRO</span>'
      : '<span style="background:rgba(29,78,216,.15);border:1px solid rgba(29,78,216,.25);color:#60a5fa;border-radius:10px;padding:2px 8px;font-size:9px;font-weight:800">GRATUIT</span>';

    drop.innerHTML = `
      <div style="padding:10px 12px;border-bottom:1px solid #1f2937;margin-bottom:6px">
        <div style="font-size:13px;font-weight:800;color:#f1f5f9;margin-bottom:2px">${_esc(user.name)}</div>
        <div style="font-size:11px;color:#475569;margin-bottom:6px">${_esc(user.email)}</div>
        ${planBadge}
      </div>
      ${dropLink('/profil.html',  '👤', 'Mon profil',   'Paramètres du compte')}
      ${dropLink('/projets.html', '📁', 'Mes projets',  'Gérer et créer des projets')}
      <div style="height:1px;background:#1f2937;margin:6px 0"></div>
      <button id="bfp-logout"
        style="display:flex;width:100%;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
               background:transparent;border:none;cursor:pointer;color:#f87171;font-size:13px;font-weight:600;text-align:left"
        onmouseover="this.style.background='rgba(127,29,29,.25)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px">🚪</span>
        <div style="line-height:1.2">Déconnexion</div>
      </button>`;

    gBtn.onclick = (e) => {
      e.stopPropagation();
      drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('click', () => { drop.style.display = 'none'; });
    drop.addEventListener('click', e => e.stopPropagation());

    wrap.appendChild(gBtn);
    wrap.appendChild(drop);
    tbr.appendChild(wrap);

    setTimeout(() => {
      const lb = document.getElementById('bfp-logout');
      if (lb) lb.onclick = () => {
        localStorage.removeItem('bimflow_user');
        window.location.href = '/accueil.html';
      };
    }, 0);
  }

  function dropLink(href, icon, label, sub) {
    return `<a href="${href}"
      style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
             color:#94a3b8;text-decoration:none;font-size:13px;font-weight:600"
      onmouseover="this.style.background='#1f2937'" onmouseout="this.style.background='transparent'">
      <span style="font-size:16px">${icon}</span>
      <div>
        <div style="color:#e2e8f0;line-height:1.2">${label}</div>
        <div style="font-size:11px;color:#475569;font-weight:400">${sub}</div>
      </div>
    </a>`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
