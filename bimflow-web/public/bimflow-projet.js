// Shared project context — included by Plans, Fiches, Analyse, Paramètres pages.
// Reads/writes bimflow_project from localStorage.
// Injects a project indicator into .tbr and wraps the plans API call.
(function(){
  'use strict';

  /* ── Public API ── */
  window.BFProject = {
    get current(){ try{return JSON.parse(localStorage.getItem('bimflow_project')||'null');}catch{return null;} },
    clear(){ try{localStorage.removeItem('bimflow_project');}catch{} },
    set(p){ try{localStorage.setItem('bimflow_project',JSON.stringify(p));}catch{} },
    /* Returns query string for plans API filter, empty = all projects */
    qs(){
      const p=this.current;
      if(!p) return '';
      /* Real project code (from GUID or ProjectNumber) → filter by code */
      if(p.code && p.code !== '__legacy__') return `?code=${encodeURIComponent(p.code)}`;
      /* Legacy project (no code) → filter by project name */
      if(p.projectName) return `?project=${encodeURIComponent(p.projectName)}`;
      return '';
    },
    /* Plans list URL (with project filter if one is active) */
    plansUrl(){ return '/api/plans' + this.qs(); },
  };

  /* ── Inject project pill into topbar once DOM is ready ── */
  function inject(){
    const tbr = document.querySelector('.tbr, .topbar-right');
    if (!tbr) return;
    const p = window.BFProject.current;
    const pill = document.createElement('div');
    pill.id = 'bfp-pill';
    pill.style.cssText = 'display:flex;align-items:center;gap:5px;background:#0c1a2e;border:1px solid #1e3a5f;border-radius:20px;padding:3px 10px 3px 8px;cursor:pointer;font-size:11px;font-weight:700;color:#38bdf8;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis';
    pill.title = 'Changer de projet';

    if (p) {
      const name = p.displayName || p.projectName || p.code;
      pill.innerHTML = `<span style="font-size:9px;color:#475569">📁</span><span style="overflow:hidden;text-overflow:ellipsis">${_esc(name)}</span>`;
    } else {
      pill.style.color = '#f59e0b';
      pill.style.borderColor = '#713f12';
      pill.style.background = '#1c0f00';
      pill.innerHTML = `<span>⚠ Tous les projets</span>`;
    }
    pill.onclick = () => { window.location.href = '/projets.html'; };
    tbr.insertBefore(pill, tbr.firstChild);
  }

  function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
