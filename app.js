/* ============================================================================
 * app.js — Legal & Internal-Memo Portal (Plaza Hotel Company Limited)
 * Vanilla JS SPA · Supabase · VI/EN · RBAC động từ role_matrix
 * ==========================================================================*/
'use strict';

/* ------------------------------ hằng số ---------------------------------- */
const DOMAINS = ['luu_tru','fnb','do_uong_co_con','atvstp','pccc','lao_dong','thue',
  'xay_dung_dat_dai','moi_truong','du_lich','cong_doan','bao_ve_dlcn'];
const DOC_TYPES = ['luat','nghi_dinh','thong_tu','quyet_dinh','nghi_quyet','chi_thi','cong_van','tcvn','khac'];
const DOC_STATUSES = ['hieu_luc','sap_hieu_luc','het_hieu_luc','het_hieu_luc_mot_phan','can_kiem_tra'];
const MEMO_STATUSES = ['draft','submitted','under_review','approved','published','superseded','revoked'];
const STATUS_COLOR = { hieu_luc:'bg-green-100 text-green-800', sap_hieu_luc:'bg-blue-100 text-blue-800',
  het_hieu_luc:'bg-red-100 text-red-700', het_hieu_luc_mot_phan:'bg-orange-100 text-orange-800',
  can_kiem_tra:'bg-amber-100 text-amber-800' };
const MEMO_COLOR = { draft:'bg-slate-100 text-slate-700', submitted:'bg-blue-100 text-blue-800',
  under_review:'bg-amber-100 text-amber-800', approved:'bg-indigo-100 text-indigo-800',
  published:'bg-green-100 text-green-800', superseded:'bg-slate-200 text-slate-600',
  revoked:'bg-red-100 text-red-700' };
const DOMAIN_COLOR = {
  luu_tru:'bg-sky-100 text-sky-800', fnb:'bg-orange-100 text-orange-800',
  do_uong_co_con:'bg-rose-100 text-rose-800', atvstp:'bg-lime-100 text-lime-800',
  pccc:'bg-red-100 text-red-700', lao_dong:'bg-indigo-100 text-indigo-800',
  thue:'bg-amber-100 text-amber-800', xay_dung_dat_dai:'bg-stone-200 text-stone-800',
  moi_truong:'bg-emerald-100 text-emerald-800', du_lich:'bg-cyan-100 text-cyan-800',
  cong_doan:'bg-violet-100 text-violet-800', bao_ve_dlcn:'bg-fuchsia-100 text-fuchsia-800'
};
const ANTHROPIC_KEY_LS = 'portal_anthropic_key';

/* ------------------------------ state ------------------------------------ */
let sb = null;                 // supabase client
const S = {
  user: null, profile: null,
  orgUnits: [], categories: [],
  perms: { legal: new Set(), memo: new Set() },
  lang: localStorage.getItem('portal_lang') || 'vi',
  profilesById: {}
};

/* ------------------------------ tiện ích --------------------------------- */
const t = k => (window.I18N[S.lang] && window.I18N[S.lang][k]) || window.I18N.vi[k] || k;
const tf = (k, vars) => Object.entries(vars || {}).reduce((s, [key, v]) => s.replaceAll(`{${key}}`, v), t(k));
const $  = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('vi-VN') : '';
const today = () => new Date().toISOString().slice(0, 10);
const orgName = id => { const o = S.orgUnits.find(x => x.id === id); return o ? (S.lang === 'vi' ? o.name_vi : o.name_en) : '?'; };
const userName = id => S.profilesById[id]?.full_name || S.profilesById[id]?.email || '—';
const hasPerm = (mod, p) => S.profile?.is_admin || S.perms[mod]?.has(p);
const deaccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function toast(msg, ok = true) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `fixed bottom-5 right-5 z-50 text-white text-sm px-4 py-2 rounded-lg shadow-lg ${ok ? 'bg-navy' : 'bg-red-700'}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2600);
}
async function audit(entity, entityId, action, note = '', oldS = null, newS = null) {
  try { await sb.from('audit_log').insert({ actor_id: S.user.id, entity, entity_id: String(entityId ?? ''), action, note, old_status: oldS, new_status: newS }); } catch (e) { console.warn(e); }
}
function applyI18nStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('#lang-toggle') && ($('#lang-toggle').textContent = t('lang_toggle'));
}
function tvplUrl(doc) {
  if (doc.source_url) return doc.source_url;
  return 'https://thuvienphapluat.vn/page/tim-van-ban.aspx?keyword=' + encodeURIComponent(doc.doc_no || doc.title_vi || '');
}
const docStatusBadge = s => `<span class="badge ${STATUS_COLOR[s] || 'bg-slate-100'}">${esc(t('doc_status_' + s))}</span>`;
const memoStatusBadge = s => `<span class="badge ${MEMO_COLOR[s] || 'bg-slate-100'}">${esc(t('memo_status_' + s))}</span>`;
const domainLabel = d => t('domain_' + d) === 'domain_' + d ? d : t('domain_' + d);
const domainBadge = d => `<span class="badge ${DOMAIN_COLOR[d] || 'bg-slate-100 text-slate-700'}">${esc(domainLabel(d))}</span>`;

/* ============================================================================
 * BẢNG DÙNG CHUNG — sort + filter mọi cột
 * col: {key,label,type:'text'|'date'|'multi'|'none',options?,render?,val?}
 * ==========================================================================*/
function makeTable({ columns, rows, onRow, empty }) {
  const state = { sortKey: null, sortDir: 1, filters: {}, q: '', colWidths: columns.map(c => c.width || 160) };
  const wrap = document.createElement('div');

  function cellVal(r, c) { return c.val ? c.val(r) : r[c.key]; }
  function filtered() {
    let out = rows.filter(r => {
      if (state.q) {
        const hay = deaccent(columns.map(c => String(cellVal(r, c) ?? '')).join(' '));
        if (!hay.includes(deaccent(state.q))) return false;
      }
      for (const c of columns) {
        const f = state.filters[c.key];
        if (!f) continue;
        const v = cellVal(r, c);
        if (c.type === 'multi') {
          if (f.length && !f.some(x => Array.isArray(v) ? v.includes(x) : String(v) === x)) return false;
        } else if (c.type === 'date') {
          if (f.from && (!v || v < f.from)) return false;
          if (f.to && (!v || v > f.to)) return false;
        } else if (c.type === 'text') {
          if (f && !deaccent(String(v ?? '')).includes(deaccent(f))) return false;
        }
      }
      return true;
    });
    if (state.sortKey) {
      const c = columns.find(x => x.key === state.sortKey);
      out = out.slice().sort((a, b) => {
        const va = cellVal(a, c), vb = cellVal(b, c);
        return (va == null ? -1 : vb == null ? 1 : String(va).localeCompare(String(vb), 'vi', { numeric: true })) * state.sortDir;
      });
    }
    return out;
  }

  function render() {
    const data = filtered();
    const alignCls = c => c.align === 'center' ? 'text-center' : '';
    let html = `<div class="flex items-center gap-2 mb-2">
      <input type="text" class="!w-64" placeholder="${esc(t('search_in_table'))}" data-tq value="${esc(state.q)}">
      <button class="btn btn-outline btn-sm" data-clear>${esc(t('clear_filters'))}</button>
      <span class="text-xs text-slate-500">${data.length} ${t('rows')}</span></div>
      <div class="table-scroll rounded-lg border border-slate-200 shadow-sm"><table class="data">
      <colgroup>${state.colWidths.map(w => `<col style="width:${w}px">`).join('')}</colgroup>
      <thead><tr class="header-row">`;
    for (const c of columns) {
      const arrow = state.sortKey === c.key ? (state.sortDir > 0 ? ' ▲' : ' ▼') : '';
      html += `<th class="sortable ${alignCls(c)}" data-sort="${c.key}">${esc(c.label)}${arrow}<span class="col-resize-handle" data-resize></span></th>`;
    }
    html += '</tr><tr class="filter-row">';
    for (const c of columns) {
      const f = state.filters[c.key];
      if (c.type === 'text') html += `<th><input type="text" data-f="${c.key}" value="${esc(f || '')}"></th>`;
      else if (c.type === 'date') html += `<th><input type="date" data-ffrom="${c.key}" value="${f?.from || ''}" title="${t('filter_from')}"><input type="date" class="mt-1" data-fto="${c.key}" value="${f?.to || ''}" title="${t('filter_to')}"></th>`;
      else if (c.type === 'multi') {
        html += `<th><select multiple size="1" data-fm="${c.key}">` +
          c.options.map(o => `<option value="${esc(o.v)}" ${f?.includes(o.v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('') + '</select></th>';
      } else html += '<th></th>';
    }
    html += '</tr></thead><tbody>';
    if (!data.length) html += `<tr><td colspan="${columns.length}" class="text-center text-slate-400 py-6">${esc(empty || t('no_data'))}</td></tr>`;
    for (const r of data) {
      html += `<tr data-id="${esc(r.id)}">` + columns.map(c =>
        `<td class="${alignCls(c)}">${c.render ? c.render(r) : esc(cellVal(r, c) ?? '')}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table></div>';
    wrap.innerHTML = html;

    wrap.querySelector('[data-tq]').addEventListener('input', e => { state.q = e.target.value; render(); refocus(e.target); });
    wrap.querySelector('[data-clear]').addEventListener('click', () => { state.filters = {}; state.q = ''; render(); });
    wrap.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', e => {
      if (e.target.closest('input,select,[data-resize]')) return;
      const k = th.dataset.sort;
      if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = 1; }
      render();
    }));
    wrap.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', e => {
      state.filters[inp.dataset.f] = e.target.value; render(); refocus(e.target);
    }));
    wrap.querySelectorAll('[data-ffrom]').forEach(inp => inp.addEventListener('change', e => {
      const k = inp.dataset.ffrom; state.filters[k] = { ...(state.filters[k] || {}), from: e.target.value }; render();
    }));
    wrap.querySelectorAll('[data-fto]').forEach(inp => inp.addEventListener('change', e => {
      const k = inp.dataset.fto; state.filters[k] = { ...(state.filters[k] || {}), to: e.target.value }; render();
    }));
    wrap.querySelectorAll('[data-fm]').forEach(sel => sel.addEventListener('change', () => {
      state.filters[sel.dataset.fm] = [...sel.selectedOptions].map(o => o.value); render();
    }));
    if (onRow) wrap.querySelectorAll('tbody tr[data-id]').forEach(tr =>
      tr.addEventListener('click', e => { if (!e.target.closest('button,a')) onRow(tr.dataset.id); }));

    // Kéo giãn độ rộng cột: kéo handle ở mép phải mỗi th, chỉ ảnh hưởng cột đó
    // (colgroup nên table-layout:fixed áp dụng ngay không cần render lại).
    wrap.querySelectorAll('th.sortable').forEach((th, i) => {
      const handle = th.querySelector('[data-resize]');
      handle.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        handle.classList.add('active');
        const startX = e.clientX, startW = state.colWidths[i];
        const colEl = wrap.querySelectorAll('col')[i];
        const onMove = ev => {
          const w = Math.max(60, startW + (ev.clientX - startX));
          state.colWidths[i] = w;
          colEl.style.width = w + 'px';
        };
        const onUp = () => {
          handle.classList.remove('active');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }
  function refocus(oldEl) {
    // giữ focus sau khi re-render
    const sel = oldEl.dataset.tq !== undefined ? '[data-tq]' : `[data-f="${oldEl.dataset.f}"]`;
    const el = wrap.querySelector(sel);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
  render();
  return wrap;
}

/* ============================================================================
 * MODAL / DRAWER helpers
 * ==========================================================================*/
function openModal(html, wide = false) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="fixed inset-0 z-40 bg-navydark/50 flex items-start justify-center overflow-y-auto py-8" data-overlay>
    <div class="bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} mx-4" data-box>${html}</div></div>`;
  root.querySelector('[data-overlay]').addEventListener('mousedown', e => { if (!e.target.closest('[data-box]')) closeModal(); });
  return root;
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };
function openDrawer(html) {
  const root = $('#drawer-root');
  root.innerHTML = `<div class="fixed inset-0 z-30" data-overlay>
    <div class="absolute inset-0 bg-navydark/30"></div>
    <div class="drawer absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto">${html}</div></div>`;
  root.querySelector('[data-overlay]').addEventListener('mousedown', e => { if (!e.target.closest('.drawer')) closeDrawer(); });
  return root;
}
const closeDrawer = () => { $('#drawer-root').innerHTML = ''; };

/* multi-select checkbox list (org units / domains) */
function checkboxList(name, options, selected) {
  return `<div class="flex flex-wrap gap-x-4 gap-y-1 border border-slate-200 rounded-md p-2 bg-slate-50 max-h-28 overflow-y-auto">` +
    options.map(o => `<label class="flex items-center gap-1 text-xs whitespace-nowrap">
      <input type="checkbox" class="!w-auto" name="${name}" value="${esc(o.v)}" ${selected?.includes(o.v) ? 'checked' : ''}>${esc(o.l)}</label>`).join('') + '</div>';
}
const readChecks = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

/* ============================================================================
 * KHỞI ĐỘNG / AUTH
 * ==========================================================================*/
async function boot() {
  applyI18nStatic();

  // Gắn sự kiện nút Đăng nhập TRƯỚC mọi bước có thể lỗi ở dưới — để nút luôn
  // phản hồi (báo lỗi rõ ràng) thay vì im lặng nếu Supabase chưa kết nối được.
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('#login-error').classList.add('hidden');
    if (!sb) { toast('Chưa kết nối được Supabase — kiểm tra SUPABASE_URL/ANON_KEY trong index.html (xem Console F12 để biết chi tiết lỗi)', false); return; }
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
      if (error) { $('#login-error').classList.remove('hidden'); return; }
      await enter(data.session);
    } catch (err) {
      console.error(err);
      toast('Lỗi đăng nhập: ' + err.message, false);
    }
  });

  const cfg = window.PORTAL_CONFIG;
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    $('#login-view').classList.remove('hidden');
    $('#config-warning').classList.remove('hidden');
    return;
  }
  try {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  } catch (err) {
    console.error(err);
    $('#login-view').classList.remove('hidden');
    $('#config-warning').classList.remove('hidden');
    $('#config-warning').textContent = 'Lỗi cấu hình SUPABASE_URL trong index.html: ' + err.message;
    return;
  }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) { await enter(session); return; }
  } catch (err) {
    console.error(err);
    toast('Không kết nối được Supabase — kiểm tra mạng / SUPABASE_URL: ' + err.message, false);
  }
  showLogin();
}
function showLogin() { $('#login-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); }

async function enter(session) {
  S.user = session.user;
  // profile: tự tạo nếu chưa có (user do admin tạo trong Dashboard)
  let { data: prof } = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  if (!prof) {
    const ins = await sb.from('profiles').insert({ id: S.user.id, email: S.user.email, full_name: S.user.email.split('@')[0] }).select().single();
    prof = ins.data;
  }
  S.profile = prof;
  await loadRefData();
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-box').innerHTML = `<b>${esc(prof.full_name || prof.email)}</b><br>${esc(orgName(prof.org_unit_id))}${prof.is_admin ? ' · Admin' : ''}`;
  $('#logout-btn').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#lang-toggle').onclick = () => { S.lang = S.lang === 'vi' ? 'en' : 'vi'; localStorage.setItem('portal_lang', S.lang); location.reload(); };
  await renderSidebar();
  window.addEventListener('hashchange', route);
  route();
}

async function loadRefData() {
  const [ou, rm, perms, cats, profs] = await Promise.all([
    sb.from('org_units').select('*').order('id'),
    sb.from('role_matrix').select('*, permissions(code)'),
    sb.from('permissions').select('*'),
    sb.from('memo_categories').select('*').order('id'),
    sb.from('profiles').select('*')
  ]);
  S.orgUnits = ou.data || [];
  S.categories = cats.data || [];
  S.allPermissions = perms.data || [];
  S.roleMatrix = rm.data || [];
  (profs.data || []).forEach(p => S.profilesById[p.id] = p);
  S.perms = { legal: new Set(), memo: new Set(), sop: new Set() };
  for (const r of S.roleMatrix) {
    if (r.allowed && r.org_unit_id === S.profile.org_unit_id) S.perms[r.module]?.add(r.permissions.code);
  }
}
/* Quyền phân hệ SOP: nếu DB chưa chạy add-sop-module (chưa có dòng 'sop' nào trong
   role_matrix) thì tạm dùng quyền memo như trước — không ai bị mất quyền giữa chừng. */
function hasSopPerm(p) {
  const sopConfigured = S.roleMatrix.some(r => r.module === 'sop');
  return sopConfigured ? hasPerm('sop', p) : hasPerm('memo', p);
}

/* ============================================================================
 * SIDEBAR + ROUTER
 * ==========================================================================*/
const ROUTES = [
  { hash: '#/dashboard', section: 'sec_overview', label: 'nav_dashboard', show: () => true, render: pageDashboard },
  { hash: '#/legal', section: 'sec_legal', label: 'nav_legal', show: () => hasPerm('legal', 'view'), render: pageLegal },
  { hash: '#/memos', section: 'sec_memo', label: 'nav_memos', show: () => hasPerm('memo', 'view'), render: pageMemos },
  { hash: '#/sops', section: 'sec_memo', label: 'nav_sops', show: () => hasSopPerm('view'), render: pageSops },
  { hash: '#/admin/users', section: 'sec_admin', label: 'nav_users', show: () => S.profile?.is_admin, render: pageUsers },
  { hash: '#/admin/orgchart', section: 'sec_admin', label: 'nav_orgchart', show: () => S.profile?.is_admin, render: pageOrgChart },
  { hash: '#/admin/roles', section: 'sec_admin', label: 'nav_roles', show: () => S.profile?.is_admin, render: pageRoles },
  { hash: '#/admin/sources', section: 'sec_admin', label: 'nav_sources', show: () => hasPerm('legal', 'review'), render: pageSources },
  { hash: '#/admin/audit', section: 'sec_admin', label: 'nav_audit', show: () => S.profile?.is_admin, render: pageAudit },
  { hash: '#/admin/backup', section: 'sec_admin', label: 'nav_backup', show: () => S.profile?.is_admin, render: pageBackup }
];
/* Đếm số Memo/SOP đang chờ NGƯỜI DÙNG HIỆN TẠI xử lý (kiểm tra hoặc phê
   duyệt) — chỉ tính với ai có quyền review/approve tương ứng, để hiện số
   nhắc trên menu Memo/SOP. */
async function fetchSidebarBadges() {
  const badges = { memo: 0, sop: 0 };
  const countByStatuses = async (table, statuses) => {
    if (!statuses.length) return 0;
    const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).in('status', statuses);
    return count || 0;
  };
  const memoStatuses = new Set();
  if (hasPerm('memo', 'review')) { memoStatuses.add('submitted'); memoStatuses.add('under_review'); }
  if (hasPerm('memo', 'approve')) { memoStatuses.add('under_review'); memoStatuses.add('approved'); }
  badges.memo = await countByStatuses('memos', [...memoStatuses]);

  const sopStatuses = new Set();
  if (hasSopPerm('review')) { sopStatuses.add('submitted'); sopStatuses.add('under_review'); }
  if (hasSopPerm('approve')) { sopStatuses.add('under_review'); sopStatuses.add('approved'); }
  badges.sop = await countByStatuses('sops', [...sopStatuses]);
  return badges;
}
async function renderSidebar() {
  const nav = $('#sidebar-nav');
  const badges = await fetchSidebarBadges().catch(() => ({ memo: 0, sop: 0 }));
  const BADGE_FOR = { '#/memos': badges.memo, '#/sops': badges.sop };
  let html = '', lastSec = '';
  for (const r of ROUTES) {
    if (!r.show()) continue;
    if (r.section !== lastSec) { html += `<div class="px-4 pt-4 pb-1 text-[10px] tracking-widest text-white/40 font-bold">${esc(t(r.section))}</div>`; lastSec = r.section; }
    const n = BADGE_FOR[r.hash] || 0;
    const badgeHtml = n > 0 ? `<span class="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-navy text-[10px] font-bold" title="${esc(t('badge_pending_action'))}">${n > 99 ? '99+' : n}</span>` : '';
    html += `<a href="${r.hash}" class="nav-item flex items-center justify-between px-4 py-2 text-white/90" data-route="${r.hash}"><span>${esc(t(r.label))}</span>${badgeHtml}</a>`;
  }
  nav.innerHTML = html;
}
function route() {
  const h = location.hash || '#/dashboard';
  const r = ROUTES.find(x => h.startsWith(x.hash)) || ROUTES[0];
  document.querySelectorAll('#sidebar-nav .nav-item').forEach(a => a.classList.toggle('active', a.dataset.route === r.hash));
  $('#page').innerHTML = `<div class="text-slate-400 text-sm">${t('loading')}</div>`;
  r.render().catch(e => { console.error(e); $('#page').innerHTML = `<div class="text-red-600">${esc(t('error_generic'))}: ${esc(e.message)}</div>`; });
}
const pageTitle = txt => `<h1 class="text-2xl font-extrabold text-navy mb-5">${esc(txt)}</h1>`;

/* ============================================================================
 * TRANG TỔNG QUAN
 * ==========================================================================*/
async function pageDashboard() {
  const [{ data: stats }, alerts, totalRes, colCheck] = await Promise.all([
    sb.rpc('dashboard_stats'),
    sb.from('legal_docs').select('*')
      .or(`and(expiry_date.gte.${today()},expiry_date.lte.${addDays(90)}),and(effective_date.gt.${today()},effective_date.lte.${addDays(90)})`)
      .order('effective_date').limit(100),
    sb.from('legal_docs').select('id', { count: 'exact', head: true }),
    sb.from('sops').select('dept_name').limit(1)
  ]);
  const st = stats || {};
  const cards = [
    { label: 'stat_total', v: totalRes.count ?? 0, c: '#2B3A5B' },
    { label: 'stat_upcoming', v: st.upcoming ?? 0, c: '#2563eb' },
    { label: 'stat_published', v: st.published ?? 0, c: '#16a34a' }
  ];
  let html = pageTitle(t('nav_dashboard'));
  if (st.src_errors > 0) html += `<div class="mb-4 bg-red-50 border border-red-300 text-red-800 rounded-lg px-4 py-2 text-sm font-semibold">⚠ ${esc(t('src_error_banner'))}</div>`;
  if (colCheck.error && /column|schema cache/i.test(colCheck.error.message || '') && S.profile.is_admin) {
    html += `<div class="mb-4 bg-red-50 border border-red-300 text-red-800 rounded-lg px-4 py-2 text-sm font-semibold">⚠ ${esc(t('db_migration_banner'))}</div>`;
  }
  html += `<div class="mb-5"><input id="gsearch" type="text" class="!py-3 !text-base shadow-sm" placeholder="${esc(t('global_search'))}">
           <div id="gsearch-results"></div></div>`;
  html += `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">` + cards.map(c =>
    `<div class="stat-card bg-white rounded-lg shadow-sm p-4" style="--accent:${c.c}">
       <div class="text-[11px] font-semibold text-slate-500 uppercase">${esc(t(c.label))}</div>
       <div class="text-3xl font-extrabold text-navy mt-1">${c.v}</div></div>`).join('') + '</div>';

  // Alert card (cuộn trong khung riêng để danh sách dài không đẩy nội dung dưới ra khỏi màn hình)
  const arows = alerts.data || [];
  /* Tag thống kê theo lĩnh vực — bấm tag để lọc danh sách bên dưới */
  const domCounts = {}; let noDom = 0;
  arows.forEach(d => { const ds = d.domains || []; if (!ds.length) noDom++; ds.forEach(x => { domCounts[x] = (domCounts[x] || 0) + 1; }); });
  const chipBtn = (key, label, count, cls) => `<button class="badge ${cls} cursor-pointer" data-dfilter="${esc(key)}">${esc(label)} · ${count}</button>`;
  let chipsHtml = chipBtn('', t('filter_all'), arows.length, 'bg-navy text-white ring-2 ring-gold');
  Object.keys(domCounts).sort((a, b) => domCounts[b] - domCounts[a])
    .forEach(k => { chipsHtml += chipBtn(k, domainLabel(k), domCounts[k], DOMAIN_COLOR[k] || 'bg-slate-100 text-slate-700'); });
  if (noDom) chipsHtml += chipBtn('__none__', t('alert_no_domain'), noDom, 'bg-slate-200 text-slate-600');
  html += `<div class="bg-white rounded-lg shadow-sm p-5 mb-6">
    <div class="font-bold text-navy mb-2">${esc(t('alert_title'))}</div>
    <div class="flex flex-wrap gap-1.5 mb-3">${chipsHtml}</div>
    <div id="alert-list" class="space-y-2 max-h-64 overflow-y-auto">`;
  if (!arows.length) html += `<div class="text-sm text-slate-400">${esc(t('alert_none'))}</div>`;
  for (const d of arows) {
    const expiring = d.expiry_date && d.expiry_date >= today() && d.expiry_date <= addDays(90);
    html += `<div class="flex items-center gap-3 text-sm border-b border-slate-100 pb-2 cursor-pointer hover:bg-slate-50 rounded px-1" data-doc="${d.id}" data-domains="${esc((d.domains || []).join(','))}">
      <span class="badge ${expiring ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-800'}">${esc(expiring ? t('badge_expiring') : t('badge_upcoming'))}</span>
      <b class="text-navy whitespace-nowrap">${esc(d.doc_no)}</b>
      <span class="flex-1 truncate">${esc(d.title_vi)}</span>
      <span class="text-xs text-slate-500 whitespace-nowrap">${esc(fmtDate(expiring ? d.expiry_date : d.effective_date))}</span></div>`;
  }
  html += '</div></div>';

  // Quick actions (log hoạt động xem tại Quản trị › Nhật ký hệ thống)
  html += `<div class="bg-white rounded-lg shadow-sm p-5">
      <div class="font-bold text-navy mb-3">${esc(t('quick_actions'))}</div>
      <div class="flex flex-wrap gap-2">
        ${hasPerm('legal', 'review') ? `<button class="btn btn-primary" id="qa-add">${esc(t('qa_quick_add'))}</button>` : ''}
        ${hasPerm('memo', 'submit') ? `<button class="btn btn-outline" id="qa-memo">${esc(t('qa_new_memo'))}</button>` : ''}
        ${hasSopPerm('submit') ? `<button class="btn btn-outline" id="qa-sop">${esc(t('qa_new_sop'))}</button>` : ''}
        ${S.profile.is_admin ? `<button class="btn btn-outline" id="qa-export">${esc(t('qa_export'))}</button>` : ''}
      </div></div>`;

  $('#page').innerHTML = html;
  document.querySelectorAll('[data-doc]').forEach(el => el.addEventListener('click', () => openDocDrawer(el.dataset.doc)));
  document.querySelectorAll('[data-dfilter]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.dfilter;
    document.querySelectorAll('[data-dfilter]').forEach(x => x.classList.toggle('ring-2', x === b));
    document.querySelectorAll('#alert-list [data-doc]').forEach(el => {
      const ds = (el.dataset.domains || '').split(',').filter(Boolean);
      el.style.display = !k || (k === '__none__' ? !ds.length : ds.includes(k)) ? '' : 'none';
    });
  }));
  $('#qa-add')?.addEventListener('click', openQuickAdd);
  $('#qa-memo')?.addEventListener('click', () => openMemoEditor(null));
  $('#qa-sop')?.addEventListener('click', () => openSopEditor(null));
  $('#qa-export')?.addEventListener('click', () => { location.hash = '#/admin/backup'; });

  // global search
  let timer = null;
  $('#gsearch').addEventListener('input', e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#gsearch-results').innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const { data, error } = await sb.rpc('search_all', { q });
      if (error) { $('#gsearch-results').innerHTML = `<div class="px-3 py-2 text-sm text-red-600 bg-white border border-slate-200 rounded-lg mt-1">${esc(error.message)}</div>`; return; }
      const KIND_BADGE = { legal: ['bg-navy text-white', 'type_badge_legal'], memo: ['bg-gold/20 text-yellow-800', 'type_badge_memo'], sop: ['bg-emerald-100 text-emerald-800', 'type_badge_sop'] };
      $('#gsearch-results').innerHTML = `<div class="bg-white rounded-lg shadow-md border border-slate-200 mt-1 divide-y divide-slate-100">` +
        (data || []).map(r => { const [cls, key] = KIND_BADGE[r.kind] || KIND_BADGE.memo; return `<div class="px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 cursor-pointer" data-kind="${r.kind}" data-rid="${r.id}">
          <span class="badge ${cls}">${esc(t(key))}</span>
          <b class="whitespace-nowrap">${esc(r.code)}</b><span class="flex-1 truncate">${esc(r.title)}</span></div>`; }).join('') +
        ((data || []).length ? '' : `<div class="px-3 py-2 text-sm text-slate-400">${t('no_data')}</div>`) + '</div>';
      $('#gsearch-results').querySelectorAll('[data-rid]').forEach(el => el.addEventListener('click', () => {
        if (el.dataset.kind === 'legal') openDocDrawer(el.dataset.rid);
        else if (el.dataset.kind === 'sop') openSopDrawer(el.dataset.rid);
        else openMemoDrawer(el.dataset.rid);
      }));
    }, 300);
  });
}
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/* ============================================================================
 * DANH MỤC VBPL
 * ==========================================================================*/
let LEGAL_CACHE = [];
async function pageLegal() {
  const { data, error } = await sb.from('legal_docs').select('*').order('effective_date', { ascending: false });
  if (error) throw error;
  LEGAL_CACHE = data || [];
  const canEdit = hasPerm('legal', 'review');
  let html = pageTitle(t('nav_legal'));
  html += `<div class="flex flex-wrap gap-2 mb-4">
    ${canEdit ? `<button class="btn btn-primary" id="btn-quickadd">${esc(t('btn_quick_add'))}</button>
    <button class="btn btn-outline" id="btn-adddoc">${esc(t('btn_add'))}</button>
    <button class="btn btn-outline" id="btn-import">${esc(t('btn_import_csv'))}</button>` : ''}
    <button class="btn btn-outline" id="btn-export">${esc(t('btn_export_csv'))}</button>
    ${hasPerm('legal', 'admin') || S.profile.is_admin ? `<button class="btn btn-danger" id="btn-legal-del">${esc(t('btn_bulk_delete'))}</button>` : ''}</div>
    <div id="legal-table"></div>`;
  $('#page').innerHTML = html;

  const tbl = makeTable({
    columns: [
      { key: 'doc_no', label: t('col_doc_no'), type: 'text', width: 130, render: r => `<b class="text-navy">${esc(r.doc_no)}</b>` },
      { key: 'title_vi', label: t('col_title'), type: 'text', width: 380, val: r => S.lang === 'en' && r.title_en ? r.title_en : r.title_vi, render: r => esc(S.lang === 'en' && r.title_en ? r.title_en : r.title_vi) },
      { key: 'doc_type', label: t('col_type'), type: 'multi', width: 110, align: 'center', options: DOC_TYPES.map(x => ({ v: x, l: t('doc_type_' + x) })), render: r => esc(t('doc_type_' + r.doc_type)) },
      { key: 'issuing_body', label: t('col_issuing'), type: 'text', width: 160 },
      { key: 'effective_date', label: t('col_effective'), type: 'date', width: 110, align: 'center', render: r => fmtDate(r.effective_date) },
      { key: 'expiry_date', label: t('col_expiry'), type: 'date', width: 110, align: 'center', render: r => fmtDate(r.expiry_date) },
      { key: 'status', label: t('col_status'), type: 'multi', width: 130, align: 'center', options: DOC_STATUSES.map(x => ({ v: x, l: t('doc_status_' + x) })), render: r => docStatusBadge(r.status) },
      { key: 'domains', label: t('col_domains'), type: 'multi', width: 220, options: DOMAINS.map(x => ({ v: x, l: domainLabel(x) })), render: r => (r.domains || []).map(domainBadge).join(' ') },
      { key: 'applies_to', label: t('col_applies'), type: 'multi', width: 160, options: S.orgUnits.map(o => ({ v: String(o.id), l: orgName(o.id) })), val: r => (r.applies_to || []).map(String), render: r => (r.applies_to || []).map(id => `<span class="chip">${esc(orgName(id))}</span>`).join('') }
    ],
    rows: LEGAL_CACHE,
    onRow: openDocDrawer
  });
  $('#legal-table').appendChild(tbl);
  $('#btn-quickadd')?.addEventListener('click', openQuickAdd);
  $('#btn-adddoc')?.addEventListener('click', () => openDocEditor(null));
  $('#btn-import')?.addEventListener('click', openCsvImport);
  $('#btn-export')?.addEventListener('click', () => downloadCsv('legal_docs.csv', LEGAL_CACHE));
  $('#btn-legal-del')?.addEventListener('click', () => openBulkDelete('legal_docs'));
}

/* ---------------------------- drawer chi tiết ----------------------------- */
async function openDocDrawer(id) {
  const doc = LEGAL_CACHE.find(d => d.id === id) || (await sb.from('legal_docs').select('*').eq('id', id).single()).data;
  if (!doc) return;
  const en = S.lang === 'en';
  const html = `<div class="p-6">
    <div class="flex items-start justify-between gap-3">
      <div><div class="text-xs text-slate-500">${esc(t('doc_type_' + doc.doc_type))} · ${esc(doc.issuing_body || '')}</div>
        <h2 class="text-xl font-extrabold text-navy mt-1">${esc(doc.doc_no)}</h2></div>
      <button class="btn btn-outline btn-sm" data-close>✕</button></div>
    <div class="mt-2 text-[15px] font-semibold">${esc(en && doc.title_en ? doc.title_en : doc.title_vi)}</div>
    ${en && doc.title_en && doc.is_machine_translated ? `<div class="mt-1 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-2 py-1">⚠ ${esc(t('mt_notice'))}</div>` : ''}
    <div class="flex flex-wrap gap-2 mt-3 text-sm items-center">
      ${docStatusBadge(doc.status)}
      <span class="text-slate-500 text-xs">${esc(t('col_issue_date'))}: <b>${fmtDate(doc.issue_date) || '—'}</b></span>
      <span class="text-slate-500 text-xs">${esc(t('col_effective'))}: <b>${fmtDate(doc.effective_date) || '—'}</b></span>
      <span class="text-slate-500 text-xs">${esc(t('col_expiry'))}: <b>${fmtDate(doc.expiry_date) || '—'}</b></span></div>
    <div class="mt-4">
      <div class="text-xs font-bold text-slate-500 uppercase mb-1">${esc(t('drawer_summary'))} (VI)</div>
      <div class="text-sm bg-slate-50 rounded-md p-3">${esc(doc.summary_vi || '—')}</div>
      ${doc.summary_en ? `<div class="text-xs font-bold text-slate-500 uppercase mb-1 mt-3">${esc(t('drawer_summary'))} (EN)</div>
        <div class="text-sm bg-slate-50 rounded-md p-3">${esc(doc.summary_en)}</div>
        ${doc.is_machine_translated ? `<div class="mt-1 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-2 py-1">⚠ ${esc(t('mt_notice'))}</div>` : ''}` : ''}
    </div>
    ${(doc.replaces || []).length ? `<div class="mt-3"><span class="text-xs font-bold text-slate-500 uppercase">${esc(t('drawer_replaces'))}:</span> ${doc.replaces.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
    ${(doc.replaced_by || []).length ? `<div class="mt-2"><span class="text-xs font-bold text-slate-500 uppercase">${esc(t('drawer_replaced_by'))}:</span> ${doc.replaced_by.map(x => `<span class="chip !bg-red-50 !text-red-700">${esc(x)}</span>`).join('')}</div>` : ''}
    <div class="mt-2"><span class="text-xs font-bold text-slate-500 uppercase">${esc(t('drawer_applies'))}:</span> ${(doc.applies_to || []).map(i => `<span class="chip">${esc(orgName(i))}</span>`).join('') || `<span class="chip">${esc(t('all_departments'))}</span>`}</div>
    <div class="mt-2">${(doc.domains || []).map(domainBadge).join(' ')}</div>
    <a href="${esc(tvplUrl(doc))}" target="_blank" rel="noopener" class="btn btn-primary w-full justify-center mt-5">${esc(t('drawer_view_full'))}</a>
    ${hasPerm('legal', 'review') ? `<button class="btn btn-outline w-full justify-center mt-2" data-edit>${esc(t('btn_edit'))}</button>` : ''}
    ${doc.last_verified_at ? `<div class="text-[11px] text-slate-400 mt-3">Last verified: ${new Date(doc.last_verified_at).toLocaleString('vi-VN')}</div>` : ''}
  </div>`;
  const root = openDrawer(html);
  root.querySelector('[data-close]').addEventListener('click', closeDrawer);
  root.querySelector('[data-edit]')?.addEventListener('click', () => { closeDrawer(); openDocEditor(doc); });
}

/* ---------------------------- editor 1 văn bản ---------------------------- */
function docFormHtml(d = {}) {
  return `
  <div class="grid grid-cols-2 gap-3">
    <div><label class="text-xs font-semibold">${esc(t('col_doc_no'))} *</label><input name="doc_no" value="${esc(d.doc_no || '')}" required></div>
    <div><label class="text-xs font-semibold">${esc(t('col_type'))}</label><select name="doc_type">${DOC_TYPES.map(x => `<option value="${x}" ${d.doc_type === x ? 'selected' : ''}>${esc(t('doc_type_' + x))}</option>`).join('')}</select></div>
    <div class="col-span-2"><label class="text-xs font-semibold">${esc(t('col_title'))} (VI) *</label><input name="title_vi" value="${esc(d.title_vi || '')}" required></div>
    <div class="col-span-2"><label class="text-xs font-semibold">${esc(t('col_title'))} (EN)</label><input name="title_en" value="${esc(d.title_en || '')}"></div>
    <div><label class="text-xs font-semibold">${esc(t('col_issuing'))}</label><input name="issuing_body" value="${esc(d.issuing_body || '')}"></div>
    <div><label class="text-xs font-semibold">${esc(t('col_status'))}</label><select name="status">${DOC_STATUSES.map(x => `<option value="${x}" ${d.status === x ? 'selected' : ''}>${esc(t('doc_status_' + x))}</option>`).join('')}</select></div>
    <div><label class="text-xs font-semibold">${esc(t('col_issue_date'))}</label><input type="date" name="issue_date" value="${d.issue_date || ''}"></div>
    <div class="grid grid-cols-2 gap-2">
      <div><label class="text-xs font-semibold">${esc(t('col_effective'))}</label><input type="date" name="effective_date" value="${d.effective_date || ''}"></div>
      <div><label class="text-xs font-semibold">${esc(t('col_expiry'))}</label><input type="date" name="expiry_date" value="${d.expiry_date || ''}"></div></div>
    <div class="col-span-2"><label class="text-xs font-semibold">${esc(t('drawer_summary'))} (VI)</label><textarea name="summary_vi" rows="2">${esc(d.summary_vi || '')}</textarea></div>
    <div class="col-span-2"><label class="text-xs font-semibold">${esc(t('drawer_summary'))} (EN)</label><textarea name="summary_en" rows="2">${esc(d.summary_en || '')}</textarea></div>
    <div><label class="text-xs font-semibold">${esc(t('drawer_replaces'))} (mỗi số 1 dòng)</label><textarea name="replaces" rows="2">${esc((d.replaces || []).join('\n'))}</textarea></div>
    <div><label class="text-xs font-semibold">${esc(t('drawer_replaced_by'))}</label><textarea name="replaced_by" rows="2">${esc((d.replaced_by || []).join('\n'))}</textarea></div>
    <div class="col-span-2"><label class="text-xs font-semibold">Link toàn văn (TVPL)</label><input name="source_url" value="${esc(d.source_url || '')}" placeholder="https://thuvienphapluat.vn/..."></div>
    <div class="col-span-2"><label class="text-xs font-semibold">${esc(t('col_domains'))}</label>${checkboxList('domains', DOMAINS.map(x => ({ v: x, l: domainLabel(x) })), d.domains || [])}</div>
    <div class="col-span-2"><label class="text-xs font-semibold">${esc(t('col_applies'))}</label>${checkboxList('applies_to', S.orgUnits.map(o => ({ v: String(o.id), l: orgName(o.id) })), (d.applies_to || []).map(String))}</div>
  </div>`;
}
function readDocForm(root) {
  const g = n => root.querySelector(`[name="${n}"]`)?.value.trim() || null;
  return {
    doc_no: g('doc_no'), title_vi: g('title_vi'), title_en: g('title_en'),
    doc_type: g('doc_type') || 'khac', issuing_body: g('issuing_body'),
    issue_date: g('issue_date'), effective_date: g('effective_date'), expiry_date: g('expiry_date'),
    status: g('status') || 'can_kiem_tra',
    summary_vi: g('summary_vi'), summary_en: g('summary_en'),
    replaces: (g('replaces') || '').split('\n').map(x => x.trim()).filter(Boolean),
    replaced_by: (g('replaced_by') || '').split('\n').map(x => x.trim()).filter(Boolean),
    source_url: g('source_url'),
    domains: readChecks(root, 'domains'),
    applies_to: readChecks(root, 'applies_to').map(Number)
  };
}
function openDocEditor(doc, onSaved) {
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-navy mb-4">${doc ? esc(doc.doc_no) : t('btn_add')}</h2>
    <form id="doc-form">${docFormHtml(doc || {})}
      <div class="flex justify-end gap-2 mt-5">
        <button type="button" class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('btn_save'))}</button></div></form></div>`, true);
  root.querySelector('[data-cancel]').addEventListener('click', closeModal);
  root.querySelector('#doc-form').addEventListener('submit', async e => {
    e.preventDefault();
    const row = readDocForm(root);
    if (doc?.id) row.id = doc.id; else row.created_by = S.user.id;
    const { error } = await sb.from('legal_docs').upsert(row, { onConflict: 'doc_no' });
    if (error) { toast(error.message, false); return; }
    await audit('legal_docs', row.doc_no, doc ? 'update' : 'create');
    toast(t('saved')); closeModal();
    if (onSaved) onSaved(); else route();
  });
}

/* ---------------------------- QUICK ADD (AI) ------------------------------ */
function getAnthropicKey(interactive = true) {
  let k = localStorage.getItem(ANTHROPIC_KEY_LS);
  if (!k && interactive) {
    if (confirm(t('quick_add_key_missing'))) {
      k = prompt('Anthropic API key (sk-ant-…):') || '';
      if (k) localStorage.setItem(ANTHROPIC_KEY_LS, k.trim());
    }
  }
  return k;
}
const QUICK_ADD_SYSTEM = `Bạn là công cụ trích xuất metadata văn bản pháp luật Việt Nam.
Người dùng dán khối "Lược đồ"/"Thuộc tính" copy từ vbpl.vn hoặc thuvienphapluat.vn (có thể chứa NHIỀU văn bản).
Trả về DUY NHẤT một JSON array (không markdown fence, không lời dẫn), mỗi phần tử:
{"doc_no": string, "title_vi": string, "doc_type": "luat"|"nghi_dinh"|"thong_tu"|"quyet_dinh"|"chi_thi"|"cong_van"|"tcvn"|"khac",
 "issuing_body": string|null, "issue_date": "YYYY-MM-DD"|null, "effective_date": "YYYY-MM-DD"|null, "expiry_date": "YYYY-MM-DD"|null,
 "status": "hieu_luc"|"sap_hieu_luc"|"het_hieu_luc"|"het_hieu_luc_mot_phan"|"can_kiem_tra",
 "domains": string[] (chọn trong: luu_tru,fnb,do_uong_co_con,atvstp,pccc,lao_dong,thue,xay_dung_dat_dai,moi_truong,du_lich,cong_doan,bao_ve_dlcn),
 "replaces": string[], "replaced_by": string[], "summary_vi": string (<=40 từ), "source_url": string|null}
Không rõ thì để null. Ngày định dạng YYYY-MM-DD.`;

async function callQuickAddAI(text) {
  const key = getAnthropicKey();
  if (!key) throw new Error('no-key');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: QUICK_ADD_SYSTEM,
      messages: [{ role: 'user', content: text }]
    })
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + await res.text());
  const data = await res.json();
  let out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  out = out.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(out);
}

function openQuickAdd() {
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-navy mb-1">${esc(t('quick_add_title'))}</h2>
    <p class="text-xs text-slate-500 mb-3">${esc(t('quick_add_hint'))}</p>
    <textarea id="qa-text" rows="10" placeholder="Số hiệu: 55/2024/QH15&#10;Loại văn bản: Luật&#10;Ngày ban hành: 29/11/2024 ..."></textarea>
    <div class="flex items-center justify-between mt-3">
      <label class="text-xs text-slate-500">${esc(t('csv_upload'))} <input type="file" id="qa-csv" accept=".csv" class="text-xs"></label>
      <button class="btn btn-primary" id="qa-parse">${esc(t('quick_add_parse'))}</button></div>
    <div id="qa-result" class="mt-4"></div></div>`, true);

  root.querySelector('#qa-parse').addEventListener('click', async () => {
    const txt = root.querySelector('#qa-text').value.trim();
    if (!txt) return;
    const btn = root.querySelector('#qa-parse');
    btn.disabled = true; btn.textContent = t('quick_add_parsing');
    try {
      const arr = await callQuickAddAI(txt);
      renderQuickReview(root, Array.isArray(arr) ? arr : [arr]);
    } catch (e) {
      console.error(e);
      if (e.message !== 'no-key') toast(t('quick_add_error'), false);
    } finally { btn.disabled = false; btn.textContent = t('quick_add_parse'); }
  });
  root.querySelector('#qa-csv').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const rows = parseCsv(await f.text());
    renderQuickReview(root, rows.map(csvRowToDoc));
  });
}

function renderQuickReview(root, docs) {
  const box = root.querySelector('#qa-result');
  const fields = ['doc_no','title_vi','doc_type','issuing_body','issue_date','effective_date','expiry_date','status','summary_vi'];
  let html = `<div class="text-sm font-semibold text-navy mb-2">${esc(t('quick_add_review'))}</div>
    <div class="overflow-x-auto border border-slate-200 rounded-lg"><table class="data"><thead><tr>` +
    fields.map(f => `<th>${esc(f)}</th>`).join('') + `<th>${esc(t('col_domains'))}</th><th>${esc(t('col_applies'))}</th></tr></thead><tbody>`;
  docs.forEach((d, i) => {
    html += `<tr data-i="${i}">` + fields.map(f => {
      if (f === 'doc_type') return `<td><select data-fld="${f}">${DOC_TYPES.map(x => `<option value="${x}" ${d[f] === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>`;
      if (f === 'status') return `<td><select data-fld="${f}">${DOC_STATUSES.map(x => `<option value="${x}" ${d[f] === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>`;
      if (f.endsWith('_date')) return `<td><input type="date" data-fld="${f}" value="${esc(d[f] || '')}"></td>`;
      return `<td><input type="text" data-fld="${f}" value="${esc(d[f] || '')}" class="min-w-[110px]"></td>`;
    }).join('');
    html += `<td class="min-w-[140px]"><select multiple size="3" data-fld="domains">${DOMAINS.map(x => `<option value="${x}" ${(d.domains || []).includes(x) ? 'selected' : ''}>${esc(domainLabel(x))}</option>`).join('')}</select></td>`;
    html += `<td class="min-w-[130px]"><select multiple size="3" data-fld="applies_to">${S.orgUnits.map(o => `<option value="${o.id}" ${(d.applies_to || []).includes(o.id) ? 'selected' : ''}>${esc(orgName(o.id))}</option>`).join('')}</select></td></tr>`;
  });
  html = `<div class="mb-3">${importModeRadios('qa-mode')}</div>` + html + `</tbody></table></div>
    <div class="flex justify-end gap-2 mt-3">
      <button class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button>
      <button class="btn btn-primary" id="qa-saveall">${esc(t('btn_save_all'))}</button></div>`;
  box.innerHTML = html;
  box.querySelector('[data-cancel]').addEventListener('click', closeModal);
  box.querySelector('#qa-saveall').addEventListener('click', async () => {
    const mode = box.querySelector('input[name="qa-mode"]:checked').value;
    const rows = [...box.querySelectorAll('tbody tr')].map((tr, i) => {
      const row = { ...docs[i] };
      tr.querySelectorAll('[data-fld]').forEach(el => {
        const f = el.dataset.fld;
        if (el.multiple) row[f] = [...el.selectedOptions].map(o => f === 'applies_to' ? Number(o.value) : o.value);
        else row[f] = el.value.trim() || null;
      });
      delete row._confidence; delete row._verify_note;
      return row;
    });
    const { inserted, skipped, error } = await saveDocsWithMode(rows, mode);
    if (error) { toast(error.message, false); return; }
    await audit('legal_docs', rows.map(r => r.doc_no).join(', '), 'quick_add', `mode=${mode} inserted=${inserted} skipped=${skipped}`);
    toast(tf('import_result', { inserted, skipped })); closeModal(); route();
  });
}

/* ---------------------------- CSV import/export --------------------------- */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(c => c !== '')) rows.push(row); }
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
function csvRowToDoc(r) {
  const codes = Object.fromEntries(S.orgUnits.map(o => [o.code, o.id]));
  return {
    doc_no: r.doc_no, title_vi: r.title_vi, title_en: r.title_en || null,
    doc_type: DOC_TYPES.includes(r.doc_type) ? r.doc_type : 'khac',
    issuing_body: r.issuing_body || null,
    issue_date: r.issue_date || null, effective_date: r.effective_date || null, expiry_date: r.expiry_date || null,
    status: DOC_STATUSES.includes(r.status) ? r.status : 'can_kiem_tra',
    domains: (r.domains || '').split(/[;|]/).map(x => x.trim()).filter(Boolean),
    summary_vi: r.summary_vi || null, source_url: r.source_url || null,
    replaces: (r.replaces || '').split(/[;|]/).map(x => x.trim()).filter(Boolean),
    replaced_by: (r.replaced_by || '').split(/[;|]/).map(x => x.trim()).filter(Boolean),
    applies_to: (r.applies_to || '').split(/[;|]/).map(x => codes[x.trim()]).filter(Boolean)
  };
}
/* Lưu 1 lô legal_docs với 2 chế độ:
   'add'       — chỉ chèn số hiệu CHƯA có, bỏ qua (không đụng) số hiệu đã tồn tại
   'overwrite' — upsert, cập nhật đè lên số hiệu đã tồn tại
   Trả về { inserted, skipped, error } */
async function saveDocsWithMode(docs, mode) {
  docs = docs.filter(d => d.doc_no && d.title_vi);
  if (!docs.length) return { inserted: 0, skipped: 0, error: null };
  docs.forEach(d => { d.created_by = S.user.id; });

  if (mode === 'overwrite') {
    const { error } = await sb.from('legal_docs').upsert(docs, { onConflict: 'doc_no' });
    return { inserted: docs.length, skipped: 0, error };
  }
  // add: loại bỏ số hiệu đã có trong DB trước khi insert
  const docNos = docs.map(d => d.doc_no);
  const { data: existing } = await sb.from('legal_docs').select('doc_no').in('doc_no', docNos);
  const existSet = new Set((existing || []).map(x => x.doc_no));
  const toInsert = docs.filter(d => !existSet.has(d.doc_no));
  const skipped = docs.length - toInsert.length;
  if (!toInsert.length) return { inserted: 0, skipped, error: null };
  const { error } = await sb.from('legal_docs').insert(toInsert);
  return { inserted: toInsert.length, skipped, error };
}

function importModeRadios(name) {
  return `<div class="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2 bg-slate-50">
    <label class="flex items-start gap-2"><input type="radio" name="${name}" value="add" checked class="!w-auto mt-1">
      <span><b>${esc(t('import_mode_add'))}</b><br><span class="text-xs text-slate-500">${esc(t('import_mode_add_hint'))}</span></span></label>
    <label class="flex items-start gap-2"><input type="radio" name="${name}" value="overwrite" class="!w-auto mt-1">
      <span><b>${esc(t('import_mode_overwrite'))}</b><br><span class="text-xs text-slate-500">${esc(t('import_mode_overwrite_hint'))}</span></span></label>
  </div>`;
}

function openCsvImport() {
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-navy mb-3">${esc(t('btn_import_csv'))}</h2>
    <p class="text-xs text-slate-500 mb-3">${esc(t('csv_upload'))}</p>
    <div class="mb-3">${importModeRadios('csv-mode')}</div>
    <input type="file" id="csv-file" accept=".csv">
    <div class="flex justify-end gap-2 mt-4"><button class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button></div></div>`);
  root.querySelector('[data-cancel]').addEventListener('click', closeModal);
  root.querySelector('#csv-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const mode = root.querySelector('input[name="csv-mode"]:checked').value;
    const docs = parseCsv(await f.text()).map(csvRowToDoc);
    const { inserted, skipped, error } = await saveDocsWithMode(docs, mode);
    if (error) { toast(error.message, false); return; }
    await audit('legal_docs', '', 'csv_import', `mode=${mode} inserted=${inserted} skipped=${skipped}`);
    toast(tf('import_result', { inserted, skipped })); closeModal(); route();
  });
}
function downloadCsv(name, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]).filter(k => k !== 'search_vector');
  const escCell = v => { const s = Array.isArray(v) ? v.join(';') : String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + keys.join(',') + '\n' + rows.map(r => keys.map(k => escCell(r[k])).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

/* ============================================================================
 * MEMO NỘI BỘ
 * ==========================================================================*/
let MEMO_CACHE = [];
async function pageMemos(tab = 'all') {
  const { data, error } = await sb.from('memos').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  MEMO_CACHE = data || [];
  const tabs = [
    { k: 'all', l: t('memo_tab_all'), f: () => true },
    { k: 'mine', l: t('memo_tab_mine'), f: m => m.author_id === S.user.id && m.status === 'draft' },
    ...(hasPerm('memo', 'review') ? [{ k: 'review', l: t('memo_tab_review'), f: m => ['submitted', 'under_review'].includes(m.status) }] : []),
    ...(hasPerm('memo', 'approve') ? [{ k: 'approve', l: t('memo_tab_approve'), f: m => ['under_review', 'approved'].includes(m.status) }] : [])
  ];
  const cur = tabs.find(x => x.k === tab) || tabs[0];
  let html = pageTitle(t('nav_memos'));
  html += `<div class="flex flex-wrap items-center gap-2 mb-4">
    ${tabs.map(x => `<button class="btn btn-sm ${x.k === cur.k ? 'btn-primary' : 'btn-outline'}" data-tab="${x.k}">${esc(x.l)}</button>`).join('')}
    <span class="flex-1"></span>
    ${hasPerm('memo', 'publish') || S.profile.is_admin ? `<button class="btn btn-outline" id="btn-memo-import">${esc(t('btn_import_csv'))}</button>
      <button class="btn btn-outline" id="btn-memo-bulk">${esc(t('btn_bulk_assign'))}</button>` : ''}
    ${S.profile.is_admin ? `<button class="btn btn-danger" id="btn-memo-del">${esc(t('btn_bulk_delete'))}</button>` : ''}
    ${hasPerm('memo', 'submit') ? `<button class="btn btn-primary" id="btn-newmemo">${esc(t('memo_new'))}</button>` : ''}</div>
    <div id="memo-table"></div>`;
  $('#page').innerHTML = html;
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => pageMemos(b.dataset.tab)));
  $('#btn-newmemo')?.addEventListener('click', () => openMemoEditor(null));
  $('#btn-memo-import')?.addEventListener('click', () => openBulkImport('memos'));
  $('#btn-memo-bulk')?.addEventListener('click', () => openBulkAssign('memos'));
  $('#btn-memo-del')?.addEventListener('click', () => openBulkDelete('memos'));

  const catName = id => { const c = S.categories.find(x => x.id === id); return c ? (S.lang === 'vi' ? c.name_vi : c.name_en) : ''; };
  const tbl = makeTable({
    columns: [
      { key: 'memo_code', label: t('col_code'), type: 'text', width: 130, render: r => `<b class="text-navy whitespace-nowrap">${esc(r.memo_code)}</b> <span class="text-xs text-slate-400">v${r.version}</span>` },
      { key: 'title_vi', label: t('col_title'), type: 'text', width: 340, val: r => S.lang === 'en' && r.title_en ? r.title_en : r.title_vi, render: r => esc(S.lang === 'en' && r.title_en ? r.title_en : r.title_vi) },
      { key: 'category_id', label: t('col_category'), type: 'multi', width: 160, options: S.categories.map(c => ({ v: String(c.id), l: catName(c.id) })), val: r => String(r.category_id || ''), render: r => esc(catName(r.category_id)) },
      { key: 'status', label: t('col_status'), type: 'multi', width: 130, align: 'center', options: MEMO_STATUSES.map(x => ({ v: x, l: t('memo_status_' + x) })), render: r => memoStatusBadge(r.status) },
      { key: 'author_id', label: t('col_author'), type: 'text', width: 150, val: r => userName(r.author_id), render: r => esc(userName(r.author_id)) },
      { key: 'effective_date', label: t('memo_effective'), type: 'date', width: 110, align: 'center', render: r => fmtDate(r.effective_date) },
      { key: 'updated_at', label: t('col_updated'), type: 'date', width: 150, align: 'center', val: r => (r.updated_at || '').slice(0, 10), render: r => new Date(r.updated_at).toLocaleString('vi-VN') }
    ],
    rows: MEMO_CACHE.filter(cur.f),
    onRow: openMemoDrawer
  });
  $('#memo-table').appendChild(tbl);
}

/* ------------------------------ memo drawer ------------------------------- */
async function openMemoDrawer(id) {
  const m = MEMO_CACHE.find(x => x.id === id) || (await sb.from('memos').select('*').eq('id', id).single()).data;
  if (!m) return;
  const [hist, logs] = await Promise.all([
    sb.from('memos').select('id, memo_code, version, status, updated_at').or(`id.eq.${m.parent_id || m.id},parent_id.eq.${m.parent_id || m.id}`).order('version'),
    sb.from('audit_log').select('*').eq('entity', 'memos').eq('entity_id', m.id).order('at', { ascending: false }).limit(20)
  ]);
  const en = S.lang === 'en';
  let attach = '';
  if (m.attachment_path) {
    const { data } = await sb.storage.from('memo-attachments').createSignedUrl(m.attachment_path, 3600);
    if (data?.signedUrl) attach = `<a class="btn btn-outline btn-sm mt-2" href="${esc(data.signedUrl)}" target="_blank">📎 ${esc(m.attachment_path.split('/').pop())}</a>`;
  }
  const relDocs = (m.related_legal_doc_ids || []).map(rid => {
    const d = LEGAL_CACHE.find(x => x.id === rid);
    return d ? `<span class="chip cursor-pointer" data-reldoc="${rid}">${esc(d.doc_no)}</span>` : '';
  }).join('');

  const html = `<div class="p-6">
    <div class="flex items-start justify-between gap-3">
      <div><div class="text-xs text-slate-500">${esc(t('nav_memos'))} · v${m.version}</div>
        <h2 class="text-xl font-extrabold text-navy mt-1">${esc(m.memo_code)}</h2></div>
      <button class="btn btn-outline btn-sm" data-close>✕</button></div>
    <div class="mt-2 text-[15px] font-semibold">${esc(en && m.title_en ? m.title_en : m.title_vi)}</div>
    <div class="flex flex-wrap gap-2 mt-2 items-center">${memoStatusBadge(m.status)}
      <span class="text-xs text-slate-500">${esc(t('col_author'))}: <b>${esc(userName(m.author_id))}</b></span>
      ${m.effective_date ? `<span class="text-xs text-slate-500">${esc(t('memo_effective'))}: <b>${fmtDate(m.effective_date)}</b></span>` : ''}</div>
    ${m.to_line || m.from_line ? `<div class="mt-2 text-xs text-slate-600 space-y-0.5">
      ${m.to_line ? `<div><b>Kính gửi/ To:</b> ${esc(m.to_line)}</div>` : ''}
      ${m.from_line ? `<div><b>Từ/ From:</b> ${esc(m.from_line)}</div>` : ''}</div>` : ''}
    ${m.status === 'revoked' && m.revoke_reason ? `<div class="mt-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded px-2 py-1">${esc(t('memo_status_revoked'))}: ${esc(m.revoke_reason)}</div>` : ''}
    <div class="mt-4 grid ${m.body_en ? 'md:grid-cols-2' : ''} gap-3">
      <div><div class="text-xs font-bold text-slate-500 uppercase mb-1">VI</div>
        <div class="text-sm bg-slate-50 rounded-md p-3 whitespace-pre-wrap">${esc(m.body_vi || '—')}</div></div>
      ${m.body_en ? `<div><div class="text-xs font-bold text-slate-500 uppercase mb-1">EN</div>
        <div class="text-sm bg-slate-50 rounded-md p-3 whitespace-pre-wrap">${esc(m.body_en)}</div></div>` : ''}
    </div>
    ${relDocs ? `<div class="mt-3"><span class="text-xs font-bold text-slate-500 uppercase">${esc(t('memo_related'))}:</span> ${relDocs}</div>` : ''}
    <div class="mt-2"><span class="text-xs font-bold text-slate-500 uppercase">${esc(t('memo_visible'))}:</span> ${(m.visible_to || []).map(i => `<span class="chip">${esc(orgName(i))}</span>`).join('') || `<span class="chip">${esc(t('all_departments'))}</span>`}</div>
    ${attach}
    <div class="flex flex-wrap gap-2 mt-4">
      <button class="btn btn-outline btn-sm" data-print>🖨 ${esc(t('btn_print'))}</button>
      <button class="btn btn-outline btn-sm" data-word>📄 ${esc(t('btn_word'))}</button></div>
    <div class="flex flex-wrap gap-2 mt-3" id="wf-buttons"></div>
    <div class="mt-6"><div class="text-xs font-bold text-slate-500 uppercase mb-2">${esc(t('memo_history'))}</div>
      <div class="space-y-1 text-xs text-slate-600">
        ${(hist.data || []).map(h => `<div>• v${h.version} — ${esc(t('memo_status_' + h.status))} <span class="text-slate-400">${new Date(h.updated_at).toLocaleString('vi-VN')}</span>${h.id === m.id ? ' ◀' : ''}</div>`).join('')}
        <hr class="my-2">
        ${(logs.data || []).map(l => `<div>• <b>${esc(userName(l.actor_id))}</b> ${esc(l.action)} ${l.old_status ? esc(l.old_status) + '→' : ''}${esc(l.new_status || '')} ${l.note ? '— ' + esc(l.note) : ''} <span class="text-slate-400">${new Date(l.at).toLocaleString('vi-VN')}</span></div>`).join('')}
      </div></div></div>`;
  const root = openDrawer(html);
  root.querySelector('[data-close]').addEventListener('click', closeDrawer);
  root.querySelectorAll('[data-reldoc]').forEach(el => el.addEventListener('click', () => { closeDrawer(); openDocDrawer(el.dataset.reldoc); }));
  root.querySelector('[data-print]')?.addEventListener('click', () => printMemo(m));
  root.querySelector('[data-word]')?.addEventListener('click', () => downloadMemoDocx(m));

  /* nút workflow render theo role_matrix + trạng thái */
  const btns = [];
  const isAuthor = m.author_id === S.user.id;
  if (m.status === 'draft' && (isAuthor || S.profile.is_admin)) {
    btns.push({ l: t('btn_edit'), cls: 'btn-outline', fn: () => { closeDrawer(); openMemoEditor(m); } });
    btns.push({ l: t('wf_submit'), cls: 'btn-primary', fn: () => moveMemo(m, 'submitted') });
  }
  if (m.status === 'submitted' && hasPerm('memo', 'review')) {
    btns.push({ l: t('wf_start_review'), cls: 'btn-primary', fn: () => moveMemo(m, 'under_review', { reviewer_id: S.user.id }) });
    btns.push({ l: t('wf_send_back'), cls: 'btn-danger', fn: () => sendBack(m) });
  }
  if (m.status === 'under_review' && hasPerm('memo', 'approve')) {
    btns.push({ l: t('wf_approve'), cls: 'btn-primary', fn: () => moveMemo(m, 'approved', { approver_id: S.user.id }) });
    btns.push({ l: t('wf_send_back'), cls: 'btn-danger', fn: () => sendBack(m) });
  }
  if (m.status === 'approved' && hasPerm('memo', 'publish')) {
    btns.push({ l: t('wf_publish'), cls: 'btn-primary', fn: () => moveMemo(m, 'published') });
    btns.push({ l: t('wf_send_back'), cls: 'btn-danger', fn: () => sendBack(m) });
  }
  if (m.status === 'published' && (hasPerm('memo', 'publish') || S.profile.is_admin)) {
    btns.push({ l: t('wf_revoke'), cls: 'btn-danger', fn: () => revokeMemo(m) });
    btns.push({ l: t('wf_supersede'), cls: 'btn-outline', fn: () => supersedeMemo(m) });
  }
  $('#wf-buttons').innerHTML = btns.map((b, i) => `<button class="btn ${b.cls}" data-wf="${i}">${esc(b.l)}</button>`).join('');
  root.querySelectorAll('[data-wf]').forEach(el => el.addEventListener('click', () => btns[Number(el.dataset.wf)].fn()));
}
async function moveMemo(m, status, extra = {}) {
  const { error } = await sb.from('memos').update({ status, ...extra }).eq('id', m.id);
  if (error) { toast(error.message, false); return; }
  toast(t('saved')); closeDrawer(); pageMemos(); renderSidebar();
}
async function sendBack(m) {
  const note = prompt(t('wf_note_required')); if (!note) return;
  const { error } = await sb.from('memos').update({ status: 'draft' }).eq('id', m.id);
  if (error) { toast(error.message, false); return; }
  await audit('memos', m.id, 'send_back', note, m.status, 'draft');
  toast(t('saved')); closeDrawer(); pageMemos(); renderSidebar();
}
async function revokeMemo(m) {
  const reason = prompt(t('wf_note_required')); if (!reason) return;
  const { error } = await sb.from('memos').update({ status: 'revoked', revoke_reason: reason }).eq('id', m.id);
  if (error) { toast(error.message, false); return; }
  toast(t('saved')); closeDrawer(); pageMemos(); renderSidebar();
}
async function supersedeMemo(m) {
  // tạo bản nháp version+1 rồi đánh dấu bản cũ superseded khi bản mới được publish
  const copy = { ...m };
  delete copy.id; delete copy.created_at; delete copy.updated_at; delete copy.search_vector;
  Object.assign(copy, {
    version: m.version + 1, parent_id: m.parent_id || m.id, status: 'draft',
    author_id: S.user.id, submitted_at: null, reviewed_at: null, approved_at: null, published_at: null
  });
  const { data, error } = await sb.from('memos').insert(copy).select().single();
  if (error) { toast(error.message, false); return; }
  await sb.from('memos').update({ status: 'superseded' }).eq('id', m.id);
  await audit('memos', m.id, 'superseded_by', data.id, 'published', 'superseded');
  toast(t('saved')); closeDrawer(); openMemoEditor(data);
}

/* ------------------------------ memo editor ------------------------------- */
async function openMemoEditor(m) {
  if (!LEGAL_CACHE.length) LEGAL_CACHE = (await sb.from('legal_docs').select('id, doc_no, title_vi')).data || [];
  const catOpts = S.categories.map(c => `<option value="${c.id}" ${m?.category_id === c.id ? 'selected' : ''}>${esc(S.lang === 'vi' ? c.name_vi : c.name_en)}</option>`).join('');
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-navy mb-4">${m ? esc(t('memo_edit')) + ' — ' + esc(m.memo_code) : esc(t('memo_new'))}</h2>
    <form id="memo-form" class="space-y-3">
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="text-xs font-semibold">${esc(t('memo_title_vi'))} *</label><input name="title_vi" value="${esc(m?.title_vi || '')}" required></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_title_en'))}</label><input name="title_en" value="${esc(m?.title_en || '')}"></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_to'))}</label><input name="to_line" value="${esc(m?.to_line || '')}" placeholder="Mr. A – Chức danh/ Title, Đơn vị"></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_from'))}</label><input name="from_line" value="${esc(m?.from_line || '')}" placeholder="Mr. B – Chức danh/ Title, Đơn vị"></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_body_vi'))}</label><textarea name="body_vi" rows="8">${esc(m?.body_vi || '')}</textarea></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_body_en'))}</label><textarea name="body_en" rows="8">${esc(m?.body_en || '')}</textarea></div>
        <div><label class="text-xs font-semibold">${esc(t('col_category'))}</label><select name="category_id"><option value="">—</option>${catOpts}</select></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_effective'))}</label><input type="date" name="effective_date" value="${m?.effective_date || ''}"></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_signer'))}</label><input name="signer_name" value="${esc(m?.signer_name || '')}" placeholder="NGUYỄN VĂN A"></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_signer_title'))}</label><input name="signer_title" value="${esc(m?.signer_title || '')}" placeholder="Tổng Giám đốc/ General Manager"></div>
      </div>
      <div class="text-[11px] text-slate-400">${esc(t('memo_bilingual_hint'))}</div>
      <div><label class="text-xs font-semibold">${esc(t('memo_visible'))}</label>${checkboxList('visible_to', S.orgUnits.map(o => ({ v: String(o.id), l: orgName(o.id) })), (m?.visible_to || []).map(String))}</div>
      <div><label class="text-xs font-semibold">${esc(t('memo_related'))}</label>
        <select multiple size="4" name="related">${LEGAL_CACHE.map(d => `<option value="${d.id}" ${(m?.related_legal_doc_ids || []).includes(d.id) ? 'selected' : ''}>${esc(d.doc_no)} — ${esc((d.title_vi || '').slice(0, 60))}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">${esc(t('memo_attachment'))}</label><input type="file" name="attachment">
        ${m?.attachment_path ? `<span class="text-xs text-slate-500">📎 ${esc(m.attachment_path.split('/').pop())}</span>` : ''}</div>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('btn_save'))}</button></div>
    </form></div>`, true);
  root.querySelector('[data-cancel]').addEventListener('click', closeModal);
  root.querySelector('#memo-form').addEventListener('submit', async e => {
    e.preventDefault();
    const g = n => root.querySelector(`[name="${n}"]`)?.value.trim() || null;
    const row = {
      title_vi: g('title_vi'), title_en: g('title_en'),
      body_vi: root.querySelector('[name="body_vi"]').value, body_en: root.querySelector('[name="body_en"]').value || null,
      category_id: g('category_id') ? Number(g('category_id')) : null,
      effective_date: g('effective_date'),
      visible_to: readChecks(root, 'visible_to').map(Number),
      related_legal_doc_ids: [...root.querySelector('[name="related"]').selectedOptions].map(o => o.value),
      to_line: g('to_line'), from_line: g('from_line'),
      signer_name: g('signer_name'), signer_title: g('signer_title')
    };
    // upload file nếu có
    const f = root.querySelector('[name="attachment"]').files[0];
    if (f) {
      const path = `${S.user.id}/${Date.now()}_${f.name}`;
      const { error: upErr } = await sb.storage.from('memo-attachments').upload(path, f);
      if (upErr) { toast(upErr.message, false); return; }
      row.attachment_path = path;
    }
    if (!m?.id) {
      const year = new Date().getFullYear();
      const { count } = await sb.from('memos').select('*', { count: 'exact', head: true }).like('memo_code', `MEMO-${year}-%`);
      row.memo_code = `MEMO-${year}-${String((count || 0) + 1).padStart(3, '0')}`;
      row.author_id = S.user.id;
    }
    const { error } = await saveRowTolerant('memos', row, m?.id, ['to_line', 'from_line', 'signer_name', 'signer_title']);
    if (error) { toast(error.message, false); return; }
    toast(t('saved')); closeModal(); pageMemos();
  });
}

/* ============================================================================
 * SOP — Quy trình nội bộ (thuộc nhóm Văn bản nội bộ)
 * ==========================================================================*/
let SOP_CACHE = [];
async function pageSops(tab = 'all') {
  const { data, error } = await sb.from('sops').select('*').order('updated_at', { ascending: false });
  if (error) {
    $('#page').innerHTML = pageTitle(t('nav_sops')) +
      `<div class="bg-white rounded-lg shadow-sm p-6 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded">
         ${esc(t('sop_table_missing'))}</div>`;
    return;
  }
  SOP_CACHE = data || [];
  const canCreate = hasSopPerm('submit') || S.profile.is_admin;
  const catName = id => { const c = S.categories.find(x => x.id === id); return c ? (S.lang === 'vi' ? c.name_vi : c.name_en) : ''; };
  const tabs = [
    { k: 'all', l: t('memo_tab_all'), f: () => true },
    { k: 'mine', l: t('memo_tab_mine'), f: s => s.author_id === S.user.id && s.status === 'draft' },
    ...(hasSopPerm('review') ? [{ k: 'review', l: t('memo_tab_review'), f: s => ['submitted', 'under_review'].includes(s.status) }] : []),
    ...(hasSopPerm('approve') ? [{ k: 'approve', l: t('memo_tab_approve'), f: s => ['under_review', 'approved'].includes(s.status) }] : [])
  ];
  const cur = tabs.find(x => x.k === tab) || tabs[0];

  let html = pageTitle(t('nav_sops'));
  html += `<div class="flex flex-wrap items-center gap-2 mb-2">
    ${tabs.map(x => `<button class="btn btn-sm ${x.k === cur.k ? 'btn-primary' : 'btn-outline'}" data-soptab="${x.k}">${esc(x.l)}</button>`).join('')}
    <span class="flex-1"></span>
    ${hasSopPerm('publish') || S.profile.is_admin ? `<button class="btn btn-outline" id="btn-sop-import">${esc(t('btn_import_csv'))}</button>
      <button class="btn btn-outline" id="btn-sop-bulk">${esc(t('btn_bulk_assign'))}</button>` : ''}
    ${S.profile.is_admin ? `<button class="btn btn-danger" id="btn-sop-del">${esc(t('btn_bulk_delete'))}</button>` : ''}
    ${canCreate ? `<button class="btn btn-primary" id="btn-newsop">${esc(t('sop_new'))}</button>` : ''}</div>
    <div class="text-xs text-slate-500 mb-3">${esc(t('sop_intro'))}</div>
    <div id="sop-table"></div>`;
  $('#page').innerHTML = html;
  document.querySelectorAll('[data-soptab]').forEach(b => b.addEventListener('click', () => pageSops(b.dataset.soptab)));
  $('#btn-newsop')?.addEventListener('click', () => openSopEditor(null));
  $('#btn-sop-import')?.addEventListener('click', () => openBulkImport('sops'));
  $('#btn-sop-bulk')?.addEventListener('click', () => openBulkAssign('sops'));
  $('#btn-sop-del')?.addEventListener('click', () => openBulkDelete('sops'));

  const tbl = makeTable({
    columns: [
      { key: 'code', label: t('col_code'), type: 'text', width: 120, render: r => `<b class="text-navy">${esc(r.code || '—')}</b> <span class="text-xs text-slate-400">v${r.version || 1}</span>` },
      { key: 'title_vi', label: t('col_title'), type: 'text', width: 320, val: r => S.lang === 'en' && r.title_en ? r.title_en : r.title_vi, render: r => esc(S.lang === 'en' && r.title_en ? r.title_en : r.title_vi) },
      { key: 'category_id', label: t('col_category'), type: 'multi', width: 150, options: S.categories.map(c => ({ v: String(c.id), l: catName(c.id) })), val: r => String(r.category_id || ''), render: r => esc(catName(r.category_id)) },
      { key: 'status', label: t('col_status'), type: 'multi', width: 130, align: 'center', options: MEMO_STATUSES.map(x => ({ v: x, l: t('memo_status_' + x) })), render: r => memoStatusBadge(r.status) },
      { key: 'author_id', label: t('col_author'), type: 'text', width: 140, val: r => userName(r.author_id), render: r => esc(userName(r.author_id)) },
      { key: 'visible_to', label: t('sop_visible'), type: 'multi', width: 180, options: S.orgUnits.map(o => ({ v: String(o.id), l: orgName(o.id) })), val: r => (r.visible_to || []).map(String), render: r => (r.visible_to || []).length ? (r.visible_to || []).map(id => `<span class="chip">${esc(orgName(id))}</span>`).join('') : `<span class="chip">${esc(t('all_departments'))}</span>` },
      { key: 'updated_at', label: t('col_updated'), type: 'date', width: 150, align: 'center', val: r => (r.updated_at || '').slice(0, 10), render: r => new Date(r.updated_at).toLocaleString('vi-VN') }
    ],
    rows: SOP_CACHE.filter(cur.f),
    onRow: openSopDrawer
  });
  $('#sop-table').appendChild(tbl);
}

async function openSopDrawer(id) {
  const s = SOP_CACHE.find(x => x.id === id) || (await sb.from('sops').select('*').eq('id', id).single()).data;
  if (!s) return;
  const en = S.lang === 'en';
  const catName = cid => { const c = S.categories.find(x => x.id === cid); return c ? (S.lang === 'vi' ? c.name_vi : c.name_en) : ''; };
  const [hist, logs] = await Promise.all([
    sb.from('sops').select('id, code, version, status, updated_at').or(`id.eq.${s.parent_id || s.id},parent_id.eq.${s.parent_id || s.id}`).order('version'),
    sb.from('audit_log').select('*').eq('entity', 'sops').eq('entity_id', s.id).order('at', { ascending: false }).limit(20)
  ]);
  let attach = '';
  if (s.attachment_path) {
    const { data } = await sb.storage.from('memo-attachments').createSignedUrl(s.attachment_path, 3600);
    if (data?.signedUrl) attach = `<a class="btn btn-outline btn-sm mt-2" href="${esc(data.signedUrl)}" target="_blank">📎 ${esc(s.attachment_path.split('/').pop())}</a>`;
  }
  const html = `<div class="p-6">
    <div class="flex items-start justify-between gap-3">
      <div><div class="text-xs text-slate-500">SOP · v${s.version || 1}${s.code ? ' · ' + esc(s.code) : ''}${s.category_id ? ' · ' + esc(catName(s.category_id)) : ''}</div>
        <h2 class="text-xl font-extrabold text-navy mt-1">${esc(en && s.title_en ? s.title_en : s.title_vi)}</h2></div>
      <button class="btn btn-outline btn-sm" data-close>✕</button></div>
    <div class="flex flex-wrap gap-2 mt-2 items-center">${memoStatusBadge(s.status)}
      ${s.is_hidden ? `<span class="badge bg-slate-200 text-slate-600">${esc(t('sop_hidden'))}</span>` : ''}
      <span class="text-xs text-slate-500">${esc(t('col_author'))}: <b>${esc(userName(s.author_id))}</b></span>
      <span class="text-xs text-slate-500">${esc(t('sop_visible'))}: ${(s.visible_to || []).map(i => `<span class="chip">${esc(orgName(i))}</span>`).join('') || `<span class="chip">${esc(t('all_departments'))}</span>`}</span></div>
    ${s.status === 'revoked' && s.revoke_reason ? `<div class="mt-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded px-2 py-1">${esc(t('memo_status_revoked'))}: ${esc(s.revoke_reason)}</div>` : ''}
    ${s.dept_name ? `<div class="mt-2 text-xs text-slate-600"><b>${esc(t('sop_dept'))}:</b> ${esc(s.dept_name)}</div>` : ''}
    ${s.objective || s.performers || s.beneficiaries || s.steps ? `<div class="mt-4 space-y-2 text-sm">
      ${s.objective ? `<div><span class="font-bold text-navy">Mục đích/ Objective:</span> ${esc(s.objective)}</div>` : ''}
      ${s.performers ? `<div><span class="font-bold text-navy">${esc(t('sop_performers'))}:</span> ${esc(s.performers)}</div>` : ''}
      ${s.beneficiaries ? `<div><span class="font-bold text-navy">${esc(t('sop_beneficiaries'))}:</span> ${esc(s.beneficiaries)}</div>` : ''}
      ${s.steps ? `<div><div class="font-bold text-navy">QUY TRÌNH/ PROCEDURES</div>
        <ul class="list-disc ml-5 mt-1 space-y-1 bg-slate-50 rounded-md p-3">${s.steps.split(/\n/).map(x => x.trim()).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${s.lean_note ? `<div><span class="font-bold text-navy">${esc(t('sop_lean_note'))}:</span> ${esc(s.lean_note)}</div>` : ''}
    </div>` : ''}
    ${s.body_vi || s.body_en ? `<div class="mt-4 grid ${s.body_en ? 'md:grid-cols-2' : ''} gap-3">
      ${s.body_vi ? `<div><div class="text-xs font-bold text-slate-500 uppercase mb-1">VI</div>
        <div class="text-sm bg-slate-50 rounded-md p-3 whitespace-pre-wrap">${esc(s.body_vi)}</div></div>` : ''}
      ${s.body_en ? `<div><div class="text-xs font-bold text-slate-500 uppercase mb-1">EN</div>
        <div class="text-sm bg-slate-50 rounded-md p-3 whitespace-pre-wrap">${esc(s.body_en)}</div></div>` : ''}
    </div>` : ''}
    ${attach}
    <div class="flex flex-wrap gap-2 mt-4">
      <button class="btn btn-outline btn-sm" data-print>🖨 ${esc(t('btn_print'))}</button>
      <button class="btn btn-outline btn-sm" data-word>📄 ${esc(t('btn_word'))}</button></div>
    <div class="flex flex-wrap gap-2 mt-3" id="sop-wf-buttons"></div>
    <div class="mt-6"><div class="text-xs font-bold text-slate-500 uppercase mb-2">${esc(t('memo_history'))}</div>
      <div class="space-y-1 text-xs text-slate-600">
        ${(hist.data || []).map(h => `<div>• v${h.version} — ${esc(t('memo_status_' + h.status))} <span class="text-slate-400">${new Date(h.updated_at).toLocaleString('vi-VN')}</span>${h.id === s.id ? ' ◀' : ''}</div>`).join('')}
        <hr class="my-2">
        ${(logs.data || []).map(l => `<div>• <b>${esc(userName(l.actor_id))}</b> ${esc(l.action)} ${l.old_status ? esc(l.old_status) + '→' : ''}${esc(l.new_status || '')} ${l.note ? '— ' + esc(l.note) : ''} <span class="text-slate-400">${new Date(l.at).toLocaleString('vi-VN')}</span></div>`).join('')}
      </div></div></div>`;
  const root = openDrawer(html);
  root.querySelector('[data-close]').addEventListener('click', closeDrawer);
  root.querySelectorAll('[data-reldoc]').forEach(el => el.addEventListener('click', () => { closeDrawer(); openDocDrawer(el.dataset.reldoc); }));
  root.querySelector('[data-print]')?.addEventListener('click', () => printSop(s));
  root.querySelector('[data-word]')?.addEventListener('click', () => downloadSopDocx(s));

  const btns = [];
  const isAuthor = s.author_id === S.user.id;
  if (s.status === 'draft' && (isAuthor || S.profile.is_admin)) {
    btns.push({ l: t('btn_edit'), cls: 'btn-outline', fn: () => { closeDrawer(); openSopEditor(s); } });
    btns.push({ l: t('wf_submit'), cls: 'btn-primary', fn: () => moveSop(s, 'submitted') });
  }
  if (s.status === 'submitted' && hasSopPerm('review')) {
    btns.push({ l: t('wf_start_review'), cls: 'btn-primary', fn: () => moveSop(s, 'under_review', { reviewer_id: S.user.id }) });
    btns.push({ l: t('wf_send_back'), cls: 'btn-danger', fn: () => sendBackSop(s) });
  }
  if (s.status === 'under_review' && hasSopPerm('approve')) {
    btns.push({ l: t('wf_approve'), cls: 'btn-primary', fn: () => moveSop(s, 'approved', { approver_id: S.user.id }) });
    btns.push({ l: t('wf_send_back'), cls: 'btn-danger', fn: () => sendBackSop(s) });
  }
  if (s.status === 'approved' && hasSopPerm('publish')) {
    btns.push({ l: t('wf_publish'), cls: 'btn-primary', fn: () => moveSop(s, 'published') });
    btns.push({ l: t('wf_send_back'), cls: 'btn-danger', fn: () => sendBackSop(s) });
  }
  if (s.status === 'published' && (hasSopPerm('publish') || S.profile.is_admin)) {
    btns.push({ l: t('wf_revoke'), cls: 'btn-danger', fn: () => revokeSop(s) });
    btns.push({ l: t('wf_supersede'), cls: 'btn-outline', fn: () => supersedeSop(s) });
    btns.push({ l: s.is_hidden ? t('sop_unhide') : t('sop_hide'), cls: s.is_hidden ? 'btn-primary' : 'btn-outline', fn: () => toggleSopHidden(s) });
  }
  $('#sop-wf-buttons').innerHTML = btns.map((b, i) => `<button class="btn ${b.cls}" data-wf="${i}">${esc(b.l)}</button>`).join('');
  root.querySelectorAll('[data-wf]').forEach(el => el.addEventListener('click', () => btns[Number(el.dataset.wf)].fn()));
}
async function moveSop(s, status, extra = {}) {
  const { error } = await sb.from('sops').update({ status, ...extra }).eq('id', s.id);
  if (error) { toast(error.message, false); return; }
  toast(t('saved')); closeDrawer(); pageSops(); renderSidebar();
}
async function sendBackSop(s) {
  const note = prompt(t('wf_note_required')); if (!note) return;
  const { error } = await sb.from('sops').update({ status: 'draft' }).eq('id', s.id);
  if (error) { toast(error.message, false); return; }
  await audit('sops', s.id, 'send_back', note, s.status, 'draft');
  toast(t('saved')); closeDrawer(); pageSops(); renderSidebar();
}
async function revokeSop(s) {
  const reason = prompt(t('wf_note_required')); if (!reason) return;
  const { error } = await sb.from('sops').update({ status: 'revoked', revoke_reason: reason }).eq('id', s.id);
  if (error) { toast(error.message, false); return; }
  toast(t('saved')); closeDrawer(); pageSops(); renderSidebar();
}
async function supersedeSop(s) {
  const copy = { ...s };
  delete copy.id; delete copy.created_at; delete copy.updated_at; delete copy.search_vector;
  Object.assign(copy, {
    version: (s.version || 1) + 1, parent_id: s.parent_id || s.id, status: 'draft',
    author_id: S.user.id, submitted_at: null, reviewed_at: null, approved_at: null, published_at: null,
    revoke_reason: null
  });
  const { data, error } = await sb.from('sops').insert(copy).select().single();
  if (error) { toast(error.message, false); return; }
  await sb.from('sops').update({ status: 'superseded' }).eq('id', s.id);
  await audit('sops', s.id, 'superseded_by', data.id, 'published', 'superseded');
  toast(t('saved')); closeDrawer(); openSopEditor(data);
}
async function toggleSopHidden(s) {
  const { error } = await sb.from('sops').update({ is_hidden: !s.is_hidden }).eq('id', s.id);
  if (error) { toast(error.message, false); return; }
  await audit('sops', s.id, s.is_hidden ? 'unhide' : 'hide', s.title_vi);
  toast(t('saved')); closeDrawer(); pageSops(); renderSidebar();
}

async function openSopEditor(s) {
  const catOpts = S.categories.map(c => `<option value="${c.id}" ${s?.category_id === c.id ? 'selected' : ''}>${esc(S.lang === 'vi' ? c.name_vi : c.name_en)}</option>`).join('');
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-navy mb-4">${s ? esc(t('sop_edit')) : esc(t('sop_new'))}</h2>
    <form id="sop-form" class="space-y-3">
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="text-xs font-semibold">${esc(t('sop_code'))}</label><input name="code" value="${esc(s?.code || '')}" placeholder="XX-SOP-000"></div>
        <div><label class="text-xs font-semibold">${esc(t('sop_dept'))}</label><input name="dept_name" value="${esc(s?.dept_name || '')}" placeholder="Phòng Pháp chế – Hành chính"></div>
        <div><label class="text-xs font-semibold">${esc(t('col_category'))}</label><select name="category_id"><option value="">—</option>${catOpts}</select></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_title_vi'))} *</label><input name="title_vi" value="${esc(s?.title_vi || '')}" required placeholder="Động từ + đối tượng, vd: Xử lý đơn nghỉ phép"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">${esc(t('memo_title_en'))}</label><input name="title_en" value="${esc(s?.title_en || '')}"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">${esc(t('sop_objective'))}</label><textarea name="objective" rows="2" placeholder="1–2 câu: SOP này bảo đảm điều gì?">${esc(s?.objective || '')}</textarea></div>
        <div><label class="text-xs font-semibold">${esc(t('sop_performers'))}</label><input name="performers" value="${esc(s?.performers || '')}" placeholder="Chức danh A (vai trò chính); Chức danh B (hỗ trợ)"></div>
        <div><label class="text-xs font-semibold">${esc(t('sop_beneficiaries'))}</label><input name="beneficiaries" value="${esc(s?.beneficiaries || '')}" placeholder="Đối tượng/bộ phận nhận giá trị"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">${esc(t('sop_steps'))}</label><textarea name="steps" rows="8" placeholder="Bước 1 – Tiếp nhận yêu cầu từ … qua kênh …&#10;Bước 2 – Kiểm tra tính hợp lệ trong … ngày làm việc&#10;Bước 3 – Trình … phê duyệt theo phân cấp">${esc(s?.steps || '')}</textarea></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">${esc(t('sop_lean_note'))}</label><textarea name="lean_note" rows="2" placeholder="Bước nào đã gộp / chạy song song / loại bỏ và vì sao">${esc(s?.lean_note || '')}</textarea></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_body_vi'))}</label><textarea name="body_vi" rows="4">${esc(s?.body_vi || '')}</textarea></div>
        <div><label class="text-xs font-semibold">${esc(t('memo_body_en'))}</label><textarea name="body_en" rows="4">${esc(s?.body_en || '')}</textarea></div>
      </div>
      <div><label class="text-xs font-semibold">${esc(t('sop_visible'))}</label>${checkboxList('visible_to', S.orgUnits.map(o => ({ v: String(o.id), l: orgName(o.id) })), (s?.visible_to || []).map(String))}
        <div class="text-[11px] text-slate-400 mt-1">${esc(t('sop_visible_hint'))}</div></div>
      <div><label class="text-xs font-semibold">${esc(t('memo_attachment'))}</label><input type="file" name="attachment">
        ${s?.attachment_path ? `<span class="text-xs text-slate-500">📎 ${esc(s.attachment_path.split('/').pop())}</span>` : ''}</div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_hidden" class="!w-auto" ${s?.is_hidden ? 'checked' : ''}>${esc(t('sop_hide_on_save'))}</label>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button>
        <button type="submit" class="btn btn-primary">${esc(t('btn_save'))}</button></div>
    </form></div>`, true);
  root.querySelector('[data-cancel]').addEventListener('click', closeModal);
  root.querySelector('#sop-form').addEventListener('submit', async e => {
    e.preventDefault();
    const g = n => root.querySelector(`[name="${n}"]`)?.value.trim() || null;
    const row = {
      code: g('code'), title_vi: g('title_vi'), title_en: g('title_en'),
      body_vi: root.querySelector('[name="body_vi"]').value, body_en: root.querySelector('[name="body_en"]').value || null,
      category_id: g('category_id') ? Number(g('category_id')) : null,
      visible_to: readChecks(root, 'visible_to').map(Number),
      is_hidden: root.querySelector('[name="is_hidden"]').checked,
      dept_name: g('dept_name'), objective: root.querySelector('[name="objective"]').value.trim() || null,
      performers: g('performers'), beneficiaries: g('beneficiaries'),
      steps: root.querySelector('[name="steps"]').value.trim() || null,
      lean_note: root.querySelector('[name="lean_note"]').value.trim() || null
    };
    const f = root.querySelector('[name="attachment"]').files[0];
    if (f) {
      const path = `sop/${S.user.id}/${Date.now()}_${f.name}`;
      const { error: upErr } = await sb.storage.from('memo-attachments').upload(path, f);
      if (upErr) { toast(upErr.message, false); return; }
      row.attachment_path = path;
    }
    if (!s?.id) row.author_id = S.user.id;
    const { error } = await saveRowTolerant('sops', row, s?.id,
      ['dept_name', 'objective', 'performers', 'beneficiaries', 'steps', 'lean_note']);
    if (error) { toast(error.message, false); return; }
    toast(t('saved')); closeModal(); pageSops();
  });
}

/* ============================================================================
 * IN / XUẤT FILE THEO TEMPLATE CÔNG TY (Memo + SOP)
 * Template gốc: SOP_Template.docx + Memo_Director Benefits.docx
 * Quy ước: VI = đen, EN = xanh #215E99; Times New Roman 12pt; A4.
 * ==========================================================================*/
const TPL = {
  company_vi: 'CÔNG TY TNHH LIÊN DOANH KHÁCH SẠN PLAZA',
  company_en: 'PLAZA HOTEL COMPANY LIMITED',
  addr: ['17 Lê Duẩn, P. Sài Gòn', 'TP. Hồ Chí Minh, Việt Nam', '(+84 28) 3823 5500'],
  navy: '0B2545', gold: 'B8860B', graybar: 'D8DDE3', gray: '6B7A8A', blue: '215E99'
};
const fileSafe = s => (s || 'document').replace(/[\/\\:*?"<>|]+/g, '-').trim();
const viDate = d => { if (!d) return ''; const [y, m, day] = d.split('-'); return `Ngày ${day} tháng ${m} năm ${y}`; };
const enDate = d => {
  if (!d) return '';
  const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const [y, m, day] = d.split('-'); return `${M[Number(m) - 1]} ${Number(day)}, ${y}`;
};
/* Tách 1 dòng song ngữ "phần VI/ phần EN" tại dấu "/ " đầu tiên (quy ước template:
   dấu "/" đi với phần VI màu đen, phần sau màu xanh). "42/2026" không có khoảng
   trắng sau "/" nên không bị tách nhầm. */
function biSplit(s) {
  s = s || '';
  const i = s.indexOf('/ ');
  if (i < 0) return [{ t: s, en: false }];
  return [{ t: s.slice(0, i + 2), en: false }, { t: s.slice(i + 2), en: true }];
}
/* Ghép song ngữ: nếu số đoạn VI = EN thì xen kẽ từng đoạn (như template), ngược lại VI hết rồi tới EN */
function biParas(vi, en) {
  const a = (vi || '').split(/\n/).map(x => x.trim()).filter(Boolean);
  const b = (en || '').split(/\n/).map(x => x.trim()).filter(Boolean);
  const out = [];
  if (a.length === b.length && a.length > 0) {
    for (let i = 0; i < a.length; i++) { out.push({ t: a[i], lang: 'vi' }); out.push({ t: b[i], lang: 'en' }); }
  } else { a.forEach(t => out.push({ t, lang: 'vi' })); b.forEach(t => out.push({ t, lang: 'en' })); }
  return out;
}

/* ------------------------- IN / PDF (cửa sổ in) --------------------------- */
function letterheadHTML() {
  return `<div class="lh">
    <table class="lh-top"><tr>
      <td class="lh-navy"></td><td class="lh-sp"></td>
      <td class="lh-name"><div class="c1">${esc(TPL.company_vi)}</div><div class="c2">${esc(TPL.company_en)}</div></td>
      <td class="lh-addr">${TPL.addr.map(a => `<div>${esc(a)}</div>`).join('')}</td>
    </tr></table>
    <table class="lh-bar"><tr><td class="b-gold"></td><td class="b-gray"></td></tr></table>
  </div>`;
}
function openPrintWindow(title, inner, { footer = '', marginCss = '2cm 2cm 2cm 2.5cm' } = {}) {
  const w = window.open('', '_blank');
  if (!w) { toast(t('print_popup_blocked'), false); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4; margin: ${marginCss}; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; }
    .lh { margin-bottom: 14pt; }
    table { border-collapse: collapse; width: 100%; }
    .lh-top td { vertical-align: top; }
    .lh-navy { width: 8pt; background: #${TPL.navy}; }
    .lh-sp { width: 4pt; }
    .lh-name .c1 { font-weight: bold; color: #${TPL.navy}; font-size: 10.5pt; }
    .lh-name .c2 { color: #${TPL.gray}; font-size: 8pt; }
    .lh-addr { text-align: right; color: #${TPL.gray}; font-size: 7.5pt; width: 130pt; }
    .lh-bar { margin-top: 4pt; }
    .b-gold { width: 68pt; background: #${TPL.gold}; height: 3pt; }
    .b-gray { background: #${TPL.graybar}; height: 3pt; }
    .en { color: #${TPL.blue}; }
    p { margin-bottom: 6pt; text-align: justify; }
    .memo-title { text-align: center; font-weight: bold; font-size: 20pt; margin: 8pt 0 2pt; }
    .memo-no { text-align: center; font-weight: bold; margin-bottom: 12pt; }
    .info, .info td { border: 0.5pt solid #000; }
    .info td { padding: 3pt 6pt; vertical-align: top; }
    .info .lbl { width: 27%; white-space: nowrap; }
    .sign { margin-top: 28pt; }
    .sign .name { font-weight: bold; text-transform: uppercase; margin-top: 42pt; }
    .sop-head { border: 0.75pt solid #000; margin-bottom: 12pt; }
    .sop-head td { border: 0.75pt solid #000; padding: 4pt 6pt; vertical-align: top; }
    .sop-head .tl { width: 40%; text-align: center; font-weight: bold; vertical-align: middle; }
    .sop-head .tl .en2 { font-weight: normal; color: #${TPL.blue}; font-size: 10pt; }
    .sop-head .code-cell { text-align: center; }
    .sop-title { font-weight: bold; text-align: center; }
    .lbl-b { font-weight: bold; }
    .lbl-blue { font-weight: bold; color: #${TPL.blue}; }
    .proc-head { text-align: center; font-weight: bold; margin: 14pt 0 6pt; }
    .lean { font-style: italic; }
    ul { margin: 4pt 0 8pt 22pt; }
    li { margin-bottom: 4pt; text-align: justify; }
    .foot { position: fixed; bottom: 0; left: 0; right: 0; font-size: 8pt; color: #${TPL.gray};
            border-top: 0.5pt solid #${TPL.graybar}; padding-top: 3pt; display: flex; justify-content: space-between; }
    @media print { .noprint { display: none; } }
  </style></head><body>
    ${letterheadHTML()}${inner}
    ${footer ? `<div class="foot"><span>${esc(footer)}</span></div>` : ''}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}
/* Dòng song ngữ "VI/ EN" → HTML: phần VI đen, phần EN xanh (đúng template) */
const biSpanHTML = s => biSplit(s).map(p => p.en ? `<span class="en">${esc(p.t)}</span>` : esc(p.t)).join('');
function printMemo(m) {
  const paras = biParas(m.body_vi, m.body_en)
    .map(p => `<p class="${p.lang === 'en' ? 'en' : ''}">${esc(p.t)}</p>`).join('');
  const inner = `
    <div class="memo-title">MEMO</div>
    <div class="memo-no">Số/ <span class="en">No.</span> ${esc(m.memo_code || '')}</div>
    <table class="info">
      <tr><td class="lbl">Kính gửi/ <span class="en">To:</span></td><td>${biSpanHTML(m.to_line || '')}</td></tr>
      <tr><td class="lbl">Từ/ <span class="en">From:</span></td><td>${biSpanHTML(m.from_line || '')}</td></tr>
      <tr><td class="lbl">Về việc/ <span class="en">Re:</span></td><td>${esc(m.title_vi || '')}${m.title_en ? `<span class="en">/ ${esc(m.title_en)}</span>` : ''}</td></tr>
      <tr><td class="lbl">Ngày hiệu lực:<br><span class="en">Effective date:</span></td>
          <td>${esc(viDate(m.effective_date))}<br><span class="en">${esc(enDate(m.effective_date))}</span></td></tr>
    </table>
    <div style="margin-top:12pt">${paras}</div>
    <div class="sign">
      <p>Trân trọng,<br><span class="en">Yours sincerely,</span></p>
      <div class="name">${esc(m.signer_name || '')}</div>
      <div><b>${biSpanHTML(m.signer_title || '')}</b></div>
    </div>`;
  openPrintWindow(`Memo ${m.memo_code || ''}`, inner,
    { footer: 'Plaza Hotel Company Limited  —  Confidential', marginCss: '2cm 2cm 2.2cm 2.5cm' });
}
function printSop(s) {
  const steps = (s.steps || '').split(/\n/).map(x => x.trim()).filter(Boolean);
  const inner = `
    <table class="sop-head">
      <tr><td class="tl" rowspan="2">QUY TRÌNH TIÊU CHUẨN<br><span class="en2">Standard Operating Procedure</span></td>
          <td>${esc(s.dept_name || '')}</td></tr>
      <tr><td class="code-cell">Mã số/ <span class="en">No.</span>: ${esc(s.code || '')}</td></tr>
      <tr><td colspan="2" class="sop-title">${esc(s.title_vi || '')}${s.title_en ? `<br><span class="en" style="font-weight:normal">${esc(s.title_en)}</span>` : ''}</td></tr>
    </table>
    <p><span class="lbl-b">Mục đích/ </span><span class="lbl-blue">Objective:</span> ${esc(s.objective || '')}</p>
    <p><span class="lbl-b">Người thực hiện:</span> ${esc(s.performers || '')}</p>
    <p><span class="lbl-b">Người thụ hưởng:</span> ${esc(s.beneficiaries || '')}</p>
    <p class="proc-head">QUY TRÌNH/ <span class="en">PROCEDURES</span></p>
    ${steps.length ? `<ul>${steps.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
      : biParas(s.body_vi, s.body_en).map(p => `<p class="${p.lang === 'en' ? 'en' : ''}">${esc(p.t)}</p>`).join('')}
    ${s.lean_note ? `<p class="lean"><span class="lbl-b" style="font-style:italic">Ghi chú ngắn gọn:</span> ${esc(s.lean_note)}</p>` : ''}`;
  openPrintWindow(`SOP ${s.code || ''}`, inner, { marginCss: '2.54cm' });
}

/* --------------------------- TẢI WORD (.docx) ----------------------------- */
let _docxLoading = null;
function ensureDocxLib() {
  if (window.docx) return Promise.resolve(window.docx);
  if (_docxLoading) return _docxLoading;
  _docxLoading = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js';
    sc.onload = () => res(window.docx);
    sc.onerror = () => { _docxLoading = null; rej(new Error(t('docx_lib_failed'))); };
    document.head.appendChild(sc);
  });
  return _docxLoading;
}
function docxHelpers(D) {
  const NB = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };
  const run = (text, o = {}) => new D.TextRun({ text, font: 'Times New Roman', size: o.size || 24,
    bold: o.bold, italics: o.italics, color: o.color, allCaps: o.caps });
  const para = (children, o = {}) => new D.Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: o.align, spacing: o.spacing || { after: 120 }, bullet: o.bullet });
  const cell = (kids, o = {}) => new D.TableCell({
    children: kids, width: { size: o.w, type: D.WidthType.DXA },
    shading: o.fill ? { type: D.ShadingType.CLEAR, fill: o.fill } : undefined,
    borders: o.borders, columnSpan: o.span, rowSpan: o.rowSpan,
    verticalMerge: o.vMerge, verticalAlign: D.VerticalAlign.TOP,
    margins: o.margins || { top: 40, bottom: 40, left: 80, right: 80 } });
  const thinBorders = { style: D.BorderStyle.SINGLE, size: 6, color: '000000' };
  const boxBorders = { top: thinBorders, bottom: thinBorders, left: thinBorders, right: thinBorders };
  /* Letterhead: ô navy + tên công ty + địa chỉ phải; thanh gold + xám */
  const letterhead = contentW => {
    const nameW = contentW - 142 - 20 - 2130;
    const barMargins = { top: 0, bottom: 0, left: 0, right: 0 };
    const t1 = new D.Table({ width: { size: contentW, type: D.WidthType.DXA }, columnWidths: [142, 20, nameW, 2130],
      borders: noBorders, rows: [new D.TableRow({ children: [
        cell([para(run('', { size: 2 }), { spacing: { after: 0 } })], { w: 142, fill: TPL.navy, borders: noBorders }),
        cell([para(run('', { size: 2 }), { spacing: { after: 0 } })], { w: 20, borders: noBorders }),
        cell([para(run(TPL.company_vi, { bold: true, color: TPL.navy, size: 21 }), { spacing: { after: 0 } }),
              para(run(TPL.company_en, { color: TPL.gray, size: 16 }), { spacing: { after: 0 } })], { w: nameW, borders: noBorders }),
        cell(TPL.addr.map(a => para(run(a, { color: TPL.gray, size: 15 }), { align: D.AlignmentType.RIGHT, spacing: { after: 0 } })), { w: 2130, borders: noBorders })
      ] })] });
    const t2 = new D.Table({ width: { size: contentW, type: D.WidthType.DXA }, columnWidths: [1200, contentW - 1200],
      borders: noBorders, rows: [new D.TableRow({ height: { value: 60, rule: D.HeightRule.ATLEAST }, children: [
        cell([para(run('', { size: 2 }), { spacing: { after: 0 } })], { w: 1200, fill: TPL.gold, borders: noBorders, margins: barMargins }),
        cell([para(run('', { size: 2 }), { spacing: { after: 0 } })], { w: contentW - 1200, fill: TPL.graybar, borders: noBorders, margins: barMargins })
      ] })] });
    return new D.Header({ children: [t1, t2] });
  };
  return { noBorders, boxBorders, run, para, cell, letterhead };
}
function saveDocxBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function downloadMemoDocx(m) {
  const D = await ensureDocxLib().catch(e => { toast(e.message, false); return null; });
  if (!D) return;
  const { run, para, cell, noBorders, letterhead } = docxHelpers(D);
  const CW = 9354; /* content width: A4 11906 - 1418 - 1134 */
  const J = D.AlignmentType.JUSTIFIED;
  const body = biParas(m.body_vi, m.body_en).map(p =>
    para(run(p.t, p.lang === 'en' ? { color: TPL.blue } : {}), { align: J }));
  /* biRuns: dòng "VI/ EN" → run VI đen + run EN xanh (đúng template);
     nhãn bảng info: KHÔNG đậm, VI đen + EN xanh; bảng info CÓ viền đơn 0.5pt */
  const biRuns = (s, o = {}) => biSplit(s).map(p => run(p.t, { ...o, color: p.en ? TPL.blue : o.color }));
  const thin = { style: D.BorderStyle.SINGLE, size: 4, color: '000000' };
  const infoBorders = { top: thin, bottom: thin, left: thin, right: thin };
  const LBLW = 2600; /* theo template gốc: cột nhãn 2600/9360 */
  const infoRow = (lblVi, lblEn, lblEn2, kids) => new D.TableRow({ children: [
    cell([para([run(lblVi), run(lblEn, { color: TPL.blue })], { spacing: { after: 0 } }),
      ...(lblEn2 ? [para(run(lblEn2, { color: TPL.blue }), { spacing: { after: 0 } })] : [])], { w: LBLW, borders: infoBorders }),
    cell(kids, { w: CW - LBLW, borders: infoBorders })] });
  const doc = new D.Document({ sections: [{
    properties: { page: { size: { width: 11906, height: 16838 },
      margin: { top: 1134, right: 1134, bottom: 1134, left: 1418, header: 709, footer: 709 } } },
    headers: { default: letterhead(CW) },
    footers: { default: new D.Footer({ children: [new D.Paragraph({
      tabStops: [{ type: D.TabStopType.RIGHT, position: CW }],
      children: [run('Plaza Hotel Company Limited  —  Confidential', { size: 16, color: TPL.gray }),
        new D.TextRun({ children: ['\t', 'Page '], font: 'Times New Roman', size: 16, color: TPL.gray }),
        new D.TextRun({ children: [D.PageNumber.CURRENT], font: 'Times New Roman', size: 16, color: TPL.gray })] })] }) },
    children: [
      para(run('MEMO', { bold: true, size: 40 }), { align: D.AlignmentType.CENTER, spacing: { after: 40 } }),
      para([run('Số/ ', { bold: true }), run('No.', { bold: true, color: TPL.blue }), run(` ${m.memo_code || ''}`, { bold: true })],
        { align: D.AlignmentType.CENTER, spacing: { after: 240 } }),
      new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: [LBLW, CW - LBLW], borders: infoBorders, rows: [
        infoRow('Kính gửi/ ', 'To:', '', [para(biRuns(m.to_line || ''), { spacing: { after: 0 } })]),
        infoRow('Từ/ ', 'From:', '', [para(biRuns(m.from_line || ''), { spacing: { after: 0 } })]),
        infoRow('Về việc/ ', 'Re:', '', [para([run(m.title_vi || ''),
          ...(m.title_en ? [run(`/ ${m.title_en}`, { color: TPL.blue })] : [])], { spacing: { after: 0 } })]),
        infoRow('Ngày hiệu lực:', '', 'Effective date:', [
          para(run(viDate(m.effective_date)), { spacing: { after: 0 } }),
          para(run(enDate(m.effective_date), { color: TPL.blue }), { spacing: { after: 0 } })])
      ] }),
      para(run('', { size: 2 }), { spacing: { after: 120 } }),
      ...body,
      para(run('Trân trọng,'), { spacing: { before: 240, after: 0 } }),
      para(run('Yours sincerely,', { color: TPL.blue }), { spacing: { after: 720 } }),
      para(run((m.signer_name || '').toUpperCase(), { bold: true }), { spacing: { after: 0 } }),
      para(biRuns(m.signer_title || '', { bold: true }), { spacing: { after: 0 } })
    ] }] });
  const blob = await D.Packer.toBlob(doc);
  saveDocxBlob(blob, `Memo_${fileSafe(m.memo_code)}.docx`);
}
async function downloadSopDocx(s) {
  const D = await ensureDocxLib().catch(e => { toast(e.message, false); return null; });
  if (!D) return;
  const { run, para, cell, letterhead, boxBorders } = docxHelpers(D);
  const CW = 9026; /* content width: A4 11906 - 1440*2 */
  const J = D.AlignmentType.JUSTIFIED;
  const C = D.AlignmentType.CENTER;
  const steps = (s.steps || '').split(/\n/).map(x => x.trim()).filter(Boolean);
  const stepParas = steps.length
    ? steps.map(x => para(run(x), { bullet: { level: 0 }, align: J }))
    : biParas(s.body_vi, s.body_en).map(p => para(run(p.t, p.lang === 'en' ? { color: TPL.blue } : {}), { align: J }));
  /* Nhãn theo template: phần VI đậm ĐEN + phần EN đậm XANH (không phải cả nhãn xanh) */
  const lblPara = (lblVi, lblEn, txt) => para([
    run(lblVi, { bold: true }),
    ...(lblEn ? [run(lblEn, { bold: true, color: TPL.blue })] : []),
    run(' ' + (txt || ''))], { align: J });
  const doc = new D.Document({ sections: [{
    properties: { page: { size: { width: 11906, height: 16838 },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } } },
    headers: { default: letterhead(CW) },
    children: [
      new D.Table({ width: { size: CW, type: D.WidthType.DXA }, columnWidths: [3610, CW - 3610], borders: boxBorders, rows: [
        new D.TableRow({ children: [
          cell([para(run('QUY TRÌNH TIÊU CHUẨN', { bold: true }), { align: C, spacing: { after: 0 } }),
                para(run('Standard Operating Procedure', { size: 20, color: TPL.blue }), { align: C, spacing: { after: 0 } })],
                { w: 3610, borders: boxBorders, vMerge: D.VerticalMergeType.RESTART }),
          cell([para(run(s.dept_name || ''), { spacing: { after: 0 } })], { w: CW - 3610, borders: boxBorders })] }),
        new D.TableRow({ children: [
          cell([para(run('', { size: 2 }), { spacing: { after: 0 } })], { w: 3610, borders: boxBorders, vMerge: D.VerticalMergeType.CONTINUE }),
          cell([para([run('Mã số/ '), run('No.', { color: TPL.blue }), run(`: ${s.code || ''}`)], { align: C, spacing: { after: 0 } })], { w: CW - 3610, borders: boxBorders })] }),
        new D.TableRow({ children: [
          cell([para(run(s.title_vi || '', { bold: true }), { align: C, spacing: { after: 0 } }),
            ...(s.title_en ? [para(run(s.title_en, { color: TPL.blue }), { align: C, spacing: { after: 0 } })] : [])],
            { w: CW, span: 2, borders: boxBorders })] })
      ] }),
      para(run('', { size: 2 }), { spacing: { after: 120 } }),
      lblPara('Mục đích/ ', 'Objective:', s.objective),
      lblPara('Người thực hiện:', '', s.performers),
      lblPara('Người thụ hưởng:', '', s.beneficiaries),
      para([run('QUY TRÌNH/ ', { bold: true }), run('PROCEDURES', { bold: true, color: TPL.blue })],
        { align: C, spacing: { before: 280, after: 120 } }),
      ...stepParas,
      ...(s.lean_note ? [para([run('Ghi chú ngắn gọn: ', { bold: true, italics: true }),
        run(s.lean_note, { italics: true })], { align: J })] : [])
    ] }] });
  const blob = await D.Packer.toBlob(doc);
  saveDocxBlob(blob, `SOP_${fileSafe(s.code || s.title_vi)}.docx`);
}
/* Lưu row có các cột mới; nếu DB chưa chạy SQL bổ sung thì tự bỏ cột mới và lưu tiếp */
async function saveRowTolerant(table, row, id, extraCols) {
  let q = id ? sb.from(table).update(row).eq('id', id) : sb.from(table).insert(row);
  let { error } = await q;
  if (error && /column|schema cache/i.test(error.message || '')) {
    const slim = { ...row };
    extraCols.forEach(c => delete slim[c]);
    ({ error } = await (id ? sb.from(table).update(slim).eq('id', id) : sb.from(table).insert(slim)));
    if (!error) toast(t('print_cols_missing'), false);
  }
  return { error };
}

/* ============================================================================
 * NHẬP CSV HÀNG LOẠT + GÁN BỘ PHẬN HÀNG LOẠT (Memo & SOP)
 * ==========================================================================*/
/* visible_to trong CSV: mã đơn vị (investor;hotel;office...) HOẶC tên tiếng Việt,
   ngăn cách ; hoặc | — so khớp không dấu */
function unitIdsFromCsv(v) {
  const byCode = Object.fromEntries(S.orgUnits.map(o => [o.code.toLowerCase(), o.id]));
  const byName = Object.fromEntries(S.orgUnits.map(o => [deaccent(o.name_vi), o.id]));
  return [...new Set((v || '').split(/[;|]/).map(x => x.trim()).filter(Boolean)
    .map(x => byCode[x.toLowerCase()] ?? byName[deaccent(x)]).filter(Boolean))];
}
function catIdFromCsv(v) {
  if (!v) return null;
  const c = S.categories.find(c => String(c.id) === v || deaccent(c.name_vi) === deaccent(v) || (c.name_en || '').toLowerCase() === v.toLowerCase());
  return c ? c.id : null;
}
const MEMO_CSV_COLS = ['memo_code', 'title_vi', 'title_en', 'category', 'body_vi', 'body_en', 'effective_date', 'visible_to', 'to_line', 'from_line', 'signer_name', 'signer_title', 'status'];
const SOP_CSV_COLS = ['code', 'title_vi', 'title_en', 'category', 'dept_name', 'objective', 'performers', 'beneficiaries', 'steps', 'lean_note', 'body_vi', 'body_en', 'visible_to', 'status'];
function csvRowToMemo(r) {
  return {
    memo_code: r.memo_code || null, title_vi: r.title_vi, title_en: r.title_en || null,
    category_id: catIdFromCsv(r.category), body_vi: r.body_vi || null, body_en: r.body_en || null,
    effective_date: r.effective_date || null, visible_to: unitIdsFromCsv(r.visible_to),
    to_line: r.to_line || null, from_line: r.from_line || null,
    signer_name: r.signer_name || null, signer_title: r.signer_title || null,
    status: ['draft', 'published'].includes(r.status) ? r.status : 'published',
    author_id: S.user.id
  };
}
function csvRowToSop(r) {
  return {
    code: r.code || null, title_vi: r.title_vi, title_en: r.title_en || null,
    category_id: catIdFromCsv(r.category), dept_name: r.dept_name || null,
    objective: r.objective || null, performers: r.performers || null, beneficiaries: r.beneficiaries || null,
    steps: (r.steps || '').split(/\s*\|\s*/).filter(Boolean).join('\n') || null,
    lean_note: r.lean_note || null, body_vi: r.body_vi || null, body_en: r.body_en || null,
    visible_to: unitIdsFromCsv(r.visible_to),
    status: ['draft', 'published'].includes(r.status) ? r.status : 'published',
    author_id: S.user.id
  };
}
/* Insert 1 lô, bỏ qua mã đã tồn tại (memo_code/code); nếu DB thiếu cột mới thì
   tự bỏ các cột đó và chèn tiếp (giống saveRowTolerant). */
async function bulkInsertDocs(table, keyCol, rows, extraCols) {
  rows = rows.filter(r => r.title_vi);
  if (!rows.length) return { inserted: 0, skipped: 0 };
  const keys = rows.map(r => r[keyCol]).filter(Boolean);
  let existSet = new Set();
  if (keys.length) {
    const { data } = await sb.from(table).select(keyCol).in(keyCol, keys);
    existSet = new Set((data || []).map(x => x[keyCol]));
  }
  let toInsert = rows.filter(r => !r[keyCol] || !existSet.has(r[keyCol]));
  const skipped = rows.length - toInsert.length;
  if (table === 'memos') { /* memo thiếu mã → tự đánh số tiếp theo năm hiện tại */
    const year = new Date().getFullYear();
    const { count } = await sb.from('memos').select('*', { count: 'exact', head: true }).like('memo_code', `MEMO-${year}-%`);
    let n = (count || 0);
    toInsert.forEach(r => { if (!r.memo_code) r.memo_code = `MEMO-${year}-${String(++n).padStart(3, '0')}`; });
  }
  if (!toInsert.length) return { inserted: 0, skipped };
  let { error } = await sb.from(table).insert(toInsert);
  if (error && /column|schema cache/i.test(error.message || '')) {
    toInsert = toInsert.map(r => { const s = { ...r }; extraCols.forEach(c => delete s[c]); return s; });
    ({ error } = await sb.from(table).insert(toInsert));
    if (!error) toast(t('print_cols_missing'), false);
  }
  if (error) return { inserted: 0, skipped, error };
  return { inserted: toInsert.length, skipped };
}
function openBulkImport(kind) {
  const isMemo = kind === 'memos';
  const cols = isMemo ? MEMO_CSV_COLS : SOP_CSV_COLS;
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-navy mb-3">${esc(t(isMemo ? 'memo_import_title' : 'sop_import_title'))}</h2>
    <p class="text-xs text-slate-500 mb-2">${esc(t('bulk_import_hint'))}</p>
    <div class="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2 mb-3 break-words"><b>${esc(t('bulk_cols'))}:</b> ${cols.join(', ')}</div>
    <button class="btn btn-outline btn-sm mb-3" data-sample>⬇ ${esc(t('csv_sample'))}</button>
    <input type="file" id="bulk-csv" accept=".csv">
    <div class="flex justify-end gap-2 mt-4"><button class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button></div></div>`);
  root.querySelector('[data-cancel]').addEventListener('click', closeModal);
  root.querySelector('[data-sample]').addEventListener('click', () => {
    const unitCodes = S.orgUnits.map(o => o.code).join(';');
    const sample = isMemo
      ? { memo_code: 'MEMO-2026-001', title_vi: 'Tiêu đề tiếng Việt', title_en: 'English title', category: '', body_vi: 'Đoạn 1\nĐoạn 2', body_en: 'Para 1\nPara 2', effective_date: '2026-01-15', visible_to: 'hotel;office', to_line: 'Mr. A – Chức danh/ Title', from_line: 'Ms. B – Chức danh/ Title', signer_name: 'NGUYỄN VĂN A', signer_title: 'Tổng Giám đốc/ General Manager', status: 'published' }
      : { code: 'LA-SOP-001', title_vi: 'Xử lý đơn nghỉ phép', title_en: 'Process leave requests', category: '', dept_name: 'Phòng Pháp chế – Hành chính', objective: 'Bảo đảm ...', performers: 'Chức danh A (chính); Chức danh B (hỗ trợ)', beneficiaries: 'Toàn thể nhân viên', steps: 'Bước 1 – Tiếp nhận ... | Bước 2 – Kiểm tra ... | Bước 3 – Trình duyệt', lean_note: '', body_vi: '', body_en: '', visible_to: unitCodes, status: 'published' };
    downloadCsv(isMemo ? 'memo_mau.csv' : 'sop_mau.csv', [sample]);
  });
  root.querySelector('#bulk-csv').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const raw = parseCsv(await f.text());
    const rows = raw.map(isMemo ? csvRowToMemo : csvRowToSop);
    const extra = isMemo ? ['to_line', 'from_line', 'signer_name', 'signer_title']
      : ['dept_name', 'objective', 'performers', 'beneficiaries', 'steps', 'lean_note'];
    const { inserted, skipped, error } = await bulkInsertDocs(isMemo ? 'memos' : 'sops', isMemo ? 'memo_code' : 'code', rows, extra);
    if (error) { toast(error.message, false); return; }
    await audit(kind, '', 'csv_import', `inserted=${inserted} skipped=${skipped}`);
    toast(tf('import_result', { inserted, skipped })); closeModal();
    isMemo ? pageMemos() : pageSops(); renderSidebar();
  });
}
/* Gán bộ phận (visible_to) hàng loạt cho Memo/SOP: chọn nhiều mục + chọn đơn vị */
async function openBulkAssign(kind) {
  const isMemo = kind === 'memos';
  const { data, error } = await sb.from(kind).select(isMemo ? 'id, memo_code, title_vi, visible_to' : 'id, code, title_vi, visible_to').order('updated_at', { ascending: false });
  if (error) { toast(error.message, false); return; }
  const rows = data || [];
  const rowHtml = r => `<label class="flex items-start gap-2 text-xs py-1 border-b border-slate-100" data-row>
      <input type="checkbox" class="!w-auto mt-0.5" data-bid="${r.id}">
      <b class="whitespace-nowrap">${esc(isMemo ? r.memo_code : (r.code || '—'))}</b>
      <span class="flex-1 min-w-0 break-words">${esc(r.title_vi)}</span>
      <span class="whitespace-nowrap text-slate-400">${(r.visible_to || []).map(orgName).map(esc).join(', ') || esc(t('all_departments'))}</span></label>`;
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-navy mb-3">${esc(t('bulk_assign_title'))} — ${esc(t(isMemo ? 'nav_memos' : 'nav_sops'))}</h2>
    <input type="text" id="ba-search" placeholder="${esc(t('search_in_table'))}" class="mb-2">
    <label class="flex items-center gap-2 text-xs font-semibold mb-1"><input type="checkbox" id="ba-all" class="!w-auto">${esc(t('bulk_select_filtered'))}</label>
    <div id="ba-list" class="border border-slate-200 rounded-md p-2 max-h-64 overflow-y-auto mb-3">${rows.map(rowHtml).join('')}</div>
    <div class="text-xs font-semibold mb-1">${esc(t('bulk_pick_units'))}</div>
    ${checkboxList('ba_units', S.orgUnits.map(o => ({ v: String(o.id), l: orgName(o.id) })), [])}
    <div class="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2 bg-slate-50 mt-2">
      <label class="flex items-center gap-2"><input type="radio" name="ba-mode" value="replace" checked class="!w-auto"><b>${esc(t('bulk_mode_replace'))}</b></label>
      <label class="flex items-center gap-2"><input type="radio" name="ba-mode" value="add" class="!w-auto"><b>${esc(t('bulk_mode_add'))}</b></label>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button>
      <button class="btn btn-primary" data-apply>${esc(t('bulk_apply'))}</button></div></div>`, true);
  root.querySelector('[data-cancel]').addEventListener('click', closeModal);
  root.querySelector('#ba-search').addEventListener('input', e => {
    const q = deaccent(e.target.value.trim());
    root.querySelectorAll('[data-row]').forEach(el => { el.style.display = !q || deaccent(el.textContent).includes(q) ? '' : 'none'; });
  });
  root.querySelector('#ba-all').addEventListener('change', e => {
    root.querySelectorAll('[data-row]').forEach(el => {
      if (el.style.display !== 'none') el.querySelector('[data-bid]').checked = e.target.checked;
    });
  });
  root.querySelector('[data-apply]').addEventListener('click', async () => {
    const ids = [...root.querySelectorAll('[data-bid]:checked')].map(x => x.dataset.bid);
    const unitIds = readChecks(root, 'ba_units').map(Number);
    const mode = root.querySelector('input[name="ba-mode"]:checked').value;
    if (!ids.length) { toast(t('bulk_none_selected'), false); return; }
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    let ok = 0, firstErr = null;
    for (const id of ids) {
      const cur = byId[id]?.visible_to || [];
      const next = mode === 'add' ? [...new Set([...cur, ...unitIds])] : unitIds;
      const { error: e2 } = await sb.from(kind).update({ visible_to: next }).eq('id', id);
      if (e2) { firstErr = firstErr || e2; continue; }
      ok++;
    }
    await audit(kind, '', 'bulk_assign_units', `mode=${mode} updated=${ok}/${ids.length}`);
    if (firstErr) toast(`${tf('bulk_done', { n: ok })} — ${firstErr.message}`, false);
    else toast(tf('bulk_done', { n: ok }));
    closeModal();
    isMemo ? pageMemos() : pageSops(); renderSidebar();
  });
}
/* Xóa 1/nhiều VBPL, Memo, SOP — CHỈ admin (RLS cũng chặn ở tầng DB) */
async function openBulkDelete(kind) {
  const CFG = {
    legal_docs: { code: 'doc_no', refresh: () => route() },
    memos: { code: 'memo_code', refresh: () => pageMemos() },
    sops: { code: 'code', refresh: () => pageSops() }
  }[kind];
  const { data, error } = await sb.from(kind).select(`id, ${CFG.code}, title_vi`).order(CFG.code === 'doc_no' ? 'doc_no' : 'updated_at', { ascending: CFG.code === 'doc_no' });
  if (error) { toast(error.message, false); return; }
  const rows = data || [];
  const rowHtml = r => `<label class="flex items-start gap-2 text-xs py-1 border-b border-slate-100" data-row>
      <input type="checkbox" class="!w-auto mt-0.5" data-did="${r.id}">
      <b class="whitespace-nowrap">${esc(r[CFG.code] || '—')}</b>
      <span class="flex-1 min-w-0 break-words">${esc(r.title_vi)}</span></label>`;
  const root = openModal(`<div class="p-6">
    <h2 class="text-lg font-bold text-red-700 mb-2">${esc(t('bulk_delete_title'))}</h2>
    <p class="text-xs text-red-600 mb-3">${esc(t('bulk_delete_warn'))}</p>
    <input type="text" id="bd-search" placeholder="${esc(t('search_in_table'))}" class="mb-2">
    <label class="flex items-center gap-2 text-xs font-semibold mb-1"><input type="checkbox" id="bd-all" class="!w-auto">${esc(t('bulk_select_filtered'))}</label>
    <div id="bd-list" class="border border-slate-200 rounded-md p-2 max-h-72 overflow-y-auto mb-3">${rows.map(rowHtml).join('')}</div>
    <div class="flex justify-end gap-2">
      <button class="btn btn-outline" data-cancel>${esc(t('btn_cancel'))}</button>
      <button class="btn btn-danger" data-del>${esc(t('btn_delete'))}</button></div></div>`, true);
  root.querySelector('[data-cancel]').addEventListener('click', closeModal);
  root.querySelector('#bd-search').addEventListener('input', e => {
    const q = deaccent(e.target.value.trim());
    root.querySelectorAll('[data-row]').forEach(el => { el.style.display = !q || deaccent(el.textContent).includes(q) ? '' : 'none'; });
  });
  root.querySelector('#bd-all').addEventListener('change', e => {
    root.querySelectorAll('[data-row]').forEach(el => {
      if (el.style.display !== 'none') el.querySelector('[data-did]').checked = e.target.checked;
    });
  });
  root.querySelector('[data-del]').addEventListener('click', async () => {
    const ids = [...root.querySelectorAll('[data-did]:checked')].map(x => x.dataset.did);
    if (!ids.length) { toast(t('bulk_none_selected'), false); return; }
    if (!confirm(tf('bulk_delete_confirm', { n: ids.length }))) return;
    /* thử xóa cả lô; nếu vướng khóa ngoại (memo có phiên bản con, VBPL đang được
       hàng đợi tham chiếu...) thì xóa từng dòng để dòng lỗi không chặn dòng khác */
    let ok = 0, fail = 0, firstErr = null;
    const { error: batchErr } = await sb.from(kind).delete().in('id', ids);
    if (!batchErr) ok = ids.length;
    else {
      for (const id of ids) {
        const { error: e1 } = await sb.from(kind).delete().eq('id', id);
        if (e1) { fail++; firstErr = firstErr || e1; } else ok++;
      }
    }
    await audit(kind, '', 'bulk_delete', `deleted=${ok} failed=${fail}`);
    if (fail) toast(tf('bulk_delete_result', { ok, fail }) + (firstErr ? ` — ${firstErr.message}` : ''), false);
    else toast(tf('bulk_done', { n: ok }));
    closeModal(); CFG.refresh();
  });
}

/* ============================================================================
 * QUẢN TRỊ — Người dùng & Đơn vị
 * ==========================================================================*/
async function pageUsers() {
  const { data: profs } = await sb.from('profiles').select('*').order('email');
  let html = pageTitle(t('admin_users'));
  html += `<p class="text-xs text-slate-500 mb-3">${esc(t('admin_add_user_hint'))}</p>
    <div class="bg-white rounded-lg shadow-sm p-4 mb-6 overflow-x-auto"><table class="data"><thead><tr>
      <th>Email</th><th>${esc(t('col_author'))}</th><th>${esc(t('admin_org_units'))}</th><th>Admin</th><th>Active</th><th></th></tr></thead><tbody>`;
  for (const p of profs || []) {
    html += `<tr data-uid="${p.id}">
      <td>${esc(p.email)}</td>
      <td><input type="text" data-fn value="${esc(p.full_name || '')}"></td>
      <td><select data-org><option value="">—</option>${S.orgUnits.map(o => `<option value="${o.id}" ${p.org_unit_id === o.id ? 'selected' : ''}>${esc(orgName(o.id))}</option>`).join('')}</select></td>
      <td class="text-center"><input type="checkbox" data-adm ${p.is_admin ? 'checked' : ''}></td>
      <td class="text-center"><input type="checkbox" data-act ${p.active ? 'checked' : ''}></td>
      <td><button class="btn btn-primary btn-sm" data-saveu>${esc(t('btn_save'))}</button></td></tr>`;
  }
  html += `</tbody></table></div>
    <h2 class="font-bold text-navy mb-2">${esc(t('admin_org_units'))}</h2>
    <div class="bg-white rounded-lg shadow-sm p-4 overflow-x-auto"><table class="data"><thead><tr>
      <th>Code</th><th>VI</th><th>EN</th><th>Active</th><th></th></tr></thead><tbody>`;
  for (const o of S.orgUnits) {
    html += `<tr data-oid="${o.id}"><td>${esc(o.code)}</td>
      <td><input data-nvi value="${esc(o.name_vi)}"></td><td><input data-nen value="${esc(o.name_en)}"></td>
      <td class="text-center"><input type="checkbox" data-oact ${o.active ? 'checked' : ''}></td>
      <td><button class="btn btn-primary btn-sm" data-saveo>${esc(t('btn_save'))}</button></td></tr>`;
  }
  html += `</tbody></table>
    <div class="flex gap-2 mt-3"><input id="new-ou-code" placeholder="code" class="!w-28"><input id="new-ou-vi" placeholder="Tên VI" class="!w-48"><input id="new-ou-en" placeholder="Name EN" class="!w-48">
    <button class="btn btn-outline btn-sm" id="add-ou">${esc(t('btn_add'))}</button></div></div>`;
  $('#page').innerHTML = html;

  document.querySelectorAll('[data-saveu]').forEach(btn => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr');
    const { error } = await sb.from('profiles').update({
      full_name: tr.querySelector('[data-fn]').value,
      org_unit_id: tr.querySelector('[data-org]').value ? Number(tr.querySelector('[data-org]').value) : null,
      is_admin: tr.querySelector('[data-adm]').checked,
      active: tr.querySelector('[data-act]').checked
    }).eq('id', tr.dataset.uid);
    error ? toast(error.message, false) : toast(t('saved'));
  }));
  document.querySelectorAll('[data-saveo]').forEach(btn => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr');
    const { error } = await sb.from('org_units').update({
      name_vi: tr.querySelector('[data-nvi]').value, name_en: tr.querySelector('[data-nen]').value,
      active: tr.querySelector('[data-oact]').checked
    }).eq('id', Number(tr.dataset.oid));
    error ? toast(error.message, false) : toast(t('saved'));
  }));
  $('#add-ou').addEventListener('click', async () => {
    const code = $('#new-ou-code').value.trim(); if (!code) return;
    const { error } = await sb.from('org_units').insert({ code, name_vi: $('#new-ou-vi').value, name_en: $('#new-ou-en').value });
    if (error) { toast(error.message, false); return; }
    await loadRefData(); pageUsers();
  });
}

/* ============================================================================
 * QUẢN TRỊ — Sơ đồ tổ chức hệ thống (chỉ Admin)
 * Cây: Công ty → các đơn vị (org_units) → người dùng; kèm tóm tắt quyền của
 * từng đơn vị lấy trực tiếp từ role_matrix (luôn khớp thực tế, không vẽ tay).
 * ==========================================================================*/
async function pageOrgChart() {
  const { data: profs } = await sb.from('profiles').select('*').order('full_name');
  const users = profs || Object.values(S.profilesById);
  const permsOfUnit = ouId => {
    const out = { legal: [], memo: [], sop: [] };
    for (const r of S.roleMatrix) {
      if (r.allowed && r.org_unit_id === ouId && r.permissions?.code) out[r.module]?.push(t('perm_' + r.permissions.code) || r.permissions.code);
    }
    return out;
  };
  const userLine = p => `<div class="flex items-center gap-1.5 text-xs py-0.5 ${p.active === false ? 'opacity-40 line-through' : ''}">
    <span class="w-1.5 h-1.5 rounded-full bg-gold inline-block"></span>
    <span class="min-w-0 break-words">${esc(p.full_name || p.email)}</span>
    ${p.is_admin ? '<span class="badge bg-gold/20 text-yellow-800">Admin</span>' : ''}</div>`;
  const sopConfigured = S.roleMatrix.some(r => r.module === 'sop');
  const unitCard = (ou, tag = '') => {
    const members = users.filter(u => u.org_unit_id === ou.id);
    const pm = permsOfUnit(ou.id);
    return `<div class="org-node bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden w-56 text-left">
      <div class="bg-navy text-white px-3 py-2">
        <div class="font-bold text-sm flex items-center gap-2">${esc(orgName(ou.id))}${tag}</div>
        <div class="text-[10px] text-white/60 uppercase tracking-wider">${esc(ou.code)} · ${esc(ou.name_en || '')}</div></div>
      <div class="p-3">
        ${members.length ? members.map(userLine).join('') : `<div class="text-xs text-slate-400">${esc(t('org_no_users'))}</div>`}
        <div class="mt-2 pt-2 border-t border-slate-100 space-y-1">
          <div class="text-[10px] text-slate-500"><b>${esc(t('admin_module_legal'))}:</b> ${pm.legal.map(esc).join(', ') || '—'}</div>
          <div class="text-[10px] text-slate-500"><b>${esc(t('admin_module_memo'))}:</b> ${pm.memo.map(esc).join(', ') || '—'}</div>
          ${sopConfigured ? `<div class="text-[10px] text-slate-500"><b>${esc(t('admin_module_sop'))}:</b> ${pm.sop.map(esc).join(', ') || '—'}</div>` : ''}
        </div></div></div>`;
  };
  const admins = users.filter(u => u.is_admin);
  const orphans = users.filter(u => !u.org_unit_id && !u.is_admin);
  /* Quản trị hệ thống = CHÚ THÍCH trên cùng (không phải 1 cấp trong cây —
     không ai đứng trên Chủ đầu tư), chỉ cho biết tài khoản nào đang giữ admin */
  const adminNote = `<div class="flex items-center gap-2 flex-wrap bg-white border border-gold/60 rounded-lg px-3 py-2 mb-4 text-xs">
    <span class="font-bold text-navy">⭐ ${esc(t('org_admins'))}:</span>
    ${admins.map(p => `<span class="chip">${esc(p.full_name || p.email)}</span>`).join('') || '—'}
    <span class="text-slate-400">${esc(t('org_admin_note'))}</span></div>`;
  const orphanBox = orphans.length ? `<div class="mt-6 w-full bg-amber-50 border border-amber-200 rounded-lg p-3">
      <div class="text-xs font-bold text-amber-800 mb-1">${esc(t('org_unassigned'))}</div>
      ${orphans.map(userLine).join('')}</div>` : '';

  /* Cây phân cấp cố định theo yêu cầu BGĐ:
     Chủ đầu tư (Owner, trên cùng) → (Pháp chế bám giữa đoạn nối) → Khách sạn + Văn phòng cho thuê;
     các bộ phận còn lại (Nhân sự, F&B, ...) nằm dưới Khách sạn; CÔNG ĐOÀN đứng ĐỘC LẬP bên cạnh. */
  const byCode = Object.fromEntries(S.orgUnits.map(o => [o.code.toLowerCase(), o]));
  const investor = byCode['investor'], hotel = byCode['hotel'], office = byCode['office'],
    legal = byCode['legal'], union = byCode['union'];
  /* Đơn vị "quản trị hệ thống" KHÔNG hiện thành thẻ trong sơ đồ — admin chỉ là
     chú thích ở trên, không phải một cấp tổ chức */
  const HIDDEN_CODES = ['sys_admin', 'sysadmin', 'admin', 'system'];
  const active = S.orgUnits.filter(o => o.active !== false && !HIDDEN_CODES.includes((o.code || '').toLowerCase()));
  const others = active.filter(o => ![investor?.id, hotel?.id, office?.id, legal?.id, union?.id].includes(o.id));
  const ownerTag = `<span class="badge bg-gold/30 text-yellow-100 border border-gold/60">Owner</span>`;
  const unionBlock = union ? `<div class="flex flex-col items-center border-2 border-dashed border-slate-300 rounded-xl p-3 mt-1">
      <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">${esc(t('org_independent'))}</div>
      ${unitCard(union)}</div>` : '';

  let html = pageTitle(t('nav_orgchart'));
  html += `<p class="text-xs text-slate-500 mb-4">${esc(t('org_intro'))}</p>`;
  html += adminNote;
  if (investor && hotel && office) {
    html += `<div class="overflow-x-auto pb-4"><div class="flex items-start justify-center gap-10 min-w-fit">
      <div class="flex flex-col items-center">
        ${unitCard(investor, ownerTag)}
        <div class="w-px h-5 bg-slate-300"></div>
        ${legal ? `<div class="grid w-full items-center" style="grid-template-columns:1fr auto 1fr">
          <div></div>
          <div class="w-px bg-slate-300 self-stretch"></div>
          <div class="flex items-center"><div class="w-10 h-px bg-slate-300"></div>${unitCard(legal)}</div>
        </div>` : ''}
        <div class="w-px h-4 bg-slate-300"></div>
        <ul class="otree">
          <li>${unitCard(hotel)}
            ${others.length ? `<ul>${others.map(o => `<li>${unitCard(o)}</li>`).join('')}</ul>` : ''}
          </li>
          <li>${unitCard(office)}</li>
        </ul>
      </div>
      ${unionBlock}
    </div>${orphanBox}</div>`;
  } else {
    /* fallback khi đơn vị đổi code khác chuẩn: hiện dạng lưới phẳng */
    html += `<div class="grid gap-4 mt-4 w-full" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">
      ${active.map(o => unitCard(o)).join('')}</div>${orphanBox}`;
  }
  $('#page').innerHTML = html;
}

/* ============================================================================
 * QUẢN TRỊ — Ma trận phân quyền
 * ==========================================================================*/
async function pageRoles() {
  const { data: rm } = await sb.from('role_matrix').select('*, permissions(code)');
  const perms = S.allPermissions;
  const get = (ouId, permId, mod) => rm.find(r => r.org_unit_id === ouId && r.permission_id === permId && r.module === mod);
  let html = pageTitle(t('nav_roles'));
  html += `<p class="text-xs text-slate-500 mb-4">${esc(t('admin_roles_title'))}</p>`;
  /* Phân hệ SOP chỉ hiện khi DB đã chạy add-sop-module (step1+step2) — nếu chưa,
     lưu ma trận có cột sop sẽ lỗi enum nên ẩn đi + nhắc chạy SQL */
  const sopConfigured = rm.some(r => r.module === 'sop');
  if (!sopConfigured) html += `<div class="mb-3 bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2 text-xs">${esc(t('sop_module_missing'))}</div>`;
  const MODULE_LABELS = { legal: 'admin_module_legal', memo: 'admin_module_memo', sop: 'admin_module_sop' };
  for (const mod of (sopConfigured ? ['legal', 'memo', 'sop'] : ['legal', 'memo'])) {
    html += `<h2 class="font-bold text-navy mb-2 mt-4">${esc(t(MODULE_LABELS[mod]))}</h2>
      <div class="bg-white rounded-lg shadow-sm p-4 overflow-x-auto mb-2"><table class="data"><thead><tr><th></th>` +
      perms.map(p => `<th class="text-center">${esc(t('perm_' + p.code) || p.code)}</th>`).join('') + '</tr></thead><tbody>';
    for (const ou of S.orgUnits) {
      html += `<tr><td class="font-semibold">${esc(orgName(ou.id))}</td>` + perms.map(p => {
        const cell = get(ou.id, p.id, mod);
        return `<td class="text-center"><input type="checkbox" data-rm data-ou="${ou.id}" data-p="${p.id}" data-mod="${mod}" ${cell?.allowed ? 'checked' : ''}></td>`;
      }).join('') + '</tr>';
    }
    html += '</tbody></table></div>';
  }
  html += `<button class="btn btn-primary mt-3" id="save-rm">${esc(t('btn_save'))}</button>`;
  $('#page').innerHTML = html;
  $('#save-rm').addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('[data-rm]')].map(cb => ({
      org_unit_id: Number(cb.dataset.ou), permission_id: Number(cb.dataset.p),
      module: cb.dataset.mod, allowed: cb.checked
    }));
    const { error } = await sb.from('role_matrix').upsert(rows, { onConflict: 'org_unit_id,permission_id,module' });
    if (error) { toast(error.message, false); return; }
    await audit('role_matrix', '', 'update_matrix');
    await loadRefData(); await renderSidebar();
    toast(t('saved'));
  });
}

/* ============================================================================
 * QUẢN TRỊ — Nguồn & Hàng đợi
 * ==========================================================================*/
async function pageSources(tab = 'queue') {
  let html = pageTitle(t('nav_sources'));
  const tabs = [['queue', t('tab_queue')], ['sources', t('tab_sources')], ['watchlist', t('tab_watchlist')]];
  html += `<div class="flex gap-2 mb-4">` + tabs.map(([k, l]) =>
    `<button class="btn btn-sm ${k === tab ? 'btn-primary' : 'btn-outline'}" data-stab="${k}">${esc(l)}</button>`).join('') + '</div><div id="src-body"></div>';
  $('#page').innerHTML = html;
  document.querySelectorAll('[data-stab]').forEach(b => b.addEventListener('click', () => pageSources(b.dataset.stab)));
  const body = $('#src-body');
  if (tab === 'queue') await renderQueue(body);
  else if (tab === 'sources') await renderSources(body);
  else await renderWatchlist(body);
}

async function acceptQueueItem(item) {
  const doc = { ...(item.proposed || {}) };
  doc.created_by = S.user.id;
  doc.last_verified_at = new Date().toISOString();
  const { error } = await sb.from('legal_docs').upsert(doc, { onConflict: 'doc_no' });
  if (error) return { ok: false, error };
  await sb.from('ingest_queue').update({ review_status: 'accepted', reviewed_by: S.user.id, reviewed_at: new Date().toISOString() }).eq('id', item.id);
  await audit('ingest_queue', item.id, 'accept', doc.doc_no);
  return { ok: true };
}

async function bulkApprove(items, confirmMsg) {
  if (!items.length) { toast(t('queue_bulk_none_selected'), false); return; }
  if (!confirm(confirmMsg)) return;
  let done = 0, err = 0;
  for (const item of items) {
    const r = await acceptQueueItem(item);
    if (!r.ok) err++;
    done++;
  }
  toast(tf('queue_bulk_done', { n: done, err }), err === 0);
  pageSources('queue');
}

async function renderAutoApproveSettings(body) {
  // Bảng app_settings có thể chưa được tạo (schema bổ sung) — bỏ qua panel này
  // thay vì lỗi, để không chặn cả trang Hàng đợi duyệt.
  const { data, error } = await sb.from('app_settings').select('value').eq('key', 'auto_approve_days').maybeSingle();
  if (error) { console.warn('app_settings chưa sẵn sàng:', error.message); return; }
  const days = data?.value?.days ?? null;
  const canEdit = S.profile.is_admin;
  const box = document.createElement('div');
  box.className = 'bg-white rounded-lg shadow-sm p-4 mb-4';
  box.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <div class="font-semibold text-navy text-sm">${esc(t('auto_approve_title'))}</div>
        <div class="text-xs text-slate-500">${esc(t('auto_approve_hint'))}</div>
      </div>
      ${canEdit
        ? `<div class="flex items-center gap-2">
             <label class="text-xs font-semibold">${esc(t('auto_approve_days_label'))}</label>
             <input type="number" id="aa-days" min="0" value="${days ?? 0}" class="!w-20">
             <button class="btn btn-primary btn-sm" id="aa-save">${esc(t('btn_save'))}</button>
           </div>`
        : `<span class="badge ${days ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}">
             ${days ? esc(tf('auto_approve_on', { n: days })) : esc(t('auto_approve_off'))}
           </span>`}
    </div>
    ${!canEdit ? `<div class="text-[11px] text-slate-400 mt-1">${esc(t('auto_approve_readonly_hint'))}</div>` : ''}`;
  body.appendChild(box);
  box.querySelector('#aa-save')?.addEventListener('click', async () => {
    const n = Math.max(0, Number(box.querySelector('#aa-days').value) || 0);
    const { error } = await sb.from('app_settings').upsert({ key: 'auto_approve_days', value: { days: n || null } });
    if (error) { toast(error.message, false); return; }
    await audit('system', 'auto_approve_days', 'update_setting', String(n));
    toast(t('saved'));
  });
}

async function renderQueue(body) {
  await renderAutoApproveSettings(body);

  const { data: items } = await sb.from('ingest_queue').select('*, sources(name)')
    .eq('review_status', 'pending').order('relevance_score', { ascending: false });
  if (!items?.length) {
    const empty = document.createElement('div');
    empty.className = 'bg-white rounded-lg shadow-sm p-8 text-center text-slate-400';
    empty.textContent = t('queue_empty');
    body.appendChild(empty);
    return;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'flex items-center gap-3 flex-wrap mb-3 bg-white rounded-lg shadow-sm p-3';
  toolbar.innerHTML = `
    <label class="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" id="qsel-all">${esc(t('queue_select_all'))}</label>
    <span id="qsel-count" class="text-xs text-slate-500">${esc(tf('queue_selected_count', { n: 0 }))}</span>
    <span class="flex-1"></span>
    <button class="btn btn-outline btn-sm" id="qbulk-selected">${esc(t('queue_approve_selected'))}</button>
    <button class="btn btn-primary btn-sm" id="qbulk-all">${esc(t('queue_approve_all'))} (${items.length})</button>`;
  body.appendChild(toolbar);

  const list = document.createElement('div');
  list.className = 'space-y-3';
  let html = '';
  for (const it of items) {
    const p = it.proposed || {};
    html += `<div class="bg-white rounded-lg shadow-sm p-4" data-qid="${it.id}">
      <div class="flex items-center gap-2 flex-wrap">
        <input type="checkbox" class="qsel !w-auto" data-cid="${it.id}">
        <span class="badge ${it.kind === 'new_doc' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}">${esc(it.kind)}</span>
        <b class="text-navy shrink-0">${esc(p.doc_no || '?')}</b><span class="flex-1 min-w-0 text-sm break-words">${esc(p.title_vi || '')}</span>
        <span class="text-xs text-slate-500">${esc(it.sources?.name || '')}</span>
        <span class="badge bg-gold/20 text-yellow-800">${esc(t('queue_score'))}: ${it.relevance_score}</span></div>
      <div class="mt-1 text-xs text-slate-500">${esc(t('queue_matched'))}: ${(it.matched_keywords || []).map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>`;
    if (it.kind === 'status_change' && it.existing_doc_id) {
      const old = LEGAL_CACHE.find(d => d.id === it.existing_doc_id) || (await sb.from('legal_docs').select('*').eq('id', it.existing_doc_id).single()).data;
      html += `<div class="mt-2 text-xs bg-slate-50 rounded p-2"><b>${esc(t('queue_diff'))}:</b> `;
      for (const k of ['status', 'expiry_date', 'replaced_by']) {
        const ov = Array.isArray(old?.[k]) ? old[k].join(';') : old?.[k];
        const nv = Array.isArray(p[k]) ? p[k].join(';') : p[k];
        if (String(ov ?? '') !== String(nv ?? '') && nv != null)
          html += `<span class="mr-3">${esc(k)}: <span class="text-red-600 line-through">${esc(ov ?? '—')}</span> → <span class="text-green-700 font-bold">${esc(nv)}</span></span>`;
      }
      html += '</div>';
    }
    html += `<div class="flex gap-2 mt-3">
      ${p.source_url ? `<a class="btn btn-outline btn-sm" target="_blank" href="${esc(p.source_url)}">↗ source</a>` : ''}
      <button class="btn btn-primary btn-sm" data-accept>${esc(t('queue_accept'))}</button>
      <button class="btn btn-outline btn-sm" data-editacc>${esc(t('queue_edit_accept'))}</button>
      <button class="btn btn-danger btn-sm" data-reject>${esc(t('queue_reject'))}</button></div></div>`;
  }
  list.innerHTML = html;
  body.appendChild(list);

  function updateSelCount() {
    const n = list.querySelectorAll('.qsel:checked').length;
    toolbar.querySelector('#qsel-count').textContent = tf('queue_selected_count', { n });
  }
  toolbar.querySelector('#qsel-all').addEventListener('change', e => {
    list.querySelectorAll('.qsel').forEach(cb => { cb.checked = e.target.checked; });
    updateSelCount();
  });
  list.querySelectorAll('.qsel').forEach(cb => cb.addEventListener('change', updateSelCount));

  toolbar.querySelector('#qbulk-selected').addEventListener('click', () => {
    const ids = [...list.querySelectorAll('.qsel:checked')].map(cb => cb.dataset.cid);
    const selected = items.filter(it => ids.includes(it.id));
    bulkApprove(selected, tf('queue_approve_selected_confirm', { n: selected.length }));
  });
  toolbar.querySelector('#qbulk-all').addEventListener('click', () => {
    bulkApprove(items, tf('queue_approve_all_confirm', { n: items.length }));
  });

  list.querySelectorAll('[data-qid]').forEach(card => {
    const id = card.dataset.qid;
    const item = items.find(x => x.id === id);
    card.querySelector('[data-accept]').addEventListener('click', async () => {
      const r = await acceptQueueItem(item);
      if (!r.ok) { toast(r.error.message, false); return; }
      toast(t('saved')); pageSources('queue');
    });
    card.querySelector('[data-editacc]').addEventListener('click', () => {
      openDocEditor(item.proposed || {}, async () => {
        await sb.from('ingest_queue').update({ review_status: 'accepted', reviewed_by: S.user.id, reviewed_at: new Date().toISOString() }).eq('id', id);
        pageSources('queue');
      });
    });
    card.querySelector('[data-reject]').addEventListener('click', async () => {
      const note = prompt(t('queue_reject_reason')); if (!note) return;
      await sb.from('ingest_queue').update({ review_status: 'rejected', reviewed_by: S.user.id, reviewed_at: new Date().toISOString(), note }).eq('id', id);
      await audit('ingest_queue', id, 'reject', note);
      pageSources('queue');
    });
  });
}

async function renderSources(body) {
  const { data: srcs } = await sb.from('sources').select('*').order('id');
  let html = `<div class="bg-white rounded-lg shadow-sm p-4 mb-4">
    <label class="text-xs font-semibold">${esc(t('anthropic_key_label'))}</label>
    <div class="flex gap-2 mt-1"><input type="password" id="akey" value="${esc(localStorage.getItem(ANTHROPIC_KEY_LS) || '')}" placeholder="sk-ant-...">
    <button class="btn btn-primary btn-sm" id="akey-save">${esc(t('btn_save'))}</button></div></div>`;
  html += `<div class="space-y-3">`;
  for (const s of srcs || []) {
    html += `<div class="bg-white rounded-lg shadow-sm p-4" data-sid="${s.id}">
      <div class="flex items-center gap-3 flex-wrap">
        <label class="flex items-center gap-1 text-sm font-semibold"><input type="checkbox" data-en ${s.enabled ? 'checked' : ''}> ${esc(s.name)}</label>
        <span class="text-xs text-slate-400">${esc(s.code)}</span><span class="flex-1"></span>
        <span class="text-xs">${esc(t('src_last_run'))}: <b>${s.last_run_at ? new Date(s.last_run_at).toLocaleString('vi-VN') : '—'}</b></span>
        <span class="badge ${s.last_status === 'error' ? 'bg-red-100 text-red-700' : s.last_status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-slate-100'}">${esc(s.last_status || '—')}</span>
        ${s.code !== 'manual' ? `<button class="btn btn-outline btn-sm" data-run>${esc(t('btn_run_now'))}</button>` : ''}</div>
      ${s.last_error ? `<div class="text-xs text-red-600 mt-1">${esc(s.last_error)}</div>` : ''}
      <div class="mt-2"><label class="text-[11px] font-semibold text-slate-500">${esc(t('src_config'))}</label>
        <textarea data-cfg rows="2" class="font-mono text-xs">${esc(JSON.stringify(s.auth_config || {}, null, 0))}</textarea></div>
      <button class="btn btn-primary btn-sm mt-2" data-savesrc>${esc(t('btn_save'))}</button></div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  $('#akey-save').addEventListener('click', () => { localStorage.setItem(ANTHROPIC_KEY_LS, $('#akey').value.trim()); toast(t('saved')); });
  body.querySelectorAll('[data-sid]').forEach(card => {
    const id = Number(card.dataset.sid);
    card.querySelector('[data-savesrc]').addEventListener('click', async () => {
      let cfg;
      try { cfg = JSON.parse(card.querySelector('[data-cfg]').value || '{}'); } catch { toast('JSON không hợp lệ', false); return; }
      const { error } = await sb.from('sources').update({ enabled: card.querySelector('[data-en]').checked, auth_config: cfg }).eq('id', id);
      error ? toast(error.message, false) : toast(t('saved'));
    });
    card.querySelector('[data-run]')?.addEventListener('click', async () => {
      try {
        const { error } = await sb.functions.invoke('fn_ingest', { body: { source_id: id } });
        if (error) throw error;
        toast('OK — kiểm tra hàng đợi sau ít phút');
      } catch (e) { toast('Edge Function chưa deploy hoặc lỗi: ' + e.message, false); }
    });
  });
}

async function renderWatchlist(body) {
  const { data: wl } = await sb.from('watchlist').select('*').order('weight', { ascending: false });
  let html = `<div class="bg-white rounded-lg shadow-sm p-4 overflow-x-auto"><table class="data"><thead><tr>
    <th>${esc(t('wl_keyword'))}</th><th>${esc(t('wl_domain'))}</th><th>${esc(t('wl_weight'))}</th><th></th></tr></thead><tbody>`;
  for (const w of wl || []) {
    html += `<tr data-wid="${w.id}">
      <td><input data-kw value="${esc(w.keyword_vi)}"></td>
      <td><select data-dom><option value="">—</option>${DOMAINS.map(d => `<option value="${d}" ${w.domain === d ? 'selected' : ''}>${esc(domainLabel(d))}</option>`).join('')}</select></td>
      <td><input type="number" data-wt value="${w.weight}" class="!w-16"></td>
      <td class="whitespace-nowrap"><button class="btn btn-primary btn-sm" data-savew>${esc(t('btn_save'))}</button>
          <button class="btn btn-danger btn-sm" data-delw>${esc(t('btn_delete'))}</button></td></tr>`;
  }
  html += `</tbody></table>
    <div class="flex gap-2 mt-3"><input id="new-kw" placeholder="${esc(t('wl_keyword'))}" class="!w-56">
    <select id="new-dom" class="!w-44"><option value="">—</option>${DOMAINS.map(d => `<option value="${d}">${esc(domainLabel(d))}</option>`).join('')}</select>
    <input type="number" id="new-wt" value="3" class="!w-16">
    <button class="btn btn-outline btn-sm" id="add-kw">${esc(t('btn_add'))}</button></div></div>`;
  // Thêm hàng loạt: dán nhiều từ khóa (mỗi dòng 1 từ), gán chung 1 lĩnh vực + trọng số
  html += `<div class="bg-white rounded-lg shadow-sm p-4 mt-4">
    <div class="font-semibold text-navy text-sm mb-1">${esc(t('wl_bulk_title'))}</div>
    <div class="text-xs text-slate-500 mb-2">${esc(t('wl_bulk_hint'))}</div>
    <textarea id="bulk-kw" rows="5" placeholder="lưu trú&#10;khách sạn&#10;an toàn thực phẩm"></textarea>
    <div class="flex gap-2 mt-2 items-center">
      <label class="text-xs font-semibold">${esc(t('wl_domain'))}</label>
      <select id="bulk-dom" class="!w-44"><option value="">—</option>${DOMAINS.map(d => `<option value="${d}">${esc(domainLabel(d))}</option>`).join('')}</select>
      <label class="text-xs font-semibold">${esc(t('wl_weight'))}</label>
      <input type="number" id="bulk-wt" value="3" class="!w-16">
      <button class="btn btn-primary btn-sm" id="bulk-add">${esc(t('wl_bulk_add'))}</button>
    </div></div>`;
  body.innerHTML = html;
  body.querySelectorAll('[data-wid]').forEach(tr => {
    const id = Number(tr.dataset.wid);
    tr.querySelector('[data-savew]').addEventListener('click', async () => {
      const { error } = await sb.from('watchlist').update({
        keyword_vi: tr.querySelector('[data-kw]').value, domain: tr.querySelector('[data-dom]').value || null,
        weight: Number(tr.querySelector('[data-wt]').value) || 1
      }).eq('id', id);
      error ? toast(error.message, false) : toast(t('saved'));
    });
    tr.querySelector('[data-delw]').addEventListener('click', async () => {
      if (!confirm(t('confirm_delete'))) return;
      await sb.from('watchlist').delete().eq('id', id);
      pageSources('watchlist');
    });
  });
  $('#add-kw').addEventListener('click', async () => {
    const kw = $('#new-kw').value.trim(); if (!kw) return;
    await sb.from('watchlist').insert({ keyword_vi: kw, domain: $('#new-dom').value || null, weight: Number($('#new-wt').value) || 1 });
    pageSources('watchlist');
  });
  $('#bulk-add').addEventListener('click', async () => {
    const existing = new Set((wl || []).map(w => deaccent(w.keyword_vi)));
    const dom = $('#bulk-dom').value || null;
    const wt = Number($('#bulk-wt').value) || 3;
    const rows = $('#bulk-kw').value.split('\n').map(x => x.trim()).filter(Boolean)
      .filter(kw => !existing.has(deaccent(kw)))   // bỏ từ đã có, tránh trùng
      .map(kw => ({ keyword_vi: kw, domain: dom, weight: wt }));
    if (!rows.length) { toast(t('wl_bulk_none'), false); return; }
    const { error } = await sb.from('watchlist').insert(rows);
    if (error) { toast(error.message, false); return; }
    toast(tf('wl_bulk_done', { n: rows.length }));
    pageSources('watchlist');
  });
}

/* ============================================================================
 * QUẢN TRỊ — Nhật ký & Sao lưu
 * ==========================================================================*/
async function pageAudit() {
  const { data } = await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(500);
  $('#page').innerHTML = pageTitle(t('audit_title')) + '<div id="audit-table"></div>';
  const tbl = makeTable({
    columns: [
      { key: 'at', label: t('audit_time'), type: 'date', val: r => (r.at || '').slice(0, 10), render: r => new Date(r.at).toLocaleString('vi-VN') },
      { key: 'actor_id', label: t('audit_actor'), type: 'text', val: r => userName(r.actor_id), render: r => esc(userName(r.actor_id)) },
      { key: 'entity', label: t('audit_entity'), type: 'multi', options: ['legal_docs', 'memos', 'ingest_queue', 'role_matrix', 'system'].map(x => ({ v: x, l: x })) },
      { key: 'action', label: t('audit_action'), type: 'text' },
      { key: 'note', label: 'Note', type: 'text', render: r => esc([r.old_status && `${r.old_status}→${r.new_status}`, r.note].filter(Boolean).join(' · ')) }
    ],
    rows: data || []
  });
  $('#audit-table').appendChild(tbl);
}

const BACKUP_TABLES = ['org_units', 'permissions', 'role_matrix', 'profiles', 'legal_docs', 'memo_categories', 'memos', 'sops', 'sources', 'watchlist', 'ingest_queue', 'audit_log', 'app_settings'];
async function pageBackup() {
  $('#page').innerHTML = pageTitle(t('backup_title')) + `
    <div class="bg-white rounded-lg shadow-sm p-5 space-y-4 max-w-xl">
      <p class="text-xs text-slate-500">${esc(t('backup_note'))}</p>
      <button class="btn btn-primary" id="bk-json">${esc(t('backup_export_json'))}</button>
      <button class="btn btn-outline" id="bk-csv">${esc(t('backup_export_csv'))}</button>
      <div><label class="text-xs font-semibold">${esc(t('backup_import'))}</label><input type="file" id="bk-import" accept=".json"></div>
    </div>`;
  $('#bk-json').addEventListener('click', async () => {
    const dump = {};
    for (const tbl of BACKUP_TABLES) dump[tbl] = (await sb.from(tbl).select('*')).data || [];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' }));
    a.download = `portal_backup_${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
    await audit('system', '', 'backup_export');
  });
  $('#bk-csv').addEventListener('click', async () => {
    for (const tbl of BACKUP_TABLES) {
      const rows = (await sb.from(tbl).select('*')).data || [];
      if (rows.length) downloadCsv(`${tbl}_${today()}.csv`, rows);
    }
  });
  $('#bk-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const dump = JSON.parse(await f.text());
    for (const tbl of BACKUP_TABLES) {
      if (!dump[tbl]?.length) continue;
      const rows = dump[tbl].map(r => { delete r.search_vector; return r; });
      const { error } = await sb.from(tbl).upsert(rows);
      if (error) { toast(`${tbl}: ${error.message}`, false); return; }
    }
    await audit('system', '', 'backup_restore', f.name);
    toast(t('saved'));
  });
}

/* ------------------------------- start ------------------------------------ */
document.addEventListener('DOMContentLoaded', boot);
