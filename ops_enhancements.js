(function () {
  const HUB_KEY = 'ck_ops_hub_state_v2';
  const HUB_AUTH_KEY = 'ck_ops_auth_guard_v1';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const MAX_LOGIN_ATTEMPTS = 5;
  const LOCKOUT_MS = 5 * 60 * 1000;
  const OPS_STARTUP_ITEMS = [
    { id: 'ops-startup-1', title: 'Review today\'s Viv schedule and coverage gaps', detail: 'Confirm all shifts are covered and identify any backup assignments needed.' },
    { id: 'ops-startup-2', title: 'Check critical incidents and change-in-condition items', detail: 'Verify urgent items from the last 24 hours are closed or actively assigned.' },
    { id: 'ops-startup-3', title: 'Confirm overdue documentation, payroll, or EVV exceptions', detail: 'Clear missing visit notes, unmatched hours, and payroll exceptions before noon.' },
    { id: 'ops-startup-4', title: 'Review RN supervision, training, and compliance follow-ups', detail: 'Note any due supervisory visits, expiring CPR/TB items, or overdue CareAcademy modules.' },
    { id: 'ops-startup-5', title: 'Run daily referral and admissions follow-up', detail: 'Return open inquiries, confirm assessments, and assign next action on new leads.' },
    { id: 'ops-startup-6', title: 'Update shift handoff note for the next office lead', detail: 'Summarize open staffing, client, clinical, billing, and compliance issues.' }
  ];
  const PHASE_OPTIONS = ['Pre-Launch Phase', 'Build Phase', 'Launch Phase', 'Scale Phase'];
  const PAGE_KEYWORDS = {
    'dashboard': 'launch kpi referral retention caregiver coverage billable hours targets',
    'ops-center': 'daily huddle handoff issues kpi export import backup compliance',
    'roles': 'job description authority owner general manager rn caregiver coordinator',
    'launch-tracker': 'franchise launch checklist licensing opening office setup recruiting marketing',
    'ckfi-standards': 'comfort keepers standards franchise compliance minimum standards manual',
    'operations-workflow': 'daily weekly monthly workflow cadence operations rhythm',
    'onboarding': 'orientation new hire hiring paperwork caregiver office staff',
    'training': 'careacademy competency annual training modules',
    'benefits': '401k health benefits vitable sick leave maryland',
    'policies': 'policy manual procedures comar hipaa qapi incident service plan',
    'scope-services': 'scope what caregivers can do cannot do non medical tasks',
    'incident-reporting': 'incident reporting aps abuse neglect mandatory reporting 911 ohcq',
    'digital-tools': 'viv viventium careacademy human interest ck central microsoft 365',
    'contacts': 'contacts office aps ohcq emergency poison control',
    'client-marketing': 'services pricing client consultation marketing brochure private pay ltci'
  };
  const CONTACT_SEARCH_ITEMS = [
    { title: 'Emergency Services', subtitle: '911', keywords: '911 emergency fire police medical', pageId: 'contacts' },
    { title: 'Adult Protective Services (APS)', subtitle: '1-800-917-7383', keywords: 'aps abuse neglect exploitation report vulnerable adult', pageId: 'contacts' },
    { title: 'Maryland OHCQ', subtitle: '410-402-8040', keywords: 'ohcq licensing inspection rsa maryland', pageId: 'contacts' },
    { title: 'Comfort Keepers Annapolis Office', subtitle: '(443) 214-3355', keywords: 'office main phone comfort keepers annapolis', pageId: 'contacts' },
    { title: 'Poison Control', subtitle: '1-800-222-1222', keywords: 'poison control overdose medication', pageId: 'contacts' }
  ];

  let hubState = loadHubState();
  let activityTimer = null;
  let searchIndex = [];
  const sessionActivityHandler = () => {
    if (sessionStorage.getItem('ck_auth') !== '1') return;
    window.clearTimeout(activityTimer);
    activityTimer = window.setTimeout(() => {
      window.logout('Session locked after inactivity.');
    }, SESSION_TIMEOUT_MS);
  };

  function getDefaultState() {
    return {
      meta: {
        version: 2,
        phase: 'Pre-Launch Phase',
        lastSaved: null
      },
      checklists: {},
      opsCenter: {
        handoffLead: '',
        handoffNote: '',
        handoffUpdatedAt: '',
        issues: [],
        kpiSnapshots: []
      }
    };
  }

  function ensureStateShape(state) {
    const defaults = getDefaultState();
    const safe = state && typeof state === 'object' ? state : {};
    return {
      meta: {
        ...defaults.meta,
        ...(safe.meta || {})
      },
      checklists: {
        ...defaults.checklists,
        ...(safe.checklists || {})
      },
      opsCenter: {
        ...defaults.opsCenter,
        ...(safe.opsCenter || {}),
        issues: Array.isArray(safe.opsCenter && safe.opsCenter.issues) ? safe.opsCenter.issues : [],
        kpiSnapshots: Array.isArray(safe.opsCenter && safe.opsCenter.kpiSnapshots) ? safe.opsCenter.kpiSnapshots : []
      }
    };
  }

  function loadHubState() {
    try {
      const raw = localStorage.getItem(HUB_KEY);
      return ensureStateShape(raw ? JSON.parse(raw) : {});
    } catch (error) {
      return ensureStateShape({});
    }
  }

  function saveHubState() {
    hubState.meta.lastSaved = new Date().toISOString();
    localStorage.setItem(HUB_KEY, JSON.stringify(hubState));
  }

  function updateHubState(mutator) {
    mutator(hubState);
    hubState = ensureStateShape(hubState);
    saveHubState();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function formatDate(value, withTime) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {})
    });
  }

  function formatMonthValue(value) {
    if (!value) return '—';
    const [year, month] = value.split('-');
    if (!year || !month) return value;
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleDateString([], { year: 'numeric', month: 'short' });
  }

  function getSeverityOrder(severity) {
    return { Critical: 0, High: 1, Medium: 2, Low: 3 }[severity] ?? 4;
  }

  function getOpenIssues() {
    return hubState.opsCenter.issues.filter((issue) => !issue.resolved);
  }

  function getHighPriorityIssues() {
    return getOpenIssues().filter((issue) => ['Critical', 'High'].includes(issue.severity));
  }

  function getLatestKpi() {
    const snapshots = [...hubState.opsCenter.kpiSnapshots].sort((a, b) => (a.month < b.month ? 1 : -1));
    return snapshots[0] || null;
  }

  function calculateKpiHealth(snapshot) {
    if (!snapshot) {
      return { onTarget: 0, total: 4, conversion: 0 };
    }
    const conversion = snapshot.inquiries > 0 ? (snapshot.admissions / snapshot.inquiries) * 100 : 0;
    let onTarget = 0;
    if (snapshot.inquiries >= 15 && snapshot.inquiries <= 20) onTarget += 1;
    if (conversion >= 20) onTarget += 1;
    if (snapshot.callOffRate <= 5) onTarget += 1;
    if (snapshot.clientSatisfaction >= 90) onTarget += 1;
    return { onTarget, total: 4, conversion };
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showToast(message, variant) {
    const containerId = 'hubToastContainer';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.className = 'hub-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `hub-toast ${variant || 'info'}`;
    toast.textContent = message;
    container.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('hide');
      window.setTimeout(() => toast.remove(), 250);
    }, 2600);
  }

  function injectOperationalStyles() {
    if (document.getElementById('opsEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'opsEnhancementStyles';
    style.textContent = `
      .topbar .btn[data-tool] { min-width: 84px; justify-content: center; }
      .ops-summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; margin-bottom:20px; }
      .ops-summary-card { padding:18px 20px; }
      .ops-summary-kicker { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--ck-gray); font-weight:700; }
      .ops-summary-value { font-family:'DM Mono', monospace; font-size:28px; color:var(--ck-navy); margin:6px 0 4px; }
      .ops-summary-sub { font-size:12px; color:var(--ck-gray); }
      .ops-grid { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:20px; }
      .ops-grid--single { display:grid; gap:20px; }
      .ops-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .ops-form-grid.ops-form-grid-3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .ops-field { display:flex; flex-direction:column; gap:6px; }
      .ops-label { font-size:11px; font-weight:700; color:var(--ck-navy); text-transform:uppercase; letter-spacing:.8px; }
      .ops-input, .ops-select, .ops-textarea { width:100%; border:1.5px solid #d9e1e8; border-radius:10px; padding:10px 12px; font:inherit; color:var(--text); background:#fff; }
      .ops-textarea { min-height:110px; resize:vertical; }
      .ops-input:focus, .ops-select:focus, .ops-textarea:focus { outline:none; border-color:var(--ck-green); box-shadow:0 0 0 3px rgba(0,166,81,.12); }
      .ops-action-row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
      .ops-muted { font-size:11px; color:var(--ck-gray); line-height:1.6; }
      .ops-divider { height:1px; background:var(--ck-gray-light); margin:16px 0; }
      .ops-issue-list { display:grid; gap:12px; }
      .ops-issue-card { border:1px solid #e5ecf2; border-radius:12px; padding:14px; background:#fff; }
      .ops-issue-card.resolved { opacity:.65; background:#fafbfd; }
      .ops-issue-header { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px; }
      .ops-issue-title { font-size:14px; font-weight:700; color:var(--ck-navy); }
      .ops-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:999px; font-size:10px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; }
      .ops-chip.low { background:var(--ck-gray-light); color:var(--ck-gray-dark); }
      .ops-chip.medium { background:var(--ck-gold-light); color:#8a6420; }
      .ops-chip.high { background:#ffe9cc; color:#915d00; }
      .ops-chip.critical { background:var(--ck-red-light); color:var(--ck-red); }
      .ops-chip.open { background:var(--ck-green-light); color:var(--ck-green-dark); }
      .ops-chip.resolved { background:var(--ck-navy-light); color:var(--ck-navy); }
      .ops-issue-meta { font-size:11px; color:var(--ck-gray); }
      .ops-issue-note { font-size:12px; color:var(--ck-gray-dark); line-height:1.6; margin:8px 0 0; }
      .ops-table-wrap { overflow:auto; }
      .ops-table { width:100%; border-collapse:collapse; font-size:12px; }
      .ops-table th, .ops-table td { padding:10px 12px; border-bottom:1px solid var(--ck-gray-light); text-align:left; }
      .ops-table th { background:var(--ck-gray-light); color:var(--ck-navy); font-size:10px; text-transform:uppercase; letter-spacing:.7px; }
      .ops-empty { border:1px dashed #d7dfe6; border-radius:12px; padding:18px; font-size:12px; color:var(--ck-gray); background:#fafbfd; text-align:center; }
      .ops-note-card { background:linear-gradient(135deg,var(--ck-navy-light),#ffffff); border-left:4px solid var(--ck-navy); }
      .ops-tools-grid { display:grid; gap:10px; }
      .ops-quick-contacts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .ops-contact-btn { width:100%; text-align:left; border:1px solid #d9e1e8; border-radius:10px; background:#fff; padding:12px; font:inherit; color:var(--text); }
      .ops-contact-btn:hover { border-color:var(--ck-green); box-shadow:var(--shadow); }
      .ops-contact-title { font-size:12px; font-weight:700; color:var(--ck-navy); }
      .ops-contact-sub { font-size:11px; color:var(--ck-gray); margin-top:2px; }
      .hub-search-overlay { position:fixed; inset:0; background:rgba(0,20,40,.52); backdrop-filter:blur(4px); z-index:400; display:none; align-items:flex-start; justify-content:center; padding:8vh 20px 20px; }
      .hub-search-overlay.show { display:flex; }
      .hub-search-box { width:min(760px,100%); background:#fff; border-radius:18px; box-shadow:0 18px 60px rgba(0,0,0,.24); overflow:hidden; }
      .hub-search-head { padding:16px 18px 12px; border-bottom:1px solid #edf1f5; }
      .hub-search-input { width:100%; border:none; font:inherit; font-size:18px; color:var(--text); outline:none; }
      .hub-search-help { margin-top:8px; font-size:11px; color:var(--ck-gray); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .hub-kbd { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; padding:0 6px; border-radius:6px; background:var(--ck-gray-light); border:1px solid #dde5eb; color:var(--ck-gray-dark); font-size:10px; font-weight:700; }
      .hub-search-results { max-height:55vh; overflow:auto; padding:8px; display:grid; gap:6px; }
      .hub-search-result { width:100%; border:1px solid transparent; background:#fff; text-align:left; border-radius:12px; padding:12px; cursor:pointer; }
      .hub-search-result:hover, .hub-search-result:focus { outline:none; border-color:#d5e1e8; background:#f8fbfd; }
      .hub-search-result-title { font-size:13px; font-weight:700; color:var(--ck-navy); }
      .hub-search-result-sub { font-size:11px; color:var(--ck-gray); margin-top:3px; }
      .hub-search-type { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--ck-green); font-weight:700; }
      .hub-search-empty { padding:22px; color:var(--ck-gray); font-size:12px; text-align:center; }
      .hub-toast-container { position:fixed; right:18px; bottom:18px; z-index:450; display:grid; gap:10px; }
      .hub-toast { min-width:220px; max-width:360px; padding:12px 14px; border-radius:12px; color:#fff; box-shadow:0 14px 36px rgba(0,0,0,.18); background:var(--ck-navy); font-size:12px; transition:opacity .25s ease, transform .25s ease; }
      .hub-toast.success { background:var(--ck-green-dark); }
      .hub-toast.warn { background:#8a6420; }
      .hub-toast.error { background:var(--ck-red); }
      .hub-toast.hide { opacity:0; transform:translateY(8px); }
      .topbar-badge.phase-alert { background:var(--ck-red-light); color:var(--ck-red); }
      .topbar-badge.phase-ready { background:var(--ck-green-light); color:var(--ck-green-dark); }
      .ops-inline-note { margin-top:12px; padding:12px 14px; border-radius:10px; background:var(--ck-gray-light); font-size:11px; color:var(--ck-gray-dark); line-height:1.6; }
      .ops-card-list { display:grid; gap:14px; }
      .ops-mini-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .ops-highlight { padding:14px; border-radius:12px; background:#fafdfb; border:1px solid #e7f3eb; }
      .ops-highlight strong { color:var(--ck-navy); }
      .checklist-item[data-check-id] { outline:none; }
      .checklist-item[data-check-id]:focus-visible { box-shadow:0 0 0 3px rgba(0,166,81,.14); }
      @media (max-width: 1100px) { .ops-grid { grid-template-columns:1fr; } }
      @media (max-width: 720px) {
        .ops-form-grid, .ops-form-grid.ops-form-grid-3, .ops-mini-grid, .ops-quick-contacts { grid-template-columns:1fr; }
        .hub-search-overlay { padding-top:4vh; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectTopbarTools() {
    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return;
    if (!document.getElementById('topbarSearchBtn')) {
      const searchBtn = document.createElement('button');
      searchBtn.id = 'topbarSearchBtn';
      searchBtn.className = 'btn btn-outline';
      searchBtn.dataset.tool = 'search';
      searchBtn.textContent = '🔎 Search';
      searchBtn.addEventListener('click', openHubSearch);
      topbarRight.insertBefore(searchBtn, topbarRight.querySelector('.btn'));
    }
    if (!document.getElementById('topbarBackupBtn')) {
      const backupBtn = document.createElement('button');
      backupBtn.id = 'topbarBackupBtn';
      backupBtn.className = 'btn btn-outline';
      backupBtn.dataset.tool = 'backup';
      backupBtn.textContent = '💾 Backup';
      backupBtn.addEventListener('click', exportHubData);
      const printBtn = Array.from(topbarRight.querySelectorAll('.btn')).find((btn) => btn.textContent.includes('Print'));
      topbarRight.insertBefore(backupBtn, printBtn || topbarRight.lastElementChild);
    }
  }

  function injectSearchModal() {
    if (document.getElementById('hubSearchOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'hubSearchOverlay';
    overlay.className = 'hub-search-overlay';
    overlay.innerHTML = `
      <div class="hub-search-box" role="dialog" aria-modal="true" aria-label="Search the operations hub">
        <div class="hub-search-head">
          <input id="hubSearchInput" class="hub-search-input" type="search" placeholder="Search pages, policies, contacts, and workflows" autocomplete="off" />
          <div class="hub-search-help">
            <span><span class="hub-kbd">/</span> or <span class="hub-kbd">Ctrl</span> + <span class="hub-kbd">K</span> to open</span>
            <span><span class="hub-kbd">Esc</span> to close</span>
          </div>
        </div>
        <div id="hubSearchResults" class="hub-search-results"></div>
      </div>
    `;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeHubSearch();
    });
    document.body.appendChild(overlay);

    const input = document.getElementById('hubSearchInput');
    input.addEventListener('input', renderSearchResults);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHubSearch();
      }
    });

    document.addEventListener('keydown', (event) => {
      const activeTag = document.activeElement && document.activeElement.tagName;
      const isTypingContext = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) || document.activeElement?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openHubSearch();
        return;
      }
      if (event.key === '/' && !isTypingContext) {
        event.preventDefault();
        openHubSearch();
        return;
      }
      if (event.key === 'Escape' && overlay.classList.contains('show')) {
        closeHubSearch();
      }
    });
  }

  function buildSearchIndex() {
    const items = [];
    const activeRole = typeof currentRole !== 'undefined' ? currentRole : 'all';
    Object.entries(pageNames).forEach(([pageId, title]) => {
      const section = document.getElementById(`page-${pageId}`);
      const sidebarLink = document.querySelector(`.sidebar-link[data-page="${pageId}"]`);
      const visibleRoles = sidebarLink?.dataset?.roleVisible ? sidebarLink.dataset.roleVisible.split(',') : null;
      if (activeRole !== 'all' && visibleRoles && !visibleRoles.includes(activeRole)) {
        return;
      }
      const desc = section?.querySelector('.section-desc')?.textContent?.trim() || '';
      const keywords = PAGE_KEYWORDS[pageId] || '';
      items.push({
        type: 'Page',
        title,
        subtitle: desc,
        searchBlob: `${title} ${desc} ${keywords}`.toLowerCase(),
        action: () => navigateTo(pageId)
      });
    });

    const policySidebarLink = document.querySelector('.sidebar-link[data-page="policies"]');
    const policyVisibleRoles = policySidebarLink?.dataset?.roleVisible ? policySidebarLink.dataset.roleVisible.split(',') : null;
    if (Array.isArray(window.policyData) && (activeRole === 'all' || !policyVisibleRoles || policyVisibleRoles.includes(activeRole))) {
      window.policyData.forEach((policy, idx) => {
        items.push({
          type: 'Policy',
          title: `${policy.code} — ${policy.title}`,
          subtitle: policy.desc,
          searchBlob: `${policy.code} ${policy.title} ${policy.desc}`.toLowerCase(),
          action: () => {
            navigateTo('policies');
            window.setTimeout(() => openPolicyModal(idx), 120);
          }
        });
      });
    }

    CONTACT_SEARCH_ITEMS.forEach((contact) => {
      items.push({
        type: 'Contact',
        title: contact.title,
        subtitle: contact.subtitle,
        searchBlob: `${contact.title} ${contact.subtitle} ${contact.keywords}`.toLowerCase(),
        action: () => navigateTo(contact.pageId)
      });
    });

    searchIndex = items;
  }

  function renderSearchResults() {
    const resultsEl = document.getElementById('hubSearchResults');
    const input = document.getElementById('hubSearchInput');
    if (!resultsEl || !input) return;
    const query = input.value.trim().toLowerCase();
    let results = searchIndex;
    if (query) {
      const tokens = query.split(/\s+/).filter(Boolean);
      results = searchIndex.filter((item) => tokens.every((token) => item.searchBlob.includes(token)));
    }
    results = results.slice(0, 12);
    if (!results.length) {
      resultsEl.innerHTML = '<div class="hub-search-empty">No matches yet. Try a policy code, platform name, or contact keyword.</div>';
      return;
    }
    resultsEl.innerHTML = results.map((result, idx) => `
      <button type="button" class="hub-search-result" data-search-result="${idx}">
        <div class="hub-search-type">${escapeHtml(result.type)}</div>
        <div class="hub-search-result-title">${escapeHtml(result.title)}</div>
        <div class="hub-search-result-sub">${escapeHtml(result.subtitle || '')}</div>
      </button>
    `).join('');
    resultsEl.querySelectorAll('[data-search-result]').forEach((button, idx) => {
      button.addEventListener('click', () => {
        results[idx].action();
        closeHubSearch();
      });
    });
  }

  function openHubSearch() {
    if (sessionStorage.getItem('ck_auth') !== '1') return;
    buildSearchIndex();
    const overlay = document.getElementById('hubSearchOverlay');
    const input = document.getElementById('hubSearchInput');
    if (!overlay || !input) return;
    overlay.classList.add('show');
    input.value = '';
    renderSearchResults();
    window.setTimeout(() => input.focus(), 20);
  }

  function closeHubSearch() {
    const overlay = document.getElementById('hubSearchOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  function injectOpsCenter() {
    if (document.getElementById('page-ops-center')) return;
    pageNames['ops-center'] = 'Ops Center';

    const sidebarAnchor = document.querySelector('.sidebar-link[data-page="operations-workflow"]');
    if (sidebarAnchor) {
      const button = document.createElement('button');
      button.className = 'sidebar-link';
      button.dataset.page = 'ops-center';
      button.dataset.roleVisible = 'owner,gm,cc,rn';
      button.innerHTML = '<span class="icon">🧭</span> Ops Center <span class="badge" id="opsIssueBadge">0</span>';
      button.setAttribute('onclick', "navigateTo('ops-center')");
      sidebarAnchor.insertAdjacentElement('afterend', button);
    }

    const section = document.createElement('div');
    section.className = 'page-section';
    section.id = 'page-ops-center';
    section.setAttribute('data-roles', 'owner,gm,cc,rn');
    section.innerHTML = `
      <div class="section-header">
        <div>
          <h1 class="section-title">Operational Control Center</h1>
          <p class="section-desc">Daily huddle, issue tracking, KPI snapshots, browser-based persistence, and backup tools for running the office.</p>
        </div>
        <span class="tag tag-navy">Local Ops Layer</span>
      </div>

      <div class="ops-summary-grid">
        <div class="card ops-summary-card">
          <div class="ops-summary-kicker">Launch Progress</div>
          <div class="ops-summary-value" id="opsLaunchProgress">0%</div>
          <div class="ops-summary-sub" id="opsLaunchProgressSub">0 of 0 launch tasks complete</div>
        </div>
        <div class="card ops-summary-card">
          <div class="ops-summary-kicker">Open Issues</div>
          <div class="ops-summary-value" id="opsOpenIssuesCount">0</div>
          <div class="ops-summary-sub" id="opsOpenIssuesSub">No unresolved operating issues logged</div>
        </div>
        <div class="card ops-summary-card">
          <div class="ops-summary-kicker">Priority Issues</div>
          <div class="ops-summary-value" id="opsHighIssuesCount">0</div>
          <div class="ops-summary-sub">Critical and high-severity items</div>
        </div>
        <div class="card ops-summary-card">
          <div class="ops-summary-kicker">KPI Health</div>
          <div class="ops-summary-value" id="opsKpiHealth">0 / 4</div>
          <div class="ops-summary-sub" id="opsKpiHealthSub">Save a monthly KPI snapshot to score against target</div>
        </div>
      </div>

      <div class="ops-grid">
        <div class="ops-grid--single">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">🗓️ Daily Huddle & Shift Handoff</div>
                <div class="card-subtitle">Save office start-up checks and a running handoff note in this browser.</div>
              </div>
              <span class="tag tag-green" id="opsLastSavedTag">Saved locally</span>
            </div>
            <div class="ops-form-grid">
              <label class="ops-field">
                <span class="ops-label">Operating Phase</span>
                <select id="opsPhaseSelect" class="ops-select"></select>
              </label>
              <label class="ops-field">
                <span class="ops-label">Shift Lead / Office Owner</span>
                <input id="opsHandoffLead" class="ops-input" type="text" placeholder="Example: Jordan / GM / CC" />
              </label>
            </div>
            <div class="ops-divider"></div>
            <div id="opsStartupChecklist" class="ops-card-list"></div>
            <div class="ops-divider"></div>
            <label class="ops-field">
              <span class="ops-label">Handoff Note</span>
              <textarea id="opsHandoffNote" class="ops-textarea" placeholder="Document staffing gaps, client escalations, referral follow-ups, payroll exceptions, RN/compliance items, and what the next office lead should handle first."></textarea>
            </label>
            <div class="ops-inline-note">This note and all Ops Center data are stored in the current browser using local storage. Export a backup if more than one office laptop or browser profile will be used.</div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">🚧 Operating Issue Log</div>
                <div class="card-subtitle">Track unresolved staffing, client care, compliance, marketing, billing, and technology issues.</div>
              </div>
            </div>
            <form id="opsIssueForm">
              <div class="ops-form-grid ops-form-grid-3">
                <label class="ops-field" style="grid-column:span 3;">
                  <span class="ops-label">Issue Title</span>
                  <input id="opsIssueTitle" class="ops-input" type="text" placeholder="Example: Weekend call-off coverage gap for Client A" required />
                </label>
                <label class="ops-field">
                  <span class="ops-label">Area</span>
                  <select id="opsIssueArea" class="ops-select">
                    <option>Staffing</option>
                    <option>Scheduling</option>
                    <option>Client Care</option>
                    <option>Clinical</option>
                    <option>Compliance</option>
                    <option>Marketing</option>
                    <option>Finance</option>
                    <option>Technology</option>
                  </select>
                </label>
                <label class="ops-field">
                  <span class="ops-label">Severity</span>
                  <select id="opsIssueSeverity" class="ops-select">
                    <option>Low</option>
                    <option selected>Medium</option>
                    <option>High</option>
                    <option>Critical</option>
                  </select>
                </label>
                <label class="ops-field">
                  <span class="ops-label">Owner Role</span>
                  <select id="opsIssueOwner" class="ops-select">
                    <option>Owner</option>
                    <option>GM</option>
                    <option>Care Coordinator</option>
                    <option>RN</option>
                    <option>Caregiver</option>
                  </select>
                </label>
                <label class="ops-field" style="grid-column:span 3;">
                  <span class="ops-label">Next Step / Containment Plan</span>
                  <textarea id="opsIssueNextStep" class="ops-textarea" placeholder="Who is doing what next, by when, and what has already been communicated?"></textarea>
                </label>
                <label class="ops-field">
                  <span class="ops-label">Due Date</span>
                  <input id="opsIssueDueDate" class="ops-input" type="date" />
                </label>
                <div class="ops-field" style="justify-content:flex-end;">
                  <span class="ops-label">&nbsp;</span>
                  <button class="btn btn-primary" type="submit">➕ Add Issue</button>
                </div>
              </div>
            </form>
            <div class="ops-divider"></div>
            <div id="opsIssueList" class="ops-issue-list"></div>
          </div>
        </div>

        <div class="ops-grid--single">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">📈 Monthly KPI Snapshot</div>
                <div class="card-subtitle">Capture enough metrics to support weekly leadership review and monthly operational cadence.</div>
              </div>
            </div>
            <form id="opsKpiForm">
              <div class="ops-form-grid ops-form-grid-3">
                <label class="ops-field">
                  <span class="ops-label">Month</span>
                  <input id="opsKpiMonth" class="ops-input" type="month" required />
                </label>
                <label class="ops-field">
                  <span class="ops-label">Inquiries</span>
                  <input id="opsKpiInquiries" class="ops-input" type="number" min="0" step="1" required />
                </label>
                <label class="ops-field">
                  <span class="ops-label">Admissions</span>
                  <input id="opsKpiAdmissions" class="ops-input" type="number" min="0" step="1" required />
                </label>
                <label class="ops-field">
                  <span class="ops-label">Billable Hours</span>
                  <input id="opsKpiHours" class="ops-input" type="number" min="0" step="1" required />
                </label>
                <label class="ops-field">
                  <span class="ops-label">Call-Off Rate (%)</span>
                  <input id="opsKpiCallOff" class="ops-input" type="number" min="0" step="0.1" required />
                </label>
                <label class="ops-field">
                  <span class="ops-label">Client Satisfaction (%)</span>
                  <input id="opsKpiSatisfaction" class="ops-input" type="number" min="0" max="100" step="0.1" required />
                </label>
                <label class="ops-field">
                  <span class="ops-label">Recorded Incidents</span>
                  <input id="opsKpiIncidents" class="ops-input" type="number" min="0" step="1" required />
                </label>
                <div class="ops-field" style="justify-content:flex-end;">
                  <span class="ops-label">&nbsp;</span>
                  <button class="btn btn-primary" type="submit">💾 Save Snapshot</button>
                </div>
              </div>
            </form>
            <div class="ops-divider"></div>
            <div id="opsKpiLatest" class="ops-card-list"></div>
            <div class="ops-divider"></div>
            <div class="ops-table-wrap">
              <table class="ops-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Inquiries</th>
                    <th>Admissions</th>
                    <th>Conversion</th>
                    <th>Hours</th>
                    <th>Call-Off</th>
                    <th>Satisfaction</th>
                    <th>Incidents</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="opsKpiTableBody"></tbody>
              </table>
            </div>
          </div>

          <div class="card ops-note-card">
            <div class="card-header">
              <div>
                <div class="card-title">🧰 Data Tools & Deployment Notes</div>
                <div class="card-subtitle">Use browser storage for operational convenience, but treat it as lightweight tooling rather than secure production infrastructure.</div>
              </div>
            </div>
            <div class="ops-tools-grid">
              <button id="opsExportBtn" type="button" class="btn btn-primary">⬇️ Export Local Data</button>
              <button id="opsImportBtn" type="button" class="btn btn-outline">⬆️ Import Local Data</button>
              <button id="opsClearChecklistBtn" type="button" class="btn btn-outline">🧹 Clear Checklist Progress</button>
              <button id="opsResetDataBtn" type="button" class="btn btn-outline" style="color:var(--ck-red);border-color:rgba(192,57,43,0.3);">♻️ Reset Ops Center Data</button>
              <input id="opsImportFile" type="file" accept="application/json" style="display:none;" />
            </div>
            <div class="ops-inline-note">
              <strong>Important:</strong> The original app uses a client-side SHA-256 password check plus session storage, which is helpful for basic gating but is not equivalent to server-side authentication. Do not store PHI in this static file until you place it behind managed identity, SSO, or another server-side access layer.
            </div>
            <div class="ops-divider"></div>
            <div class="card-title" style="font-size:14px;">📞 Quick Contacts</div>
            <div class="ops-quick-contacts" style="margin-top:12px;">
              <button type="button" class="ops-contact-btn" data-copy-value="911"><div class="ops-contact-title">Emergency Services</div><div class="ops-contact-sub">911</div></button>
              <button type="button" class="ops-contact-btn" data-copy-value="1-800-917-7383"><div class="ops-contact-title">Adult Protective Services</div><div class="ops-contact-sub">1-800-917-7383</div></button>
              <button type="button" class="ops-contact-btn" data-copy-value="410-402-8040"><div class="ops-contact-title">Maryland OHCQ</div><div class="ops-contact-sub">410-402-8040</div></button>
              <button type="button" class="ops-contact-btn" data-copy-value="443-214-3355"><div class="ops-contact-title">CK Annapolis Office</div><div class="ops-contact-sub">(443) 214-3355</div></button>
            </div>
            <div class="ops-inline-note" id="opsLastSavedNote">Last local save: Never</div>
          </div>
        </div>
      </div>
    `;

    const main = document.querySelector('main.main-content');
    const anchor = document.getElementById('page-roles');
    if (main) {
      if (anchor) {
        main.insertBefore(section, anchor);
      } else {
        main.appendChild(section);
      }
    }

    buildOpsCenterShell();
  }

  function buildOpsCenterShell() {
    const phaseSelect = document.getElementById('opsPhaseSelect');
    if (!phaseSelect) return;
    phaseSelect.innerHTML = PHASE_OPTIONS.map((phase) => `<option value="${escapeHtml(phase)}">${escapeHtml(phase)}</option>`).join('');
    phaseSelect.value = hubState.meta.phase;
    phaseSelect.addEventListener('change', () => {
      updateHubState((state) => {
        state.meta.phase = phaseSelect.value;
      });
      syncTopbarBadge();
      updateOpsCenterSummary();
      showToast('Operating phase updated.', 'success');
    });

    const handoffLead = document.getElementById('opsHandoffLead');
    const handoffNote = document.getElementById('opsHandoffNote');
    handoffLead.value = hubState.opsCenter.handoffLead || '';
    handoffNote.value = hubState.opsCenter.handoffNote || '';
    handoffLead.addEventListener('input', () => saveHandoffFields(false));
    handoffNote.addEventListener('input', () => saveHandoffFields(false));
    handoffLead.addEventListener('change', () => saveHandoffFields(true));
    handoffNote.addEventListener('change', () => saveHandoffFields(true));

    renderOpsStartupChecklist();
    renderIssueList();
    renderKpiPanel();
    bindOpsCenterActions();
    updateOpsCenterSummary();
  }

  function saveHandoffFields(notify) {
    const handoffLead = document.getElementById('opsHandoffLead');
    const handoffNote = document.getElementById('opsHandoffNote');
    updateHubState((state) => {
      state.opsCenter.handoffLead = handoffLead?.value || '';
      state.opsCenter.handoffNote = handoffNote?.value || '';
      state.opsCenter.handoffUpdatedAt = new Date().toISOString();
    });
    updateOpsCenterSummary();
    if (notify) showToast('Shift handoff note saved.', 'success');
  }

  function renderOpsStartupChecklist() {
    const wrap = document.getElementById('opsStartupChecklist');
    if (!wrap) return;
    wrap.innerHTML = OPS_STARTUP_ITEMS.map((item) => `
      <div class="checklist-item" data-check-id="${item.id}">
        <div class="checklist-box"></div>
        <div class="checklist-text">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.detail)}</small>
        </div>
      </div>
    `).join('');
    setupChecklistPersistence();
  }

  function bindOpsCenterActions() {
    const issueForm = document.getElementById('opsIssueForm');
    const kpiForm = document.getElementById('opsKpiForm');
    const exportBtn = document.getElementById('opsExportBtn');
    const importBtn = document.getElementById('opsImportBtn');
    const clearChecklistBtn = document.getElementById('opsClearChecklistBtn');
    const resetDataBtn = document.getElementById('opsResetDataBtn');
    const importFile = document.getElementById('opsImportFile');

    issueForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      addIssueFromForm();
    });

    kpiForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveKpiFromForm();
    });

    exportBtn?.addEventListener('click', exportHubData);
    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', importHubData);
    clearChecklistBtn?.addEventListener('click', clearChecklistProgress);
    resetDataBtn?.addEventListener('click', resetOpsCenterData);

    document.querySelectorAll('.ops-contact-btn[data-copy-value]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyValue || '');
          showToast(`Copied ${button.dataset.copyValue} to clipboard.`, 'success');
        } catch (error) {
          showToast('Copy failed on this browser. You can still call directly from the contacts page.', 'warn');
        }
      });
    });
  }

  function addIssueFromForm() {
    const title = document.getElementById('opsIssueTitle')?.value.trim();
    if (!title) return;
    const issue = {
      id: `issue-${Date.now()}`,
      title,
      area: document.getElementById('opsIssueArea')?.value || 'Operations',
      severity: document.getElementById('opsIssueSeverity')?.value || 'Medium',
      owner: document.getElementById('opsIssueOwner')?.value || 'Owner',
      nextStep: document.getElementById('opsIssueNextStep')?.value.trim() || '',
      dueDate: document.getElementById('opsIssueDueDate')?.value || '',
      createdAt: new Date().toISOString(),
      resolved: false,
      resolvedAt: ''
    };
    updateHubState((state) => {
      state.opsCenter.issues.unshift(issue);
    });
    document.getElementById('opsIssueForm')?.reset();
    renderIssueList();
    updateOpsCenterSummary();
    showToast('Issue logged in Ops Center.', 'success');
  }

  function toggleIssue(id) {
    updateHubState((state) => {
      const issue = state.opsCenter.issues.find((item) => item.id === id);
      if (!issue) return;
      issue.resolved = !issue.resolved;
      issue.resolvedAt = issue.resolved ? new Date().toISOString() : '';
    });
    renderIssueList();
    updateOpsCenterSummary();
  }

  function deleteIssue(id) {
    if (!window.confirm('Delete this issue from the local issue log?')) return;
    updateHubState((state) => {
      state.opsCenter.issues = state.opsCenter.issues.filter((item) => item.id !== id);
    });
    renderIssueList();
    updateOpsCenterSummary();
    showToast('Issue removed.', 'success');
  }

  function renderIssueList() {
    const list = document.getElementById('opsIssueList');
    if (!list) return;
    const issues = [...hubState.opsCenter.issues].sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      if (getSeverityOrder(a.severity) !== getSeverityOrder(b.severity)) return getSeverityOrder(a.severity) - getSeverityOrder(b.severity);
      return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
    });
    if (!issues.length) {
      list.innerHTML = '<div class="ops-empty">No operating issues logged yet. Use this space for staffing risks, open admissions, compliance tasks, client escalations, and technology blockers.</div>';
      return;
    }
    list.innerHTML = issues.map((issue) => `
      <div class="ops-issue-card ${issue.resolved ? 'resolved' : ''}">
        <div class="ops-issue-header">
          <span class="ops-chip ${slugify(issue.severity)}">${escapeHtml(issue.severity)}</span>
          <span class="ops-chip ${issue.resolved ? 'resolved' : 'open'}">${issue.resolved ? 'Resolved' : 'Open'}</span>
          <div class="ops-issue-title">${escapeHtml(issue.title)}</div>
        </div>
        <div class="ops-issue-meta">${escapeHtml(issue.area)} • Owner: ${escapeHtml(issue.owner)} • Created ${formatDate(issue.createdAt)}${issue.dueDate ? ` • Due ${formatDate(issue.dueDate)}` : ''}</div>
        <div class="ops-issue-note">${escapeHtml(issue.nextStep || 'No next step documented yet.')}</div>
        <div class="ops-action-row" style="margin-top:12px;">
          <button type="button" class="btn btn-outline" data-toggle-issue="${issue.id}">${issue.resolved ? '↩️ Reopen' : '✅ Resolve'}</button>
          <button type="button" class="btn btn-outline" style="color:var(--ck-red);border-color:rgba(192,57,43,0.3);" data-delete-issue="${issue.id}">🗑️ Delete</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-toggle-issue]').forEach((button) => {
      button.addEventListener('click', () => toggleIssue(button.dataset.toggleIssue));
    });
    list.querySelectorAll('[data-delete-issue]').forEach((button) => {
      button.addEventListener('click', () => deleteIssue(button.dataset.deleteIssue));
    });
  }

  function saveKpiFromForm() {
    const snapshot = {
      id: `kpi-${Date.now()}`,
      month: document.getElementById('opsKpiMonth')?.value,
      inquiries: Number(document.getElementById('opsKpiInquiries')?.value || 0),
      admissions: Number(document.getElementById('opsKpiAdmissions')?.value || 0),
      billableHours: Number(document.getElementById('opsKpiHours')?.value || 0),
      callOffRate: Number(document.getElementById('opsKpiCallOff')?.value || 0),
      clientSatisfaction: Number(document.getElementById('opsKpiSatisfaction')?.value || 0),
      incidents: Number(document.getElementById('opsKpiIncidents')?.value || 0),
      createdAt: new Date().toISOString()
    };
    if (!snapshot.month) return;
    updateHubState((state) => {
      state.opsCenter.kpiSnapshots = state.opsCenter.kpiSnapshots.filter((item) => item.month !== snapshot.month);
      state.opsCenter.kpiSnapshots.push(snapshot);
    });
    document.getElementById('opsKpiForm')?.reset();
    renderKpiPanel();
    updateOpsCenterSummary();
    showToast('Monthly KPI snapshot saved.', 'success');
  }

  function deleteKpiSnapshot(id) {
    if (!window.confirm('Delete this KPI snapshot from local storage?')) return;
    updateHubState((state) => {
      state.opsCenter.kpiSnapshots = state.opsCenter.kpiSnapshots.filter((item) => item.id !== id);
    });
    renderKpiPanel();
    updateOpsCenterSummary();
  }

  function renderKpiPanel() {
    const latestWrap = document.getElementById('opsKpiLatest');
    const tableBody = document.getElementById('opsKpiTableBody');
    const latest = getLatestKpi();
    const health = calculateKpiHealth(latest);

    if (latestWrap) {
      if (!latest) {
        latestWrap.innerHTML = '<div class="ops-empty">No KPI snapshot saved yet. Use monthly snapshots to compare actual performance with the targets already shown on your dashboard.</div>';
      } else {
        latestWrap.innerHTML = `
          <div class="ops-highlight">
            <strong>Latest month:</strong> ${formatMonthValue(latest.month)}<br>
            <span class="ops-muted">Conversion ${health.conversion.toFixed(1)}% • Inquiries ${latest.inquiries} • Admissions ${latest.admissions} • Hours ${latest.billableHours} • Call-off ${latest.callOffRate.toFixed(1)}% • Satisfaction ${latest.clientSatisfaction.toFixed(1)}%</span>
          </div>
        `;
      }
    }

    if (tableBody) {
      const rows = [...hubState.opsCenter.kpiSnapshots].sort((a, b) => (a.month < b.month ? 1 : -1));
      if (!rows.length) {
        tableBody.innerHTML = '<tr><td colspan="9"><div class="ops-empty">No KPI snapshots yet.</div></td></tr>';
      } else {
        tableBody.innerHTML = rows.map((row) => {
          const conversion = row.inquiries > 0 ? (row.admissions / row.inquiries) * 100 : 0;
          return `
            <tr>
              <td>${formatMonthValue(row.month)}</td>
              <td>${row.inquiries}</td>
              <td>${row.admissions}</td>
              <td>${conversion.toFixed(1)}%</td>
              <td>${row.billableHours}</td>
              <td>${row.callOffRate.toFixed(1)}%</td>
              <td>${row.clientSatisfaction.toFixed(1)}%</td>
              <td>${row.incidents}</td>
              <td><button type="button" class="btn btn-outline" data-delete-kpi="${row.id}">Delete</button></td>
            </tr>
          `;
        }).join('');
        tableBody.querySelectorAll('[data-delete-kpi]').forEach((button) => {
          button.addEventListener('click', () => deleteKpiSnapshot(button.dataset.deleteKpi));
        });
      }
    }

    const monthInput = document.getElementById('opsKpiMonth');
    if (monthInput && !monthInput.value) {
      monthInput.value = new Date().toISOString().slice(0, 7);
    }
  }

  function exportHubData() {
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      phase: hubState.meta.phase,
      state: hubState
    };
    downloadJson(`comfort-keepers-ops-hub-backup-${new Date().toISOString().slice(0, 10)}.json`, exportPayload);
    showToast('Local hub data exported.', 'success');
  }

  function importHubData(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const imported = ensureStateShape(parsed.state || parsed);
        hubState = imported;
        saveHubState();
        restoreChecklistState();
        renderIssueList();
        renderKpiPanel();
        updateOpsCenterSummary();
        syncOperationalBadges();
        syncTopbarBadge();
        const phaseSelect = document.getElementById('opsPhaseSelect');
        if (phaseSelect) phaseSelect.value = hubState.meta.phase;
        const handoffLead = document.getElementById('opsHandoffLead');
        const handoffNote = document.getElementById('opsHandoffNote');
        if (handoffLead) handoffLead.value = hubState.opsCenter.handoffLead || '';
        if (handoffNote) handoffNote.value = hubState.opsCenter.handoffNote || '';
        showToast('Local hub data imported.', 'success');
      } catch (error) {
        showToast('Could not import that file. Please choose a valid JSON backup.', 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  function clearChecklistProgress() {
    if (!window.confirm('Clear all saved checklist progress in this browser?')) return;
    updateHubState((state) => {
      state.checklists = {};
    });
    restoreChecklistState();
    syncOperationalBadges();
    updateOpsCenterSummary();
    showToast('Checklist progress cleared.', 'success');
  }

  function resetOpsCenterData() {
    if (!window.confirm('Reset Ops Center issue log, handoff note, and KPI data? Checklist progress will be kept.')) return;
    updateHubState((state) => {
      state.opsCenter = getDefaultState().opsCenter;
    });
    const handoffLead = document.getElementById('opsHandoffLead');
    const handoffNote = document.getElementById('opsHandoffNote');
    if (handoffLead) handoffLead.value = '';
    if (handoffNote) handoffNote.value = '';
    renderIssueList();
    renderKpiPanel();
    updateOpsCenterSummary();
    showToast('Ops Center data reset.', 'success');
  }

  function setupChecklistPersistence() {
    document.querySelectorAll('.page-section').forEach((section) => {
      section.querySelectorAll('.checklist-item').forEach((item, index) => {
        if (!item.dataset.checkId) {
          const base = `${section.id}-${String(index + 1).padStart(3, '0')}`;
          item.dataset.checkId = base;
        }
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', item.classList.contains('checked') ? 'true' : 'false');
        if (item.dataset.persistenceBound === '1') return;
        item.dataset.persistenceBound = '1';
        item.addEventListener('click', () => {
          const hasInlineToggle = (item.getAttribute('onclick') || '').includes("classList.toggle('checked')");
          if (hasInlineToggle) {
            window.setTimeout(() => persistChecklistItem(item), 0);
          } else {
            item.classList.toggle('checked');
            persistChecklistItem(item);
          }
        });
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            item.click();
          }
        });
      });
    });
    restoreChecklistState();
  }

  function persistChecklistItem(item) {
    const checkId = item.dataset.checkId;
    if (!checkId) return;
    updateHubState((state) => {
      state.checklists[checkId] = item.classList.contains('checked');
    });
    item.setAttribute('aria-checked', item.classList.contains('checked') ? 'true' : 'false');
    syncOperationalBadges();
    updateOpsCenterSummary();
  }

  function restoreChecklistState() {
    document.querySelectorAll('.checklist-item[data-check-id]').forEach((item) => {
      const isChecked = Boolean(hubState.checklists[item.dataset.checkId]);
      item.classList.toggle('checked', isChecked);
      item.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    });
    syncOperationalBadges();
  }

  function getChecklistSummary(pageId) {
    const page = document.getElementById(`page-${pageId}`);
    if (!page) return { total: 0, checked: 0, remaining: 0, percent: 0 };
    const items = Array.from(page.querySelectorAll('.checklist-item'));
    const checked = items.filter((item) => item.classList.contains('checked')).length;
    const total = items.length;
    return {
      total,
      checked,
      remaining: Math.max(total - checked, 0),
      percent: total ? Math.round((checked / total) * 100) : 0
    };
  }

  function syncOperationalBadges() {
    const launchSummary = getChecklistSummary('launch-tracker');
    const ckfiSummary = getChecklistSummary('ckfi-standards');
    const opsOpenIssues = getOpenIssues().length;
    const opsIssueBadge = document.getElementById('opsIssueBadge');
    if (opsIssueBadge) opsIssueBadge.textContent = String(opsOpenIssues);
    const launchBadge = document.querySelector('.sidebar-link[data-page="launch-tracker"] .badge');
    if (launchBadge) launchBadge.textContent = String(launchSummary.remaining);
    const ckfiBadge = document.querySelector('.sidebar-link[data-page="ckfi-standards"] .badge');
    if (ckfiBadge) ckfiBadge.textContent = String(ckfiSummary.remaining);

    const dashLaunchTotal = document.getElementById('dashLaunchTotal');
    if (dashLaunchTotal) {
      dashLaunchTotal.textContent = `${launchSummary.checked}/${launchSummary.total}`;
      const label = dashLaunchTotal.parentElement?.querySelector('.stat-label');
      if (label) label.textContent = 'Launch Items Complete';
    }

    const ownerStatCards = document.querySelectorAll('#page-dashboard [data-roles="owner"] .stat-card');
    if (ownerStatCards[1]) {
      const val = ownerStatCards[1].querySelector('.stat-value');
      const label = ownerStatCards[1].querySelector('.stat-label');
      if (val) val.textContent = `${ckfiSummary.checked}/${ckfiSummary.total}`;
      if (label) label.textContent = 'CKFI Standards Complete';
    }

    const phaseRows = document.querySelectorAll('#dashPhases > div');
    const launchPanels = document.querySelectorAll('#page-launch-tracker .tab-panel');
    phaseRows.forEach((row, index) => {
      const panel = launchPanels[index];
      if (!panel) return;
      const items = panel.querySelectorAll('.checklist-item');
      const checked = panel.querySelectorAll('.checklist-item.checked').length;
      const total = items.length;
      const percent = total ? Math.round((checked / total) * 100) : 0;
      const progress = row.querySelector('div[style*="width:0%"]') || row.querySelector('div[style*="height:100%"]');
      if (progress) progress.style.width = `${percent}%`;
      const valueTag = row.querySelector("span[style*='DM Mono']") || row.querySelector('span:last-child');
      if (valueTag) valueTag.textContent = `${checked}/${total}`;
    });
  }

  function updateOpsCenterSummary() {
    const launchSummary = getChecklistSummary('launch-tracker');
    const openIssues = getOpenIssues();
    const highIssues = getHighPriorityIssues();
    const latestKpi = getLatestKpi();
    const health = calculateKpiHealth(latestKpi);

    const launchValue = document.getElementById('opsLaunchProgress');
    const launchSub = document.getElementById('opsLaunchProgressSub');
    const openIssuesCount = document.getElementById('opsOpenIssuesCount');
    const openIssuesSub = document.getElementById('opsOpenIssuesSub');
    const highIssuesCount = document.getElementById('opsHighIssuesCount');
    const kpiHealth = document.getElementById('opsKpiHealth');
    const kpiHealthSub = document.getElementById('opsKpiHealthSub');
    const lastSavedTag = document.getElementById('opsLastSavedTag');
    const lastSavedNote = document.getElementById('opsLastSavedNote');

    if (launchValue) launchValue.textContent = `${launchSummary.percent}%`;
    if (launchSub) launchSub.textContent = `${launchSummary.checked} of ${launchSummary.total} launch tasks complete`;
    if (openIssuesCount) openIssuesCount.textContent = String(openIssues.length);
    if (openIssuesSub) openIssuesSub.textContent = openIssues.length ? `${highIssues.length} high-priority item(s) need attention` : 'No unresolved operating issues logged';
    if (highIssuesCount) highIssuesCount.textContent = String(highIssues.length);
    if (kpiHealth) kpiHealth.textContent = `${health.onTarget} / ${health.total}`;
    if (kpiHealthSub) {
      kpiHealthSub.textContent = latestKpi
        ? `${formatMonthValue(latestKpi.month)} conversion ${health.conversion.toFixed(1)}% against dashboard targets`
        : 'Save a monthly KPI snapshot to score against target';
    }
    if (lastSavedTag) lastSavedTag.textContent = hubState.meta.lastSaved ? `Saved ${formatDate(hubState.meta.lastSaved, true)}` : 'Saved locally';
    if (lastSavedNote) lastSavedNote.textContent = `Last local save: ${hubState.meta.lastSaved ? formatDate(hubState.meta.lastSaved, true) : 'Never'}`;
    syncTopbarBadge();
  }

  function syncTopbarBadge() {
    const badge = document.querySelector('.topbar-badge');
    if (!badge) return;
    const hasPriorityIssues = getHighPriorityIssues().length > 0;
    badge.classList.toggle('phase-alert', hasPriorityIssues);
    badge.classList.toggle('phase-ready', !hasPriorityIssues);
    badge.textContent = `${hasPriorityIssues ? '🔴' : '🟢'} ${hubState.meta.phase}`;
  }

  function getAuthMeta() {
    try {
      return JSON.parse(localStorage.getItem(HUB_AUTH_KEY) || '{}');
    } catch (error) {
      return {};
    }
  }

  function setAuthMeta(meta) {
    localStorage.setItem(HUB_AUTH_KEY, JSON.stringify(meta));
  }

  function clearAuthFailures() {
    setAuthMeta({ failed: 0, lockUntil: 0 });
  }

  function isLockedOut() {
    const meta = getAuthMeta();
    return Number(meta.lockUntil || 0) > Date.now();
  }

  function getLockoutMessage() {
    const meta = getAuthMeta();
    const ms = Math.max(Number(meta.lockUntil || 0) - Date.now(), 0);
    const minutes = Math.ceil(ms / 60000);
    return `Too many sign-in attempts. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

  function registerFailedAttempt() {
    const meta = getAuthMeta();
    const failed = Number(meta.failed || 0) + 1;
    const nextMeta = { failed, lockUntil: Number(meta.lockUntil || 0) };
    if (failed >= MAX_LOGIN_ATTEMPTS) {
      nextMeta.failed = failed;
      nextMeta.lockUntil = Date.now() + LOCKOUT_MS;
    }
    setAuthMeta(nextMeta);
    if (nextMeta.lockUntil > Date.now()) {
      setLoginError(getLockoutMessage());
    }
  }

  function setLoginError(message) {
    const errEl = document.getElementById('loginError');
    const inputEl = document.getElementById('loginPassword');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.add('show');
    }
    if (inputEl) inputEl.classList.add('error');
  }

  function startSessionMonitor() {
    if (sessionStorage.getItem('ck_auth') !== '1') return;
    if (!document.body.dataset.sessionMonitorBound) {
      ['click', 'keydown', 'touchstart', 'scroll'].forEach((evt) => {
        document.addEventListener(evt, sessionActivityHandler, { passive: true });
      });
      document.body.dataset.sessionMonitorBound = '1';
    }
    sessionActivityHandler();
  }

  function stopSessionMonitor() {
    if (activityTimer) {
      window.clearTimeout(activityTimer);
      activityTimer = null;
    }
  }

  function restoreSessionContext() {
    const role = sessionStorage.getItem('ck_role') || 'all';
    const page = sessionStorage.getItem('ck_last_page') || 'dashboard';
    if (typeof setRole === 'function') setRole(role);
    const targetPage = document.getElementById(`page-${page}`);
    const targetLink = document.querySelector(`.sidebar-link[data-page="${page}"]`);
    const pageHidden = targetPage?.classList.contains('role-hidden');
    const linkHidden = targetLink && targetLink.style.display === 'none';
    if (targetPage && !pageHidden && !linkHidden) {
      navigateTo(page);
    } else {
      navigateTo('dashboard');
    }
  }

  function wrapCoreFunctions() {
    const originalNavigateTo = window.navigateTo;
    const originalSetRole = window.setRole;
    const originalLogout = window.logout;
    const originalAttemptLogin = window.attemptLogin;

    window.navigateTo = function (pageId) {
      originalNavigateTo(pageId);
      sessionStorage.setItem('ck_last_page', pageId);
      updateOpsCenterSummary();
    };

    window.setRole = function (role) {
      originalSetRole(role);
      sessionStorage.setItem('ck_role', role);
      updateOpsCenterSummary();
    };

    window.logout = function (reason) {
      stopSessionMonitor();
      closeHubSearch();
      originalLogout();
      originalSetRole('all');
      sessionStorage.removeItem('ck_last_page');
      if (reason) setLoginError(reason);
    };

    window.attemptLogin = async function () {
      if (isLockedOut()) {
        setLoginError(getLockoutMessage());
        return;
      }
      const beforeAuth = sessionStorage.getItem('ck_auth');
      await originalAttemptLogin();
      const afterAuth = sessionStorage.getItem('ck_auth');
      if (beforeAuth !== '1' && afterAuth === '1') {
        clearAuthFailures();
        restoreSessionContext();
        startSessionMonitor();
        showToast('Signed in to the operations hub.', 'success');
      } else if (afterAuth !== '1') {
        registerFailedAttempt();
      }
    };
  }

  function initVersionStamp() {
    const footer = document.querySelector('.sidebar-footer span');
    if (footer) footer.textContent = 'Hub v2.0 - Operational Layer';
  }

  function initEnhancements() {
    injectOperationalStyles();
    injectTopbarTools();
    injectSearchModal();
    injectOpsCenter();
    wrapCoreFunctions();
    setupChecklistPersistence();
    initVersionStamp();
    syncOperationalBadges();
    updateOpsCenterSummary();
    syncTopbarBadge();
    restoreSessionContext();
    if (sessionStorage.getItem('ck_auth') === '1') {
      startSessionMonitor();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEnhancements);
  } else {
    initEnhancements();
  }
})();
