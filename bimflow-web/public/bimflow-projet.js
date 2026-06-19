// Shared context injected on all app pages.
// Manages the active project pill + the user session gear menu in the topbar.
(function () {
  'use strict';

  // ── Escape helper ──
  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ══════════════════════════════════════════════
  //  PROJECT  (unchanged public API)
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

    injectProjectPill(tbr);
    injectUserMenu(tbr);
  }

  // ── Project pill ──
  function injectProjectPill(tbr) {
    const p = window.BFProject.current;
    const pill = document.createElement('div');
    pill.id = 'bfp-pill';
    pill.style.cssText =
      'display:flex;align-items:center;gap:5px;background:#0c1a2e;border:1px solid #1e3a5f;' +
      'border-radius:20px;padding:3px 10px 3px 8px;cursor:pointer;font-size:11px;font-weight:700;' +
      'color:#38bdf8;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis';
    pill.title = 'Changer de projet';
    if (p) {
      const name = p.displayName || p.projectName || p.code;
      pill.innerHTML = `<span style="font-size:9px;color:#475569">📁</span><span style="overflow:hidden;text-overflow:ellipsis">${_esc(name)}</span>`;
    } else {
      pill.style.color        = '#f59e0b';
      pill.style.borderColor  = '#713f12';
      pill.style.background   = '#1c0f00';
      pill.innerHTML = '<span>⚠ Tous les projets</span>';
    }
    pill.onclick = () => { window.location.href = '/projets.html'; };
    tbr.insertBefore(pill, tbr.firstChild);
  }

  // ── User gear menu ──
  function injectUserMenu(tbr) {
    const user = window.BFUser.current;

    if (!user) {
      // Show "Connexion" button
      const btn = document.createElement('a');
      btn.href = '/accueil.html';
      btn.style.cssText =
        'display:flex;align-items:center;gap:5px;background:transparent;border:1px solid #334155;' +
        'border-radius:7px;padding:4px 10px;font-size:12px;font-weight:700;color:#64748b;' +
        'text-decoration:none;cursor:pointer;transition:all .2s;white-space:nowrap';
      btn.innerHTML = '🔐 Connexion';
      btn.onmouseover = () => { btn.style.borderColor = '#38bdf8'; btn.style.color = '#38bdf8'; };
      btn.onmouseout  = () => { btn.style.borderColor = '#334155'; btn.style.color = '#64748b'; };
      tbr.appendChild(btn);
      return;
    }

    // Wrapper
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:flex;align-items:center';

    // Avatar + gear button
    const gBtn = document.createElement('button');
    gBtn.id = 'bfp-gear';
    gBtn.style.cssText =
      'display:flex;align-items:center;gap:6px;background:transparent;border:1px solid #334155;' +
      'border-radius:8px;padding:4px 10px 4px 5px;cursor:pointer;color:#94a3b8;transition:all .2s';

    const avatarHTML = user.picture
      ? `<img src="${_esc(user.picture)}" style="width:24px;height:24px;border-radius:50%;border:1px solid #334155" alt=""/>`
      : `<div style="width:24px;height:24px;border-radius:50%;background:#1f2937;display:flex;align-items:center;justify-content:center;font-size:12px">👤</div>`;

    gBtn.innerHTML = `${avatarHTML}<span style="font-size:12px;font-weight:700;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(user.name.split(' ')[0])}</span><span style="font-size:13px">⚙</span>`;
    gBtn.onmouseover = () => { gBtn.style.borderColor = '#38bdf8'; gBtn.style.color = '#e2e8f0'; };
    gBtn.onmouseout  = () => { gBtn.style.borderColor = '#334155'; gBtn.style.color = '#94a3b8'; };

    // Dropdown
    const drop = document.createElement('div');
    drop.id = 'bfp-drop';
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
      ${dropLink('/profil.html', '👤', 'Mon profil', 'Paramètres du compte')}
      ${dropLink('/projets.html', '📁', 'Mes projets', 'Gérer et créer des projets')}
      <div style="height:1px;background:#1f2937;margin:6px 0"></div>
      <button id="bfp-logout"
        style="display:flex;width:100%;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
               background:transparent;border:none;cursor:pointer;color:#f87171;font-size:13px;font-weight:600;text-align:left"
        onmouseover="this.style.background='rgba(127,29,29,.25)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px">🚪</span>
        <div><div style="line-height:1.2">Déconnexion</div></div>
      </button>`;

    // Toggle dropdown
    gBtn.onclick = (e) => {
      e.stopPropagation();
      drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('click', () => { drop.style.display = 'none'; });
    drop.addEventListener('click', (e) => e.stopPropagation());

    wrap.appendChild(gBtn);
    wrap.appendChild(drop);
    tbr.appendChild(wrap);

    // Logout handler (set after DOM append)
    setTimeout(() => {
      const logoutBtn = document.getElementById('bfp-logout');
      if (logoutBtn) logoutBtn.onclick = () => {
        localStorage.removeItem('bimflow_user');
        window.location.href = '/accueil.html';
      };
    }, 0);
  }

  function dropLink(href, icon, label, sub) {
    return `<a href="${href}"
      style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
             color:#94a3b8;text-decoration:none;font-size:13px;font-weight:600;transition:background .15s"
      onmouseover="this.style.background='#1f2937'" onmouseout="this.style.background='transparent'">
      <span style="font-size:16px">${icon}</span>
      <div>
        <div style="color:#e2e8f0;line-height:1.2">${label}</div>
        <div style="font-size:11px;color:#475569;font-weight:400">${sub}</div>
      </div>
    </a>`;
  }

  // ── Boot ──
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
