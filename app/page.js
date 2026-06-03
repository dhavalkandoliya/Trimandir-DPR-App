'use client';

import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // -- Inject html2canvas and jsPDF from CDN --
    const s1 = document.createElement('script');
    s1.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
    document.head.appendChild(s1);

    const s2 = document.createElement('script');
    s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    document.head.appendChild(s2);
/* ═══════════════════════════════════════════════════════════
           CONSTANTS & STATE
        ═══════════════════════════════════════════════════════════ */
        const SHEET_URL = "https://script.google.com/macros/s/AKfycbwtlhu-5A49ECkRXijXfG0ZpVhfePHhJ6DV5N_yz2Dk-yBwhzll4N-F-k5kW99DMkqEYg/exec";
        const SUPER_ADMIN = { username: 'TPD-admin', displayName: 'TPD Admin', role: 'admin' };

        let _users      = [SUPER_ADMIN];
        let _projects   = [];   // { id, project_name, parent_id, status } (synced with 5-column nested Projects/Activities database)
        let _activities = [];   // { id, activity_name, parent_id, status } (synced with 5-column nested schema)
        let _history    = [];   // see handleGetDPRs schema below
        let _currentUser    = null;
        let _dashPeriod     = 'week';
        let _editingKey     = null;
        let _rowCounter     = 0;
        // Pagination state � attached to window so dynamic script injection keeps global access
        window._historyPage    = window._historyPage    || 1;
        window._itemsPerPage   = window._itemsPerPage   || 10;
        // convenience aliases for rest of script
        let _historyPage    = window._historyPage;
        const _itemsPerPage = window._itemsPerPage;

        /* ═══════════════════════════════════════════════════════════
           UTILITY: Robust date normaliser — always returns YYYY-MM-DD
        ═══════════════════════════════════════════════════════════ */
        function toYMD(v) {
            if (v === null || v === undefined || v === '') return '';
            if (typeof v === 'number') {
                const d = new Date(Math.round((v - 25569) * 86400 * 1000));
                return d.getUTCFullYear() + '-' +
                       String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
                       String(d.getUTCDate()).padStart(2, '0');
            }
            const s = String(v).trim();
            if (!s || s === 'undefined' || s === 'null') return '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);
            if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(s)) {
                const p = s.split(/[-\/]/);
                return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
            }
            try {
                const dt = new Date(s);
                if (!isNaN(dt.getTime())) {
                    return dt.getFullYear() + '-' +
                           String(dt.getMonth() + 1).padStart(2, '0') + '-' +
                           String(dt.getDate()).padStart(2, '0');
                }
            } catch (e) {}
            return s;
        }

        function formatDate(s) {
            const y = toYMD(s);
            if (!y || y.length < 10) return s || '';
            const [yr, mo, da] = y.split('-');
            return `${da}-${mo}-${yr}`;
        }

        function sameDate(stored, filter) {
            return toYMD(stored) === String(filter || '').trim();
        }

        function esc(s) { return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

        /* ═══════════════════════════════════════════════════════════
           INTERIOR SECTION DETECTION & HELPERS
        ═══════════════════════════════════════════════════════════ */
        function isCivilActivity(a) {
            const main = (a.main_activity || a.activity || '').toLowerCase();
            const sub = (a.sub_activity || '').toLowerCase();
            const checkStr = (main + ' ' + sub).trim();
            
            const civilKws = ['rcc', 'waterproofing', 'marble', 'flooring', 'masonry', 'plaster', 'fabrication', 'steel', 'civil', 'plumbing', 'pipe'];
            const interiorKws = ['furniture', 'carpentry', 'polishing', 'paint', 'ceiling', 'electrical', 'interior'];
            
            if (civilKws.some(kw => checkStr.includes(kw))) {
                return true;
            }
            if (interiorKws.some(kw => checkStr.includes(kw))) {
                return false;
            }
            
            // Standard fallback keywords from old detection
            const otherInteriorKws = ['tile', 'modular', 'hvac', 'ac', 'cctv', 'it work', 'lift', 'epoxy', 'polish'];
            if (otherInteriorKws.some(kw => checkStr.includes(kw))) {
                return false;
            }
            
            return (a.section || 'Civil') !== 'Interior';
        }

        function toTitleCase(str) {
            if (!str) return '';
            let val = str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
            val = val.replace(/\bRcc\b/g, 'RCC')
                     .replace(/\bHvac\b/g, 'HVAC')
                     .replace(/\bCctv\b/g, 'CCTV')
                     .replace(/\bAc\b/g, 'AC')
                     .replace(/\bDpr\b/g, 'DPR');
            return val;
        }

        function detectSection(mainAct, subAct) {
            return isCivilActivity({ main_activity: mainAct, sub_activity: subAct }) ? 'Civil' : 'Interior';
        }

        function getSiteDisplayName(siteName) {
            if (!siteName) return '—';
            const currentProj = _projects.find(p => String(p.project_name).trim().toLowerCase() === String(siteName).trim().toLowerCase());
            if (currentProj && currentProj.parent_id && String(currentProj.parent_id).trim() !== '') {
                const parentProj = _projects.find(p => String(p.id) === String(currentProj.parent_id));
                if (parentProj) {
                    return `${parentProj.project_name} ➔ ${currentProj.project_name}`;
                }
            }
            return siteName;
        }

        /* ═══════════════════════════════════════════════════════════
           API HELPERS
        ═══════════════════════════════════════════════════════════ */
        const fetchWithTimeout = (url, options = {}, timeout = 15000) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            return fetch(url, {
                ...options,
                signal: controller.signal
            }).finally(() => clearTimeout(id));
        };

        const apiFetch = (action) => fetchWithTimeout(`${SHEET_URL}?action=${action}&_t=${Date.now()}`, { 
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        })
        .then(async r => {
            if (!r.ok) {
                const text = await r.text().catch(() => '');
                throw new Error(text || `Status ${r.status}`);
            }
            return r.json();
        });

        const apiPost  = (body)   => fetchWithTimeout(SHEET_URL, {
            method:  'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            },
            body:    JSON.stringify(body)
        }).then(async r => {
            if (!r.ok) {
                const text = await r.text().catch(() => '');
                throw new Error(text || `Status ${r.status}`);
            }
            return r.json();
        });

        /* ═══════════════════════════════════════════════════════════
           TOAST
        ═══════════════════════════════════════════════════════════ */
        function showToast(msg) {
            const t = document.getElementById('toast');
            if (!t) return;
            t.textContent = msg;
            t.classList.add('show');
            clearTimeout(t._tid);
            t._tid = setTimeout(() => t.classList.remove('show'), 2800);
        }

        /* ═══════════════════════════════════════════════════════════
           BOOT — parallel data fetch after login
        ═══════════════════════════════════════════════════════════ */
        async function bootApp() {
            showToast('⏳ Loading data...');
            const apList = document.getElementById('adminProjectList');
            if (apList) apList.innerHTML = getSkeletonLoader();
            const aaList = document.getElementById('adminActivityList');
            if (aaList) aaList.innerHTML = getSkeletonLoader();
            
            try {
                const [users, projects, activities] = await Promise.all([
                    apiFetch('getUsers').catch(() => []),
                    apiFetch('getProjects').catch(() => []),
                    apiFetch('getActivities').catch(() => [])
                ]);
                if (Array.isArray(users))      _users      = [SUPER_ADMIN, ...users];
                if (Array.isArray(projects))   _projects   = projects;
                if (Array.isArray(activities)) _activities = activities;
            } catch (e) { showToast('⚠️ Could not reach server'); }
            renderLoginChips();
            populateSiteDropdown();

            if (localStorage.getItem('dpr_form_draft')) {
                loadFormDraft();
            } else {
                resetForm();
            }
            loadHistory();
        }

        /* ═══════════════════════════════════════════════════════════
           LOGIN / LOGOUT
        ═══════════════════════════════════════════════════════════ */
        function renderLoginChips() {
            const wrap = document.getElementById('userChips');
            if (!wrap) return;
            wrap.innerHTML = '';
            _users.forEach(u => {
                const c = document.createElement('div');
                c.className   = 'user-chip';
                c.textContent = u.username;
                c.onclick     = () => {
                    document.getElementById('loginName').value = u.username;
                    document.getElementById('loginPass').focus();
                };
                wrap.appendChild(c);
            });
        }

        let _loginBusy = false;   // prevents double-tap race on mobile
        async function doLogin() {
            if (_loginBusy) return;   // debounce: ignore repeat taps while authenticating
            const uname = document.getElementById('loginName').value.trim();
            const pass  = document.getElementById('loginPass').value;
            const err   = document.getElementById('loginErr');
            const btn   = document.getElementById('loginSubmitBtn');

            if (!uname || !pass) {
                err.style.color = '#e53e3e';
                err.textContent = '❌ Enter username and password.';
                showToast('❌ Enter username and password.');
                return;
            }

            // Visual feedback: disable button and show loading state
            _loginBusy = true;
            err.style.color = 'var(--primary)';
            err.textContent = '⏳ Authenticating...';
            showToast('⏳ Authenticating...');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Signing in...'; }

            let loginSuccess = false;

            try {
                const res = await apiPost({ action: 'login', username: uname, password: pass });
                if (res && res.success && res.user) {
                    _currentUser = res.user;
                    loginSuccess = true;
                } else if (uname === 'TPD-admin' && pass === 'tpd@2026') {
                    _currentUser = SUPER_ADMIN;
                    loginSuccess = true;
                } else {
                    const failMsg = (res && res.error) ? `❌ ${res.error}` : '❌ Invalid username or password.';
                    err.style.color = '#e53e3e';
                    err.textContent = failMsg;
                    showToast(failMsg);
                }
            } catch (e) {
                console.error('Login Exception:', e);
                err.style.color = '#e53e3e';
                err.textContent = '⚠️ Connection error. Try again.';
                showToast('⚠️ Connection error. Check your internet.');
            } finally {
                // FORCEFULLY turn off the loading spinner state under all circumstances
                _loginBusy = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Sign In →';
                }
            }

            if (loginSuccess) {
                err.textContent = '';
                showApp();
            }
        }

        function doLogout() {
            _currentUser = null;
            document.getElementById('loginOverlay').style.display = 'flex';
            document.getElementById('loginPass').value = '';
            document.getElementById('loginErr').textContent = '';
            renderLoginChips();
        }

        function showApp() {
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('headerUser').textContent =
                '👤 ' + _currentUser.username + (_currentUser.role === 'admin' ? ' · Admin' : '');
            document.getElementById('adminTabBtn').style.display =
                _currentUser.role === 'admin' ? 'block' : 'none';
            document.getElementById('date').value = new Date().toISOString().split('T')[0];
            bootApp();
        }

        /* ═══════════════════════════════════════════════════════════
           TABS
        ═══════════════════════════════════════════════════════════ */
        function switchTab(tab, btn) {
            document.getElementById('dprModal').classList.remove('open');
            document.getElementById('report').style.display = 'none';
            document.querySelectorAll('.tab-page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const pg = document.getElementById('tab' + tab);
            if (pg) { pg.classList.add('active'); pg.style.display = 'block'; }
            const ab = btn || document.getElementById('tabBtn' + tab);
            if (ab) ab.classList.add('active');
            if (tab === 'Dashboard') renderDashboard();
            if (tab === 'History')   renderHistory();
            if (tab === 'Admin')     renderAdminPanel();
        }

        function resetAndSwitchToForm(btn) {
            document.getElementById('dprModal').classList.remove('open');
            document.getElementById('report').style.display = 'none';
            document.querySelectorAll('.tab-page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const fp = document.getElementById('tabForm');
            if (fp) { fp.classList.add('active'); fp.style.display = 'block'; }
            (btn || document.getElementById('tabBtnForm')).classList.add('active');
            _editingKey = null;
            if (localStorage.getItem('dpr_form_draft')) {
                loadFormDraft();
            } else {
                document.getElementById('date').value = new Date().toISOString().split('T')[0];
                resetForm();
            }
        }

        /* ═══════════════════════════════════════════════════════════
           SITE DROPDOWN — with sub-project indentation
        ═══════════════════════════════════════════════════════════ */
        function getLocalTodayYMD() {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        function populateSearchSiteDropdown() {
            const sel = document.getElementById('searchSite');
            if (!sel) return;
            const prev = sel.value;
            const tops = _projects.filter(p => (!p.parent_id || String(p.parent_id).trim() === ''));
            let html = '<option value="">— Show All Sites —</option>';
            if (tops.length) {
                html += tops.map(proj => {
                    const subs = _projects.filter(p => String(p.parent_id) === String(proj.id));
                    const suffix = proj.status === 'inactive' ? ' (Inactive)' : '';
                    let inner = `<option value="${esc(proj.project_name)}">${proj.project_name}${suffix}</option>`;
                    if (subs.length) {
                        inner += subs.map(s => {
                            const sSuffix = s.status === 'inactive' ? ' (Inactive)' : '';
                            return `<option value="${esc(s.project_name)}">\u00a0\u00a0↳ ${s.project_name}${sSuffix}</option>`;
                        }).join('');
                    }
                    return inner;
                }).join('');
            }
            sel.innerHTML = html;
            if (prev && Array.from(sel.options).find(o => o.value === prev)) sel.value = prev;
        }

        function populateSiteDropdown() {
            const sel  = document.getElementById('site');
            if (!sel) return;
            const prev = sel.value;
            const tops = _projects.filter(p => (!p.parent_id || String(p.parent_id).trim() === '') && p.status === 'active');
            let html   = tops.length
                ? tops.map(proj => {
                    const subs = _projects.filter(p => String(p.parent_id) === String(proj.id) && p.status === 'active');
                    return `<option value="${esc(proj.project_name)}">${proj.project_name}</option>` +
                        subs.map(s => `<option value="${esc(s.project_name)}">\u00a0\u00a0↳ ${s.project_name}</option>`).join('');
                  }).join('')
                : '<option value="">No active projects</option>';
            sel.innerHTML = html;
            if (prev && Array.from(sel.options).find(o => o.value === prev)) sel.value = prev;

            populateSearchSiteDropdown();
        }

        /* ═══════════════════════════════════════════════════════════
           ACTIVITY ROWS — Main → Sub dependent dropdowns
        ═══════════════════════════════════════════════════════════ */
        function mainActivities() {
            return _activities.filter(a => (!a.parent_id || String(a.parent_id).trim() === '') && a.status === 'active');
        }
        function subActivitiesOf(parentId) {
            if (!parentId || String(parentId).trim() === '') return [];
            return _activities.filter(a => String(a.parent_id) === String(parentId) && a.status === 'active');
        }

        function resetForm() {
            document.getElementById('activityRowsContainer').innerHTML = '';
            _rowCounter = 0;
            document.getElementById('report').style.display = 'none';
            addActivityRow();
        }

        function addActivityRow(data) {
            _rowCounter++;
            const rowId = 'arow_' + _rowCounter;
            const subId = 'sub_'  + _rowCounter;
            const mains = mainActivities();

            const div     = document.createElement('div');
            div.className = 'activitybox';
            div.id        = rowId;
            div.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <span style="font-weight:700;font-size:11px;color:var(--primary);text-transform:uppercase;letter-spacing:.7px;">Activity ${_rowCounter}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="row-total-badge" style="font-size:11.5px; font-weight:700; color:var(--text); background:var(--primary-light); padding:3px 8px; border-radius:4px;">Total: <b class="row-total-val">0</b></span>
                        <button class="delete-btn" onclick="removeActivityRow('${rowId}')"
                                style="width:auto;padding:4px 10px;margin-top:0;font-size:11px;">🗑️ Remove</button>
                    </div>
                </div>
                <label>Main Activity</label>
                <select class="main-act-sel" onchange="onMainActChange(this,'${subId}')">
                    <option value="">— Select Main Activity —</option>
                    ${mains.map(m => `<option value="${esc(m.activity_name)}" data-id="${m.id}">${m.activity_name}</option>`).join('')}
                </select>
                <label id="lbl_${subId}" style="display:none;">Sub-Activity</label>
                <select class="sub-act-sel" id="${subId}" style="display:none;opacity:0.45;" disabled>
                    <option value="">— N/A —</option>
                </select>
                <div class="row2">
                    <div><label>Skilled</label><input type="number" class="skill" value="0" min="0"></div>
                    <div><label>Unskilled</label><input type="number" class="unskill" value="0" min="0"></div>
                </div>
                <label>Note <span style="font-weight:400;text-transform:none;">(Optional)</span></label>
                <input type="text" class="note-inp" placeholder="Work location or note...">`;

            document.getElementById('activityRowsContainer').appendChild(div);

            // Pre-fill for edit mode
            if (data) {
                // data can have: main_activity (from new saves) or activity (from DPR_Detail)
                const mainName = data.main_activity || data.activity || '';
                const subName  = data.sub_activity  || '';
                const mainSel  = div.querySelector('.main-act-sel');
                if (mainName) {
                    const found = mains.find(m => m.activity_name === mainName);
                    if (found) {
                        mainSel.value = mainName;
                    } else {
                        // Activity may be deactivated — add ephemeral option
                        const opt = document.createElement('option');
                        opt.value = mainName; opt.textContent = mainName; opt.setAttribute('data-id','');
                        mainSel.appendChild(opt); mainSel.value = mainName;
                    }
                    onMainActChange(mainSel, subId, subName);
                }
                div.querySelector('.skill').value    = data.skilled   != null ? data.skilled   : 0;
                div.querySelector('.unskill').value  = data.unskilled != null ? data.unskilled : 0;
                div.querySelector('.note-inp').value = data.note || '';
            }
            updateFormTotals();
        }

        function removeActivityRow(rowId) {
            const el = document.getElementById(rowId);
            if (el) el.remove();
            updateFormTotals();
            saveFormDraft();
        }

        function onMainActChange(sel, subSelId, preselectSub) {
            const subSel  = document.getElementById(subSelId);
            const label   = document.getElementById('lbl_' + subSelId);
            const selOpt  = sel.options[sel.selectedIndex];
            const mainId  = selOpt ? selOpt.getAttribute('data-id') : null;
            const subs    = mainId ? subActivitiesOf(mainId) : [];

            if (!subs.length) {
                if (subSel)  { subSel.innerHTML = '<option value="">— N/A —</option>'; subSel.disabled = true; subSel.style.opacity = '0.45'; subSel.style.display = 'none'; }
                if (label)   label.style.display = 'none';
            } else {
                if (subSel) {
                    subSel.disabled = false; subSel.style.opacity = '1'; subSel.style.display = '';
                    subSel.innerHTML = '<option value="">— Select Sub-Activity —</option>' +
                        subs.map(s => `<option value="${esc(s.activity_name)}">${s.activity_name}</option>`).join('');
                    if (preselectSub) subSel.value = preselectSub;
                }
                if (label) label.style.display = '';
            }
        }

        function collectActivityRows() {
            const rows = [];
            document.querySelectorAll('.activitybox').forEach(el => {
                const mainSel   = el.querySelector('.main-act-sel');
                const mainAct   = mainSel ? mainSel.value.trim() : '';
                const subSelEl  = el.querySelector('.sub-act-sel');
                const subAct    = subSelEl && !subSelEl.disabled && subSelEl.value ? subSelEl.value.trim() : '';
                const skilled   = Math.max(0, Number((el.querySelector('.skill')   || {}).value) || 0);
                const unskilled = Math.max(0, Number((el.querySelector('.unskill') || {}).value) || 0);
                const note      = ((el.querySelector('.note-inp') || {}).value || '').trim();
                if (mainAct) {
                    const section = detectSection(mainAct, subAct);
                    rows.push({ main_activity: mainAct, sub_activity: subAct, section, skilled, unskilled, note });
                }
            });
            return rows;
        }

        /* ═══════════════════════════════════════════════════════════
           GENERATE & SAVE
        ═══════════════════════════════════════════════════════════ */
        function generate() {
            if (!_currentUser) { showToast('⚠️ Please sign in first'); return; }
            const dateVal = document.getElementById('date').value;
            const siteVal = document.getElementById('site').value;
            if (!dateVal) { showToast('⚠️ Select a date'); return; }
            if (!siteVal) { showToast('⚠️ Select a site'); return; }

            const activities = collectActivityRows();
            if (!activities.some(a => a.skilled > 0 || a.unskilled > 0))
                { showToast('⚠️ Enter at least one activity with workers'); return; }

            const total    = activities.reduce((s, a) => s + a.skilled + a.unskilled, 0);
            const existing = _history.find(h => toYMD(h.date) === dateVal && String(h.site).trim() === siteVal.trim());
            const prepBy   = existing ? (existing.by || _currentUser.username) : _currentUser.username;
            const editedBy = (existing && existing.by !== _currentUser.username) ? _currentUser.username : null;

            // Build section-grouped report HTML
            const civilActs = [];
            const interiorActs = [];
            activities.forEach(a => {
                if (a.skilled > 0 || a.unskilled > 0) {
                    if (isCivilActivity(a)) {
                        civilActs.push(a);
                    } else {
                        interiorActs.push(a);
                    }
                }
            });


            const sectionHtml = renderSection('Civil Work', civilActs) + renderSection('Interior Work', interiorActs);

            document.getElementById('rdate').innerHTML =
                `<b>📅 Date :</b> ${formatDate(dateVal)}<br>
                 <b>📍 Site :</b> ${getSiteDisplayName(siteVal)}<br>
                 <b>👤 Filled by :</b> ${prepBy}${editedBy ? ` (Edited by: ${editedBy})` : ''}`;
            document.getElementById('rcivil').innerHTML    = sectionHtml;
            document.getElementById('rmanpower').innerHTML = `<div class="report-total">👷 Total Manpower : ${total}</div>`;
            document.getElementById('report').style.display = 'block';
            document.getElementById('report').scrollIntoView({ behavior: 'smooth' });

            saveToCloud(dateVal, siteVal, total, activities, prepBy, editedBy);
            showToast('✅ DPR Generated!');
        }

        function renderSection(title, acts) {
            if (!acts.length) return '';
            const grouped = {};
            acts.forEach(a => {
                const mainName = a.main_activity || a.activity || 'General';
                if (!grouped[mainName]) grouped[mainName] = [];
                grouped[mainName].push(a);
            });
            return `<div class="report-section-title">🔨 ${title}</div>` +
                Object.entries(grouped).map(([main, rows]) => {
                    const innerRowsHtml = rows.map((r, rIdx) => {
                        let childName = (r.sub_activity || r.activity || '').trim();
                        childName = childName.replace(/^[↳\s\-➔]+/, '').trim();
                        const mainClean = String(main).trim().toLowerCase();
                        if (childName.toLowerCase().indexOf(mainClean) === 0) {
                            childName = childName.substring(mainClean.length).replace(/^[↳\s\-➔]+/, '').trim();
                        }
                        
                        const isSub = childName !== '' && childName.toLowerCase() !== mainClean;
                        const totalVal = (Number(r.skilled) || 0) + (Number(r.unskilled) || 0);
                        const borderVal = rIdx === rows.length - 1 ? 'none' : '1.5px solid #cbd5e1';
                        
                        // Visual properties based on isSub
                        const paddingLeft = isSub ? '16px' : '0px';
                        const fontSize = '13.5px';
                        const titleColor = isSub ? '#475569' : '#1e293b';
                        const fontWeight = isSub ? '500' : '700';
                        const prefix = isSub ? '<span style="color:var(--primary);margin-right:4px;">↳</span>' : '';
                        
                        return `
                        <div style="padding: 10px 0; padding-left: ${paddingLeft}; border-bottom: ${borderVal}; line-height: 1.6;">
                            <div style="font-weight: ${fontWeight}; color: ${titleColor}; font-size: ${fontSize};">${prefix}${childName || toTitleCase(main)}</div>
                            <div style="font-size: 12px; color: #475569; margin-top: 4px;">
                                Skilled: <b>${r.skilled}</b> &nbsp;·&nbsp; Unskilled: <b>${r.unskilled}</b> &nbsp;·&nbsp; Total: <b>${totalVal}</b>
                            </div>
                            ${r.note ? `<div style="color: #475569; font-size: 11.5px; margin-top: 6px; font-style: italic; background: #f8fafc; padding: 6px 8px; border-radius: 4px; border-left: 2.5px solid #cbd5e1;">📌 ${r.note}</div>` : ''}
                        </div>`;
                    }).join('');

                    return `
                    <div class="report-activity" style="margin-bottom: 14px; padding: 16px; border-left: 5px solid var(--primary); background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <div style="font-weight: 600; font-size: 14.5px; color: #1e293b; margin-bottom: 12px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 6px; letter-spacing: 0.2px;">
                            📦 ${toTitleCase(main)}
                        </div>
                        <div style="display: flex; flex-direction: column;">
                            ${innerRowsHtml}
                        </div>
                    </div>`;
                }).join('');
        }

        function saveToCloud(dateVal, siteVal, total, activities, prepBy, editedBy) {
            const isEdit  = !!_editingKey;
            const payload = {
                action:    isEdit ? 'editDPR' : 'saveDPR',
                date:      dateVal,
                site:      siteVal,
                total,
                activities,          // includes section field per row
                by:        prepBy,
                editedBy:  editedBy || '',
                submittedAt: new Date().toISOString()
            };
            if (!navigator.onLine) {
                const q = JSON.parse(localStorage.getItem('dprOfflineQ') || '[]');
                q.push(payload);
                localStorage.setItem('dprOfflineQ', JSON.stringify(q));
                showToast('💾 Offline — will sync on reconnect');
                return;
            }
            showToast('☁️ Saving to cloud...');
            apiPost(payload)
                .then(() => {
                    showToast(isEdit ? '✅ DPR Updated!' : '✅ Saved!');
                    _editingKey = null;
                    localStorage.removeItem('dpr_form_draft');
                    document.getElementById('date').value = new Date().toISOString().split('T')[0];
                    document.getElementById('report').style.display = 'none';
                    resetForm();
                    loadHistory();
                })
                .catch(() => showToast('⚠️ Save failed — check connection'));
        }

        function syncOfflineQueue() {
            const q = JSON.parse(localStorage.getItem('dprOfflineQ') || '[]');
            if (!q.length) { showToast('✅ Nothing to sync'); return; }
            showToast(`🔄 Syncing ${q.length} queued DPR(s)...`);
            Promise.all(q.map(p => apiPost(p)))
                .then(() => { localStorage.removeItem('dprOfflineQ'); showToast('✅ All synced!'); loadHistory(); })
                .catch(() => showToast('⚠️ Sync failed'));
        }

        /* ═══════════════════════════════════════════════════════════
           HISTORY  (no default date filter — shows ALL records)
        ═══════════════════════════════════════════════════════════ */
        function loadHistory() {
            const el = document.getElementById('historyList');
            if (el) el.innerHTML = getSkeletonLoader();
            apiFetch('')
                .then(d => {
                    _history = Array.isArray(d) ? d : [];
                    updateHistoryCount();
                    populateSupervisorDropdown();
                    renderAdminAnalytics();
                    resetHistoryPageAndRender();
                    renderDashboard();
                })
                .catch(() => {
                    if (el) el.innerHTML = '<p style="color:#e57373;text-align:center;padding:10px;">⚠️ Failed to load records.</p>';
                });
        }

        function updateHistoryCount() {
            const el = document.getElementById('historyCount');
            if (el) el.textContent = `📊 ${_history.length} total record${_history.length !== 1 ? 's' : ''} loaded`;
        }

        function toggleHistoryDropdown(event, idx) {
            event.stopPropagation();
            const dropdown = document.getElementById(`dropdown_${idx}`);
            const wasShowing = dropdown ? dropdown.classList.contains('show') : false;
            
            closeAllHistoryDropdowns();
            
            if (dropdown && !wasShowing) {
                dropdown.classList.add('show');
            }
        }
        
        function closeAllHistoryDropdowns() {
            document.querySelectorAll('.history-dropdown').forEach(d => {
                d.classList.remove('show');
            });
        }

        function getReportHtmlForRecord(item) {
            const civilArr    = Array.isArray(item.civilActivities)    ? item.civilActivities    : [];
            const interiorArr = Array.isArray(item.interiorActivities) ? item.interiorActivities : [];
            const detailRows  = Array.isArray(item.details) ? item.details : [];

            let bodyHtml = '';

            function renderActArr(title, arr) {
                if (!arr.length) return '';
                const grouped = {};
                arr.forEach(a => {
                    const mainName = a.main_activity || a.activity || 'General';
                    if (!grouped[mainName]) grouped[mainName] = [];
                    grouped[mainName].push(a);
                });

                return `<div class="report-section-title">🔨 ${title}</div>` +
                    Object.entries(grouped).map(([main, rows]) => {
                        const innerRowsHtml = rows.map((r, rIdx) => {
                            let childName = (r.activity || r.sub_activity || '').trim();
                            childName = childName.replace(/^[↳\s\-➔]+/, '').trim();
                            const mainClean = String(main).trim().toLowerCase();
                            if (childName.toLowerCase().indexOf(mainClean) === 0) {
                                childName = childName.substring(mainClean.length).replace(/^[↳\s\-➔]+/, '').trim();
                            }
                            
                            const isSub = childName !== '' && childName.toLowerCase() !== mainClean;
                            const sk = Number(r.skilled) || 0;
                            const un = Number(r.unskilled) || 0;
                            const totalVal = sk + un;
                            const borderVal = rIdx === rows.length - 1 ? 'none' : '1.5px solid #cbd5e1';

                            // Visual properties based on isSub
                            const paddingLeft = isSub ? '16px' : '0px';
                            const fontSize = '13.5px';
                            const titleColor = isSub ? '#475569' : '#1e293b';
                            const fontWeight = isSub ? '500' : '700';
                            const prefix = isSub ? '<span style="color:var(--primary);margin-right:4px;">↳</span>' : '';

                            return `
                            <div style="padding: 10px 0; padding-left: ${paddingLeft}; border-bottom: ${borderVal}; line-height: 1.6;">
                                <div style="font-weight: ${fontWeight}; color: ${titleColor}; font-size: ${fontSize};">${prefix}${childName || toTitleCase(main)}</div>
                                <div style="font-size: 12px; color: #475569; margin-top: 4px;">
                                    Skilled: <b>${sk}</b> &nbsp;·&nbsp; Unskilled: <b>${un}</b> &nbsp;·&nbsp; Total: <b>${totalVal}</b>
                                </div>
                                ${r.note ? `<div style="color: #475569; font-size: 11.5px; margin-top: 6px; font-style: italic; background: #f8fafc; padding: 6px 8px; border-radius: 4px; border-left: 2.5px solid #cbd5e1;">📌 ${r.note}</div>` : ''}
                            </div>`;
                        }).join('');

                        return `
                        <div class="report-activity" style="margin-bottom: 14px; padding: 16px; border-left: 5px solid var(--primary); background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                            <div style="font-weight: 600; font-size: 14.5px; color: #1e293b; margin-bottom: 12px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 6px; letter-spacing: 0.2px;">
                                📦 ${toTitleCase(main)}
                            </div>
                            <div style="display: flex; flex-direction: column;">
                                ${innerRowsHtml}
                            </div>
                        </div>`;
                    }).join('');
            }

            // Pool and classify all activities dynamically based on type
            let allActs = [];
            if (civilArr.length || interiorArr.length) {
                civilArr.forEach(a => { allActs.push({ ...a, section: a.section || 'Civil' }); });
                interiorArr.forEach(a => { allActs.push({ ...a, section: a.section || 'Interior' }); });
            } else if (detailRows.length) {
                detailRows.forEach(r => {
                    allActs.push({
                        main_activity: r.main_activity || r.activity,
                        activity: r.activity || r.main_activity,
                        sub_activity: r.sub_activity || '',
                        skilled: r.skilled,
                        unskilled: r.unskilled,
                        note: r.note,
                        section: r.section
                    });
                });
            }

            const civilActs = [];
            const interiorActs = [];
            allActs.forEach(a => {
                if (Number(a.skilled) > 0 || Number(a.unskilled) > 0) {
                    if (isCivilActivity(a)) {
                        civilActs.push(a);
                    } else {
                        interiorActs.push(a);
                    }
                }
            });

            if (civilActs.length || interiorActs.length) {
                bodyHtml = renderActArr('Civil Work', civilActs) + renderActArr('Interior Work', interiorActs);
            } else {
                bodyHtml = '<p style="color:var(--muted);text-align:center;padding:20px;">No activity detail available for this record.</p>';
            }

            const d      = toYMD(item.date);
            const byLine = item.editedBy && item.editedBy !== item.by
                ? `${item.by} (Edited by: ${item.editedBy})`
                : (item.by || '—');

            return `
                <h3>DPR &mdash; MAN POWER REPORT</h3>
                <div class="report-meta">
                    <b>📅 Date :</b> ${formatDate(d) || '—'}<br>
                    <b>📍 Site :</b> ${getSiteDisplayName(item.site)}<br>
                    <b>👤 Filled by :</b> ${byLine}<br>
                    <b>👷 Total :</b> ${item.total || 0} workers
                </div>
                <div>${bodyHtml}</div>
                <div class="report-total" style="margin-top:14px;">👷 Total Manpower : ${item.total || 0}</div>
            `;
        }

        function downloadHistoryDPR(i, type) {
            const item = _history[i];
            if (!item) return;

            const reportHtml = getReportHtmlForRecord(item);

            // Create off-screen container
            const tempContainer = document.createElement('div');
            tempContainer.id = 'report-temp-capture';
            tempContainer.style.position = 'absolute';
            tempContainer.style.left = '-9999px';
            tempContainer.style.top = '0';
            tempContainer.style.width = '480px';
            tempContainer.style.maxWidth = '480px';
            tempContainer.style.background = '#ffffff';
            tempContainer.style.color = '#000000';
            tempContainer.style.padding = '20px';
            tempContainer.style.boxSizing = 'border-box';
            tempContainer.style.fontFamily = "'Inter', sans-serif";
            tempContainer.style.lineHeight = '1.75';
            tempContainer.style.fontSize = '14px';
            
            tempContainer.innerHTML = reportHtml;

            // Direct inline styles to match header configuration
            const h3 = tempContainer.querySelector('h3');
            if (h3) {
                h3.style.fontFamily = "'Rajdhani', sans-serif";
                h3.style.fontSize = '21px';
                h3.style.color = 'var(--primary)';
                h3.style.marginBottom = '6px';
                h3.style.textAlign = 'center';
                h3.style.letterSpacing = '0.5px';
            }

            document.body.appendChild(tempContainer);

            const allItems = tempContainer.querySelectorAll('.report-activity, .report-meta, .report-total');
            allItems.forEach(el => {
                el.style.pageBreakInside = 'avoid';
                el.style.breakInside = 'avoid';
            });

            const cleanSite = String(item.site || 'Site').replace(/[^a-zA-Z0-9_\-]/g, '_');
            const cleanDate = toYMD(item.date);
            const baseName = `DPR_History_${cleanSite}_${cleanDate}`;

            showToast(`⏳ Generating ${type === 'pdf' ? 'PDF' : 'Image'}...`);

            // Use 150ms timeout to guarantee dynamic mounting has fully laid out child elements
            setTimeout(() => {
                html2canvas(tempContainer, {
                    scale: 3.5,
                    devicePixelRatio: 3.5,
                    useCORS: true,
                    allowTaint: false,
                    backgroundColor: '#ffffff',
                    logging: false,
                    scrollX: 0,
                    scrollY: 0,
                    onclone: function(clonedDoc) {
                        const canvas = clonedDoc.querySelector('canvas');
                        if (canvas) {
                            const ctx = canvas.getContext('2d');
                            ctx.imageSmoothingEnabled = false;
                            ctx.webkitImageSmoothingEnabled = false;
                            ctx.mozImageSmoothingEnabled = false;
                        }
                    }
                }).then(c => {
                    document.body.removeChild(tempContainer);

                    const dataUrl = c.toDataURL('image/jpeg', 0.95);
                    if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 100) {
                        showToast('⚠️ Generated image was empty. Try again.');
                        return;
                    }

                    if (type === 'pdf') {
                        const { jsPDF } = window.jspdf;
                        const imgWidth = c.width;
                        const imgHeight = c.height;
                        const pdf = new jsPDF({
                            orientation: 'portrait',
                            unit: 'px',
                            format: [imgWidth, imgHeight]
                        });

                        pdf.addImage(dataUrl, 'JPEG', 0, 0, imgWidth, imgHeight);
                        pdf.save(`${baseName}.pdf`);
                        showToast('📄 PDF Downloaded!');
                    } else {
                        const a = document.createElement('a');
                        a.download = `${baseName}.jpg`;
                        a.href = dataUrl;
                        a.click();
                        showToast('📷 Image Downloaded!');
                    }
                }).catch(err => {
                    if (document.getElementById('report-temp-capture')) {
                        document.body.removeChild(tempContainer);
                    }
                    showToast(`⚠️ ${type === 'pdf' ? 'PDF' : 'Image'} generation failed`);
                });
            }, 150);
        }

        /* ═══════════════════════════════════════════════════════════
           OVERHAUL HELPER FUNCTIONS
        ═══════════════════════════════════════════════════════════ */
        function getSkeletonLoader() {
            return `
            <div class="skeleton-card">
                <div class="skeleton-block" style="width: 40%; height: 18px;"></div>
                <div class="skeleton-block" style="width: 75%; height: 14px;"></div>
                <div class="skeleton-block" style="width: 25%; height: 26px; border-radius: 4px; margin-top: 6px;"></div>
            </div>
            <div class="skeleton-card">
                <div class="skeleton-block" style="width: 50%; height: 18px;"></div>
                <div class="skeleton-block" style="width: 60%; height: 14px;"></div>
                <div class="skeleton-block" style="width: 25%; height: 26px; border-radius: 4px; margin-top: 6px;"></div>
            </div>
            <div class="skeleton-card">
                <div class="skeleton-block" style="width: 35%; height: 18px;"></div>
                <div class="skeleton-block" style="width: 80%; height: 14px;"></div>
                <div class="skeleton-block" style="width: 25%; height: 26px; border-radius: 4px; margin-top: 6px;"></div>
            </div>
            `;
        }

        function updateFormTotals() {
            document.querySelectorAll('.activitybox').forEach(row => {
                const sk = Math.max(0, Number(row.querySelector('.skill')?.value) || 0);
                const un = Math.max(0, Number(row.querySelector('.unskill')?.value) || 0);
                const valEl = row.querySelector('.row-total-val');
                if (valEl) valEl.textContent = sk + un;
            });
        }

        function saveFormDraft() {
            if (_editingKey) return;
            const dateVal = document.getElementById('date')?.value || '';
            const siteVal = document.getElementById('site')?.value || '';
            const activities = collectActivityRows();
            if (!dateVal && !siteVal && activities.length <= 1 && activities.every(a => !a.main_activity && a.skilled === 0 && a.unskilled === 0 && !a.note)) {
                localStorage.removeItem('dpr_form_draft');
                return;
            }
            const draft = { date: dateVal, site: siteVal, activities };
            localStorage.setItem('dpr_form_draft', JSON.stringify(draft));
        }

        function loadFormDraft() {
            try {
                const draftStr = localStorage.getItem('dpr_form_draft');
                if (!draftStr) return;
                const draft = JSON.parse(draftStr);
                if (!draft) return;
                
                if (draft.date) {
                    const dateEl = document.getElementById('date');
                    if (dateEl) dateEl.value = draft.date;
                }
                if (draft.site) {
                    const siteEl = document.getElementById('site');
                    if (siteEl) siteEl.value = draft.site;
                }
                
                const container = document.getElementById('activityRowsContainer');
                if (container) {
                    container.innerHTML = '';
                    _rowCounter = 0;
                    if (Array.isArray(draft.activities) && draft.activities.length > 0) {
                        draft.activities.forEach(act => addActivityRow(act));
                    } else {
                        addActivityRow();
                    }
                }
                updateFormTotals();
            } catch (e) {
                console.error("Failed to load form draft", e);
            }
        }

        function exportMasterLogCSV() {
            if (!_history.length) { showToast('⚠️ No history records to export'); return; }
            const headers = [
                'Date', 'Site', 'Supervisor (Created By)', 'Last Edited By', 'Submitted At',
                'Total DPR Manpower', 'Activity Category (Main)', 'Sub-Activity', 'Section',
                'Skilled Workers', 'Unskilled Workers', 'Activity Total', 'Note'
            ];
            const rows = [headers];
            _history.forEach(item => {
                const dateStr = toYMD(item.date);
                const siteStr = item.site || '';
                const createdBy = item.by || '';
                const editedBy = item.editedBy || '';
                const submittedAt = item.submittedAt || '';
                const totalManpower = item.total || 0;
                
                let activities = [];
                if (Array.isArray(item.civilActivities)) {
                    activities.push(...item.civilActivities.map(a => ({ ...a, section: 'Civil' })));
                }
                if (Array.isArray(item.interiorActivities)) {
                    activities.push(...item.interiorActivities.map(a => ({ ...a, section: 'Interior' })));
                }
                if (!activities.length && Array.isArray(item.details)) {
                    activities.push(...item.details.map(d => ({
                        main_activity: d.activity || d.main_activity || '',
                        sub_activity: d.subActivity || '',
                        section: d.section || 'Civil',
                        skilled: d.skilled,
                        unskilled: d.unskilled,
                        note: d.note
                    })));
                }
                
                if (activities.length === 0) {
                    rows.push([dateStr, siteStr, createdBy, editedBy, submittedAt, totalManpower, '', '', '', 0, 0, 0, '']);
                } else {
                    activities.forEach(act => {
                        const mainAct = act.main_activity || act.activity || '';
                        const subAct = act.sub_activity || '';
                        const sect = isCivilActivity(act) ? 'Civil' : 'Interior';
                        const sk = Number(act.skilled) || 0;
                        const un = Number(act.unskilled) || 0;
                        const actTotal = sk + un;
                        const noteStr = act.note || '';
                        rows.push([dateStr, siteStr, createdBy, editedBy, submittedAt, totalManpower, mainAct, subAct, sect, sk, un, actTotal, noteStr]);
                    });
                }
            });
            const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.map(val => {
                let s = String(val === null || val === undefined ? '' : val).replace(/"/g, '""');
                if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
                    s = `"${s}"`;
                }
                return s;
            }).join(",")).join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `TPD_DPR_Master_Log_${getLocalTodayYMD()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('✅ CSV Exported!');
        }

        function populateSupervisorDropdown() {
            const sel = document.getElementById('searchSupervisor');
            if (!sel) return;
            const prev = sel.value;
            const supervisors = new Set();
            _users.forEach(u => supervisors.add(u.username));
            _history.forEach(h => { if (h.by) supervisors.add(h.by); });
            let html = '<option value="">— Show All —</option>';
            Array.from(supervisors).sort().forEach(sup => {
                html += `<option value="${esc(sup)}">${sup}</option>`;
            });
            sel.innerHTML = html;
            if (prev && Array.from(sel.options).find(o => o.value === prev)) sel.value = prev;
        }

        function resetHistoryPageAndRender() {
            _historyPage = 1;
            renderHistory();
        }

        function changeHistoryPage(dir) {
            _historyPage += dir;
            renderHistory();
        }

        function renderAdminAnalytics() {
            const todayYMD = getLocalTodayYMD();
            const todayDPRs = _history.filter(h => toYMD(h.date) === todayYMD);
            const workforceToday = todayDPRs.reduce((sum, h) => sum + (Number(h.total) || 0), 0);
            
            const siteCounts = {};
            _history.forEach(h => { if (h.site) siteCounts[h.site] = (siteCounts[h.site] || 0) + 1; });
            let mostActiveSite = '—';
            let maxCount = 0;
            Object.entries(siteCounts).forEach(([site, count]) => {
                if (count > maxCount) { maxCount = count; mostActiveSite = site; }
            });
            const displayActiveSite = mostActiveSite.length > 15 ? mostActiveSite.substring(0, 15) + '...' : mostActiveSite;
            
            const activeCount = _projects.filter(p => p.status === 'active').length;
            const totalCount = _projects.length;
            
            const tfEl = document.getElementById('adminWorkforceToday');
            if (tfEl) tfEl.textContent = workforceToday;
            const masEl = document.getElementById('adminActiveSite');
            if (masEl) {
                masEl.textContent = displayActiveSite;
                masEl.title = mostActiveSite;
            }
            const prEl = document.getElementById('adminProjectRatio');
            if (prEl) prEl.textContent = `${activeCount}/${totalCount}`;
        }

        function renderHistory() {
            const sStart = (document.getElementById('searchStartDate')?.value || '').trim();
            const sEnd   = (document.getElementById('searchEndDate')?.value || '').trim();
            const sSite  = ((document.getElementById('searchSite') || {}).value || '').toLowerCase().trim();
            const sSup   = ((document.getElementById('searchSupervisor') || {}).value || '').toLowerCase().trim();

            const filtered = _history.filter(item => {
                if (sStart) {
                    const itemDate = toYMD(item.date);
                    if (itemDate < sStart) return false;
                }
                if (sEnd) {
                    const itemDate = toYMD(item.date);
                    if (itemDate > sEnd) return false;
                }
                if (sSite && !String(item.site || '').toLowerCase().includes(sSite)) return false;
                if (sSup && String(item.by || '').toLowerCase() !== sSup) return false;
                return true;
            });

            updateHistoryCount();
            
            // Sort filtered: latest date first, then latest submittedAt
            filtered.sort((a, b) => {
                const dateA = toYMD(a.date);
                const dateB = toYMD(b.date);
                if (dateA !== dateB) {
                    return dateB.localeCompare(dateA);
                }
                const timeA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
                const timeB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
                return timeB - timeA;
            });

            const totalItems = filtered.length;
            const totalPages = Math.max(1, Math.ceil(totalItems / _itemsPerPage));
            
            if (_historyPage > totalPages) _historyPage = totalPages;
            if (_historyPage < 1) _historyPage = 1;
            
            const startIdx = (_historyPage - 1) * _itemsPerPage;
            const endIdx   = startIdx + _itemsPerPage;
            const pagedItems = filtered.slice(startIdx, endIdx);

            const el = document.getElementById('historyList');
            if (!el) return;

            // Update pagination UI
            const btnPrev = document.getElementById('btnPrevPage');
            const btnNext = document.getElementById('btnNextPage');
            const indicator = document.getElementById('historyPageIndicator');
            const paginationWrap = document.getElementById('historyPagination');
            
            if (paginationWrap) {
                if (totalItems === 0) {
                    paginationWrap.style.display = 'none';
                } else {
                    paginationWrap.style.display = 'flex';
                    if (indicator) indicator.textContent = `Page ${_historyPage} of ${totalPages}`;
                    if (btnPrev) btnPrev.disabled = (_historyPage === 1);
                    if (btnNext) btnNext.disabled = (_historyPage === totalPages);
                    
                    if (btnPrev) {
                        btnPrev.style.opacity = (_historyPage === 1) ? '0.5' : '1';
                        btnPrev.style.pointerEvents = (_historyPage === 1) ? 'none' : 'auto';
                    }
                    if (btnNext) {
                        btnNext.style.opacity = (_historyPage === totalPages) ? '0.5' : '1';
                        btnNext.style.pointerEvents = (_historyPage === totalPages) ? 'none' : 'auto';
                    }
                }
            }

            if (!_history.length) {
                el.innerHTML = '<p style="color:#aaa;text-align:center;padding:16px;">No records loaded. Click Refresh.</p>';
                return;
            }
            if (!filtered.length) {
                el.innerHTML = '<p style="color:#aaa;text-align:center;padding:16px;">No records match the current filter.</p>';
                return;
            }

            const isAdmin = _currentUser && _currentUser.role === 'admin';
            el.innerHTML  = pagedItems.map(item => {
                const realIdx  = _history.indexOf(item);
                const d        = toYMD(item.date);
                const byLine   = item.by
                    ? (item.editedBy && item.editedBy !== item.by
                        ? `By: <b>${item.by}</b> (Edited)`
                        : `By: <b>${item.by}</b>`)
                    : '';
                const isOwn    = _currentUser && item.by === _currentUser.username;
                const sub      = Number(item.submittedAt) || (item.submittedAt ? new Date(item.submittedAt).getTime() : 0);
                const within15 = sub && (Date.now() - sub) < 15 * 60 * 1000;
                const granted  = item.editPermission === 'granted';
                const pending  = item.editPermission === 'pending';

                let editActionLabel = '✏️ Edit';
                let editActionOnClick = `editDPR(${realIdx})`;
                if (!isAdmin && isOwn && !within15 && !granted && !pending) {
                    editActionLabel = '🔑 Request Edit';
                    editActionOnClick = `requestEditDPR(${realIdx})`;
                } else if (!isAdmin && isOwn && pending) {
                    editActionLabel = '⏳ Edit Pending';
                    editActionOnClick = `showToast("⏳ Edit request is pending Admin approval")`;
                } else if (!isAdmin && !isOwn) {
                    editActionLabel = '✏️ Edit (Disabled)';
                    editActionOnClick = `showToast("❌ You can only edit your own DPRs")`;
                }

                const civilArr    = Array.isArray(item.civilActivities)    ? item.civilActivities    : [];
                const interiorArr = Array.isArray(item.interiorActivities) ? item.interiorActivities : [];
                const detailRows  = Array.isArray(item.details) ? item.details : [];

                let allActs = [];
                if (civilArr.length || interiorArr.length) {
                    civilArr.forEach(a => { allActs.push({ ...a, section: a.section || 'Civil' }); });
                    interiorArr.forEach(a => { allActs.push({ ...a, section: a.section || 'Interior' }); });
                } else if (detailRows.length) {
                    detailRows.forEach(r => {
                        allActs.push({
                            main_activity: r.main_activity || r.activity,
                            activity: r.activity || r.main_activity,
                            sub_activity: r.sub_activity || '',
                            skilled: r.skilled,
                            unskilled: r.unskilled,
                            note: r.note,
                            section: r.section
                        });
                    });
                }

                let civCount = 0;
                let intCount = 0;
                allActs.forEach(a => {
                    if (Number(a.skilled) > 0 || Number(a.unskilled) > 0) {
                        if (isCivilActivity(a)) {
                            civCount++;
                        } else {
                            intCount++;
                        }
                    }
                });

                const actHint  = (civCount + intCount) > 0
                    ? `${civCount} civil · ${intCount} interior`
                    : (allActs.length > 0 ? `${allActs.length} activit${allActs.length > 1 ? 'ies' : 'y'}` : '');

                const dropdownHtml = `
                <button class="history-options-btn" onclick="toggleHistoryDropdown(event, ${realIdx})">&#8942;</button>
                <div class="history-dropdown" id="dropdown_${realIdx}">
                    <button class="history-dropdown-item" onclick="closeAllHistoryDropdowns(); ${editActionOnClick}">${editActionLabel}</button>
                    <button class="history-dropdown-item delete-item" onclick="closeAllHistoryDropdowns(); deleteDPR(${realIdx})">❌ Delete</button>
                    <button class="history-dropdown-item" onclick="closeAllHistoryDropdowns(); downloadHistoryDPR(${realIdx}, 'image')">📸 Download Image</button>
                    <button class="history-dropdown-item" onclick="closeAllHistoryDropdowns(); downloadHistoryDPR(${realIdx}, 'pdf')">📄 Download PDF</button>
                </div>
                `;

                return `
                <div class="history-item">
                    ${dropdownHtml}
                    <div style="font-size:14px;font-weight:700;padding-right:30px;">
                        📅 ${formatDate(d) || '—'}
                        <span style="font-size:12px;font-weight:400;color:var(--muted);margin-left:6px;">${byLine}</span>
                    </div>
                    <div style="font-size:12px;color:var(--muted);margin-top:3px;padding-right:30px;">
                        📍 ${getSiteDisplayName(item.site) || '—'} &nbsp;·&nbsp; 👷 <b>${item.total || 0}</b> workers
                        ${actHint ? `&nbsp;·&nbsp; 📋 ${actHint}` : ''}
                    </div>
                    <div class="hbtn-group">
                        <button class="btn-blue btn-sm" onclick="openDPR(${realIdx})" style="width:auto;padding:6px 10px;">📂 View</button>
                    </div>
                </div>`;
            }).join('');
        }

        function clearHistoryFilter() {
            const ssd = document.getElementById('searchStartDate'); if (ssd) ssd.value = '';
            const sed = document.getElementById('searchEndDate'); if (sed) sed.value = '';
            const ss = document.getElementById('searchSite'); if (ss) ss.value = '';
            const sSup = document.getElementById('searchSupervisor'); if (sSup) sSup.value = '';
            resetHistoryPageAndRender();
        }

        /* ═══════════════════════════════════════════════════════════
           VIEW DPR MODAL — uses civilActivities + interiorActivities
           from DPR_Records (JSON), falling back to DPR_Detail rows
        ═══════════════════════════════════════════════════════════ */
        function openDPR(i) {
            const item = _history[i];
            if (!item) return;

            // Prefer the JSON arrays from DPR_Records (cols J & K)
            const civilArr    = Array.isArray(item.civilActivities)    ? item.civilActivities    : [];
            const interiorArr = Array.isArray(item.interiorActivities) ? item.interiorActivities : [];
            // Fall back to DPR_Detail rows if JSON columns are empty
            const detailRows  = Array.isArray(item.details) ? item.details : [];

            let bodyHtml = '';

            function renderActArr(title, arr) {
                if (!arr.length) return '';
                const grouped = {};
                arr.forEach(a => {
                    const mainName = a.main_activity || a.activity || 'General';
                    if (!grouped[mainName]) grouped[mainName] = [];
                    grouped[mainName].push(a);
                });

                return `<div class="report-section-title">🔨 ${title}</div>` +
                    Object.entries(grouped).map(([main, rows]) => {
                        const innerRowsHtml = rows.map((r, rIdx) => {
                            let childName = (r.activity || '').trim();
                            childName = childName.replace(/^[↳\s\-➔]+/, '').trim();
                            const mainClean = String(main).trim().toLowerCase();
                            if (childName.toLowerCase().indexOf(mainClean) === 0) {
                                childName = childName.substring(mainClean.length).replace(/^[↳\s\-➔]+/, '').trim();
                            }
                            
                            const isSub = childName !== '' && childName.toLowerCase() !== mainClean;
                            const sk = Number(r.skilled) || 0;
                            const un = Number(r.unskilled) || 0;
                            const totalVal = sk + un;
                            const borderVal = rIdx === rows.length - 1 ? 'none' : '1.5px solid #cbd5e1';

                            // Visual properties based on isSub
                            const paddingLeft = isSub ? '16px' : '0px';
                            const fontSize = '13.5px';
                            const titleColor = isSub ? '#475569' : '#1e293b';
                            const fontWeight = isSub ? '500' : '700';
                            const prefix = isSub ? '<span style="color:var(--primary);margin-right:4px;">↳</span>' : '';

                            return `
                            <div style="padding: 10px 0; padding-left: ${paddingLeft}; border-bottom: ${borderVal}; line-height: 1.6;">
                                <div style="font-weight: ${fontWeight}; color: ${titleColor}; font-size: ${fontSize};">${prefix}${childName || toTitleCase(main)}</div>
                                <div style="font-size: 12px; color: #475569; margin-top: 4px;">
                                    Skilled: <b>${sk}</b> &nbsp;·&nbsp; Unskilled: <b>${un}</b> &nbsp;·&nbsp; Total: <b>${totalVal}</b>
                                </div>
                                ${r.note ? `<div style="color: #475569; font-size: 11.5px; margin-top: 6px; font-style: italic; background: #f8fafc; padding: 6px 8px; border-radius: 4px; border-left: 2.5px solid #cbd5e1;">📌 ${r.note}</div>` : ''}
                            </div>`;
                        }).join('');

                        return `
                        <div class="report-activity" style="margin-bottom: 14px; padding: 16px; border-left: 5px solid var(--primary); background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                            <div style="font-weight: 600; font-size: 14.5px; color: #1e293b; margin-bottom: 12px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 6px; letter-spacing: 0.2px;">
                                📦 ${toTitleCase(main)}
                            </div>
                            <div style="display: flex; flex-direction: column;">
                                ${innerRowsHtml}
                            </div>
                        </div>`;
                    }).join('');
            }

            // Pool and classify all activities dynamically based on type
            let allActs = [];
            if (civilArr.length || interiorArr.length) {
                civilArr.forEach(a => { allActs.push({ ...a, section: a.section || 'Civil' }); });
                interiorArr.forEach(a => { allActs.push({ ...a, section: a.section || 'Interior' }); });
            } else if (detailRows.length) {
                detailRows.forEach(r => {
                    allActs.push({
                        main_activity: r.main_activity || r.activity,
                        activity: r.activity || r.main_activity,
                        sub_activity: r.sub_activity || '',
                        skilled: r.skilled,
                        unskilled: r.unskilled,
                        note: r.note,
                        section: r.section
                    });
                });
            }

            const civilActs = [];
            const interiorActs = [];
            allActs.forEach(a => {
                if (Number(a.skilled) > 0 || Number(a.unskilled) > 0) {
                    if (isCivilActivity(a)) {
                        civilActs.push(a);
                    } else {
                        interiorActs.push(a);
                    }
                }
            });

            if (civilActs.length || interiorActs.length) {
                bodyHtml = renderActArr('Civil Work', civilActs) + renderActArr('Interior Work', interiorActs);
            } else {
                bodyHtml = '<p style="color:var(--muted);text-align:center;padding:20px;">No activity detail available for this record.</p>';
            }

            const d      = toYMD(item.date);
            const byLine = item.editedBy && item.editedBy !== item.by
                ? `${item.by} (Edited by: ${item.editedBy})`
                : (item.by || '—');

            document.getElementById('dprModalBody').innerHTML = `
                <div class="report-meta">
                    <b>📅 Date :</b> ${formatDate(d) || '—'}<br>
                    <b>📍 Site :</b> ${getSiteDisplayName(item.site)}<br>
                    <b>👤 Filled by :</b> ${byLine}<br>
                    <b>👷 Total :</b> ${item.total || 0} workers
                </div>
                ${bodyHtml}
                <div class="report-total" style="margin-top:14px;">👷 Total Manpower : ${item.total || 0}</div>`;
            document.getElementById('dprModal').classList.add('open');
        }

        function closeDPRModal() {
            document.getElementById('dprModal').classList.remove('open');
        }

        function deleteDPR(i) {
            if (!_currentUser || _currentUser.role !== 'admin') { showToast('❌ Only Admin can delete'); return; }
            if (!confirm('Delete this DPR record permanently?')) return;
            const item = _history[i];
            const key  = toYMD(item.date) + '||' + String(item.site).trim();
            apiPost({ action: 'delete', id: key })
                .then(() => { showToast('🗑️ Deleted!'); loadHistory(); })
                .catch(() => showToast('⚠️ Delete failed'));
        }

        /* ═══════════════════════════════════════════════════════════
           EDIT DPR — reconstructs activity rows from JSON arrays
        ═══════════════════════════════════════════════════════════ */
        function editDPR(i) {
            const item = _history[i];
            if (!item || !_currentUser) return;
            const isAdmin  = _currentUser.role === 'admin';
            const isOwn    = item.by === _currentUser.username;
            const sub      = Number(item.submittedAt) || (item.submittedAt ? new Date(item.submittedAt).getTime() : 0);
            const within15 = sub && (Date.now() - sub) < 15 * 60 * 1000;
            const granted  = item.editPermission === 'granted';
            if (!isAdmin && !isOwn)               { showToast('❌ You can only edit your own DPRs'); return; }
            if (!isAdmin && !within15 && !granted) { showToast('🔒 Edit window expired. Request Edit first.'); return; }

            _editingKey = toYMD(item.date) + '||' + String(item.site).trim();

            document.getElementById('date').value = toYMD(item.date);
            const siteEl = document.getElementById('site');
            siteEl.value = item.site;
            if (!siteEl.value && item.site) {
                const opt = document.createElement('option');
                opt.value = item.site; opt.textContent = item.site;
                siteEl.appendChild(opt); siteEl.value = item.site;
            }

            document.getElementById('activityRowsContainer').innerHTML = '';
            _rowCounter = 0;

            // Reconstruct rows from civilActivities + interiorActivities (JSON columns)
            const civArr = Array.isArray(item.civilActivities)    ? item.civilActivities    : [];
            const intArr = Array.isArray(item.interiorActivities) ? item.interiorActivities : [];
            const allActs = [
                ...civArr.map(a => ({ main_activity: a.main_activity || a.activity, sub_activity: '', section: 'Civil',    skilled: a.skilled, unskilled: a.unskilled, note: a.note })),
                ...intArr.map(a => ({ main_activity: a.main_activity || a.activity, sub_activity: '', section: 'Interior', skilled: a.skilled, unskilled: a.unskilled, note: a.note }))
            ];
            // Fall back to DPR_Detail rows
            const detRows = Array.isArray(item.details) ? item.details : [];
            const rowsToLoad = allActs.length ? allActs : detRows.map(r => ({
                main_activity: r.activity || r.main_activity,
                sub_activity:  r.subActivity || '',
                section:       r.section || 'Civil',
                skilled:       r.skilled,
                unskilled:     r.unskilled,
                note:          r.note
            }));

            if (rowsToLoad.length) rowsToLoad.forEach(r => addActivityRow(r));
            else addActivityRow();

            closeDPRModal();
            switchTab('Form', document.getElementById('tabBtnForm'));
            showToast('✏️ Loaded for editing — click Generate DPR when done');
        }

        async function requestEditDPR(i) {
            const item = _history[i];
            if (!item || !_currentUser) return;
            if (!confirm('Request edit permission from Admin for this DPR?')) return;
            showToast('📤 Sending request...');
            try {
                await apiPost({ action: 'requestEditDPR', key: toYMD(item.date) + '||' + String(item.site).trim(), requestedBy: _currentUser.username });
                showToast('✅ Request sent!');
                loadHistory();
            } catch (e) { showToast('⚠️ Request failed'); }
        }

        async function approveEditDPR(key) {
            if (!confirm('Approve edit access for this DPR?')) return;
            showToast('⏳ Approving...');
            try {
                await apiPost({ action: 'approveEditDPR', key });
                showToast('✅ Edit access granted!');
                loadHistory();
            } catch (e) { showToast('⚠️ Approval failed'); }
        }

        function renderPendingEditRequests() {
            const el      = document.getElementById('pendingEditRequests');
            if (!el) return;
            const pending = _history.filter(item => item.editPermission === 'pending');
            if (!pending.length) {
                el.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:10px;">✅ No pending requests.</p>';
                return;
            }
            el.innerHTML = pending.map(item => {
                const key = toYMD(item.date) + '||' + String(item.site).trim();
                return `<div class="admin-user-row">
                    <div>
                        <div class="admin-user-info">📅 ${formatDate(toYMD(item.date))} &nbsp;·&nbsp; 📍 ${item.site || '—'}</div>
                        <div class="admin-user-sub">Requested by: <b>${item.requestedBy || '—'}</b></div>
                    </div>
                    <button class="btn-green btn-sm" style="width:auto;padding:6px 14px;" onclick="approveEditDPR('${key}')">✅ Approve</button>
                </div>`;
            }).join('');
        }

        /* ═══════════════════════════════════════════════════════════
           ADMIN PANEL
        ═══════════════════════════════════════════════════════════ */
        function renderAdminPanel() {
            renderAdminAnalytics();
            renderPendingEditRequests();
            renderAdminUsers();
            renderAdminProjects();
            renderAdminActivities();
        }

        // ── Users ───────────────────────────────────────────────────
        async function createUser() {
            const username    = document.getElementById('newUsername').value.trim();
            const displayName = document.getElementById('newDisplayName').value.trim();
            const password    = document.getElementById('newPassword').value.trim();
            const role        = document.getElementById('newRole').value;
            if (!username || !password) { showToast('⚠️ Username and password required'); return; }
            if (_users.find(u => u.username.toLowerCase() === username.toLowerCase())) { showToast('⚠️ Username already exists'); return; }
            showToast('⏳ Creating user...');
            try {
                const res = await apiPost({ action: 'createUser', username, displayName: displayName || username, password, role });
                if (res && res.error) { showToast('❌ ' + res.error); return; }
                // Refresh user list from server to pick up the new row
                const d = await apiFetch('getUsers').catch(() => []);
                if (Array.isArray(d)) _users = [SUPER_ADMIN, ...d];
                renderLoginChips(); renderAdminUsers();
                ['newUsername','newDisplayName','newPassword'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
                showToast('✅ User created successfully!');
            } catch (e) {
                showToast('❌ Network error: ' + e.message);
            }
        }

        async function deleteUser(username) {
            if (username === SUPER_ADMIN.username) return;
            if (!confirm(`Delete user "${username}"?`)) return;
            await apiPost({ action: 'deleteUser', username });
            const d = await apiFetch('getUsers').catch(() => []);
            if (Array.isArray(d)) _users = [SUPER_ADMIN, ...d];
            renderLoginChips(); renderAdminUsers();
            showToast('✅ User deleted!');
        }

        async function resetPassword(username) {
            const p = prompt(`New password for "${username}":`);
            if (!p || !p.trim()) return;
            await apiPost({ action: 'resetPassword', username, password: p.trim() });
            showToast('✅ Password updated!');
        }

        function renderAdminUsers() {
            const el = document.getElementById('adminUserList');
            if (!el) return;
            el.innerHTML = _users.map(u => {
                const sup = u.username === SUPER_ADMIN.username;
                const userDPRs = _history.filter(h => String(h.by).trim().toLowerCase() === u.username.trim().toLowerCase());
                const totalSubmitted = userDPRs.length;
                let lastSubDate = 'Never';
                let isInactive = false;
                
                if (totalSubmitted > 0) {
                    const times = userDPRs.map(h => {
                        const ymd = toYMD(h.date);
                        return ymd ? new Date(ymd).getTime() : 0;
                    }).filter(Boolean);
                    if (times.length) {
                        const maxTime = Math.max(...times);
                        const maxDate = new Date(maxTime);
                        const y = maxDate.getFullYear();
                        const m = String(maxDate.getMonth() + 1).padStart(2, '0');
                        const d = String(maxDate.getDate()).padStart(2, '0');
                        lastSubDate = `${d}-${m}-${y}`;
                        
                        const diffTime = Date.now() - maxTime;
                        const diffDays = diffTime / (1000 * 60 * 60 * 24);
                        if (diffDays >= 3) {
                            isInactive = true;
                        }
                    } else {
                        isInactive = true;
                    }
                } else {
                    isInactive = true;
                }
                
                const statusBadge = isInactive 
                    ? `<span style="background:#fee2e2;color:#ef4444;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-left:6px;display:inline-block;">⚠️ Inactive</span>`
                    : `<span style="background:#dcfce7;color:#10b981;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-left:6px;display:inline-block;">🟢 Active</span>`;

                return `<div class="admin-user-row" style="flex-direction:column;align-items:stretch;gap:4px;padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <span class="admin-user-info" style="font-size:14px;">👤 ${u.username}</span>
                            ${statusBadge}
                        </div>
                        <div style="display:flex;gap:6px;">
                            ${!sup ? `<button class="btn-gray btn-sm" style="width:auto;padding:4px 8px;margin:0;" onclick="resetPassword('${u.username}')" title="Reset Password">🔑</button>` : ''}
                            ${!sup ? `<button class="btn-red btn-sm"  style="width:auto;padding:4px 8px;margin:0;" onclick="deleteUser('${u.username}')" title="Delete User">🗑️</button>`
                                   : `<span style="font-size:11px;color:var(--muted);">Protected</span>`}
                        </div>
                    </div>
                    <div class="admin-user-sub" style="margin-top:4px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:4px;border-top:1px solid #f1f5f9;padding-top:6px;">
                        <div>Display: <b>${u.displayName || u.username}</b></div>
                        <div>Role: <b>${u.role === 'admin' ? 'Admin' : 'Supervisor'}</b></div>
                        <div>Total DPRs: <b>${totalSubmitted}</b></div>
                        <div>Last Upload: <b>${lastSubDate}</b></div>
                    </div>
                </div>`;
            }).join('');
        }

        // ── Projects ────────────────────────────────────────────────
        async function adminAddProject() {
            const name     = document.getElementById('newProjectName').value.trim();
            const parentId = document.getElementById('newProjectParent').value;
            if (!name) { showToast('⚠️ Enter a project name'); return; }
            showToast('⏳ Adding...');
            await apiPost({ action: 'addProject', project_name: name, parent_id: parentId || '' });
            const d = await apiFetch('getProjects').catch(() => _projects);
            if (Array.isArray(d)) _projects = d;
            populateSiteDropdown(); renderAdminProjects();
            document.getElementById('newProjectName').value = '';
            showToast('✅ Project added!');
        }

        async function toggleProject(id, curStatus) {
            const ns = curStatus === 'active' ? 'inactive' : 'active';
            await apiPost({ action: 'updateProject', id, status: ns });
            const d = await apiFetch('getProjects').catch(() => _projects);
            if (Array.isArray(d)) _projects = d;
            populateSiteDropdown(); renderAdminProjects();
            showToast(`✅ ${ns === 'active' ? 'Activated' : 'Deactivated'}!`);
        }

        async function editProjectName(id, cur) {
            const n = prompt('Edit project name:', cur);
            if (!n || n.trim() === cur) return;
            await apiPost({ action: 'updateProject', id, project_name: n.trim() });
            const d = await apiFetch('getProjects').catch(() => _projects);
            if (Array.isArray(d)) _projects = d;
            populateSiteDropdown(); renderAdminProjects();
            showToast('✅ Project renamed!');
        }

        async function deleteProject(id, name) {
            if (!confirm(`Are you sure you want to delete "${name}"?\nThis will permanently delete this project and all its sub-projects from the Google Sheet.`)) return;
            showToast('⏳ Deleting...');
            try {
                const res = await apiPost({ action: 'deleteProject', id });
                if (res.error) {
                    showToast('⚠️ Error: ' + res.error);
                } else {
                    showToast(`✅ Deleted project and child dependencies!`);
                    const d = await apiFetch('getProjects').catch(() => _projects);
                    if (Array.isArray(d)) _projects = d;
                    populateSiteDropdown();
                    renderAdminProjects();
                }
            } catch (e) {
                showToast('⚠️ Delete failed');
            }
        }

        function renderAdminProjects() {
            const el      = document.getElementById('adminProjectList');
            if (!el) return;
            const tops    = _projects.filter(p => (!p.parent_id || String(p.parent_id).trim() === ''));
            const parentSel = document.getElementById('newProjectParent');
            if (parentSel) {
                parentSel.innerHTML = '<option value="">— None (Top-level) —</option>' +
                    tops.filter(p => p.status === 'active')
                        .map(p => `<option value="${p.id}">${p.project_name}</option>`).join('');
            }
            if (!_projects.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:12px;">No projects yet.</p>'; return; }
            el.innerHTML = tops.map(proj => {
                const subs = _projects.filter(p => String(p.parent_id) === String(proj.id));
                const act  = proj.status === 'active';
                return `
                <div draggable="true" data-id="${proj.id}" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondrop="dropProject(event)" style="margin-bottom:12px;border:1.5px solid var(--border);border-radius:8px;overflow:hidden;cursor:move;">
                    <div style="background:#f8fafc;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                        <div>
                            <span style="font-weight:700;font-size:14px;color:var(--primary);">📍 ${proj.project_name}</span>
                            <span style="font-size:11px;margin-left:8px;color:${act ? '#38a169' : '#e53e3e'};">${act ? '🟢' : '🔴'}</span>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button class="btn-blue btn-sm" style="width:auto;padding:4px 8px;font-size:11px;"
                                    onclick="editProjectName('${proj.id}','${esc(proj.project_name)}')">✏️</button>
                            <button class="btn-red btn-sm" style="width:auto;padding:4px 8px;font-size:11px;background:#e53e3e;border-color:#e53e3e;"
                                    onclick="deleteProject('${proj.id}','${esc(proj.project_name)}')">ðŸ—‘ï¸</button>
                            <button class="${act ? 'btn-red' : 'btn-green'} btn-sm"
                                    style="width:auto;padding:4px 10px;font-size:11px;"
                                    onclick="toggleProject('${proj.id}','${proj.status}')">
                                ${act ? '🔴 Off' : '🟢 On'}
                            </button>
                        </div>
                    </div>
                    <div style="padding:6px 14px 8px;">
                        ${subs.length
                            ? subs.map(s => `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9;">
                                <span style="font-size:13px;${s.status !== 'active' ? 'color:var(--muted);text-decoration:line-through;' : ''}">↳ ${s.project_name}</span>
                                <div style="display:flex;gap:5px;">
                                    <button class="btn-blue btn-sm" style="width:auto;padding:2px 7px;font-size:11px;"
                                            onclick="editProjectName('${s.id}','${esc(s.project_name)}')">✏️</button>
                                    <button class="btn-red btn-sm" style="width:auto;padding:2px 7px;font-size:11px;background:#e53e3e;border-color:#e53e3e;"
                                            onclick="deleteProject('${s.id}','${esc(s.project_name)}')">ðŸ—‘ï¸</button>
                                    <button class="${s.status === 'active' ? 'btn-red' : 'btn-green'} btn-sm"
                                            style="width:auto;padding:2px 8px;font-size:11px;"
                                            onclick="toggleProject('${s.id}','${s.status}')">
                                        ${s.status === 'active' ? '🔴' : '🟢'}
                                    </button>
                                </div>
                            </div>`).join('')
                            : '<div style="color:var(--muted);font-size:12px;padding:4px 0 6px;">No sub-projects yet.</div>'}
                    </div>
                </div>`;
            }).join('');
        }

        async function toggleActivity(id, curStatus) {
            const ns = curStatus === 'active' ? 'inactive' : 'active';
            await apiPost({ action: 'updateActivity', id, status: ns });
            const d = await apiFetch('getActivities').catch(() => _activities);
            if (Array.isArray(d)) _activities = d;
            renderAdminActivities();
            showToast(`✅ ${ns === 'active' ? 'Activated' : 'Deactivated'}!`);
        }

        async function editActivityName(id, cur) {
            const n = prompt('Edit activity name:', cur);
            if (!n || n.trim() === cur) return;
            await apiPost({ action: 'updateActivity', id, activity_name: n.trim() });
            const d = await apiFetch('getActivities').catch(() => _activities);
            if (Array.isArray(d)) _activities = d;
            renderAdminActivities();
            showToast('✅ Activity renamed!');
        }

        async function deleteActivity(id, name) {
            if (!confirm(`Are you sure you want to delete "${name}"?\nThis will permanently delete this activity and all its sub-activities from the Google Sheet.`)) return;
            showToast('⏳ Deleting...');
            try {
                const res = await apiPost({ action: 'deleteActivity', id });
                if (res.error) {
                    showToast('⚠️ Error: ' + res.error);
                } else {
                    showToast(`✅ Deleted activity and child dependencies!`);
                    const d = await apiFetch('getActivities').catch(() => _activities);
                    if (Array.isArray(d)) _activities = d;
                    renderAdminActivities();
                }
            } catch (e) {
                showToast('⚠️ Delete failed');
            }
        }

        function renderAdminActivities() {
            const el    = document.getElementById('adminActivityList');
            if (!el) return;
            const mains = _activities.filter(a => (!a.parent_id || String(a.parent_id).trim() === ''));
            const parentSel = document.getElementById('subActivityParent');
            if (parentSel) {
                parentSel.innerHTML = '<option value="">— Select Main Activity —</option>' +
                    mains.filter(m => m.status === 'active')
                         .map(m => `<option value="${m.id}">${m.activity_name}</option>`).join('');
            }
            if (!mains.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:12px;">No activities yet.</p>'; return; }
            
            // Clean HTML5 drag-and-drop template
            el.innerHTML = mains.map(main => {
                // String-safe .trim() comparison handles numeric ids (78) and string ids ("78") equally
                const subs = _activities.filter(a => String(a.parent_id).trim() === String(main.id).trim());
                const act  = main.status === 'active';
                return `
                <div draggable="true" 
                     data-id="${main.id}" 
                     ondragstart="dragStartActivity(event)" 
                     ondragover="dragOverActivity(event)" 
                     ondragend="dragEndActivity(event)"
                     ondrop="dropActivity(event)" 
                     style="margin-bottom:12px;border:1.5px solid var(--border);border-radius:8px;overflow:hidden;cursor:move;transition:opacity 0.2s ease;">
                    <div style="background:#f8fafc;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                        <div>
                            <span style="font-weight:700;font-size:14px;color:var(--primary);">🔨 ${main.activity_name}</span>
                            <span style="font-size:11px;margin-left:8px;color:${act ? '#38a169' : '#e53e3e'};">${act ? '🟢' : '🔴'}</span>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button class="btn-blue btn-sm" style="width:auto;padding:4px 8px;font-size:11px;"
                                    onclick="editActivityName('${main.id}','${esc(main.activity_name)}')">✏️</button>
                            <button class="btn-red btn-sm" style="width:auto;padding:4px 8px;font-size:11px;background:#e53e3e;border-color:#e53e3e;"
                                    onclick="deleteActivity('${main.id}','${esc(main.activity_name)}')">🗑️</button>
                            <button class="${act ? 'btn-red' : 'btn-green'} btn-sm"
                                    style="width:auto;padding:4px 10px;font-size:11px;"
                                    onclick="toggleActivity('${main.id}','${main.status}')">
                                ${act ? '🔴 Off' : '🟢 On'}
                            </button>
                        </div>
                    </div>
                    <div style="padding:6px 14px 8px;">
                        ${subs.length
                            ? subs.map(s => `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9;">
                                <span style="font-size:13px;${s.status !== 'active' ? 'color:var(--muted);text-decoration:line-through;' : ''}">↳ ${s.activity_name}</span>
                                <div style="display:flex;gap:5px;">
                                    <button class="btn-blue btn-sm" style="width:auto;padding:2px 7px;font-size:11px;"
                                            onclick="editActivityName('${s.id}','${esc(s.activity_name)}')">✏️</button>
                                    <button class="btn-red btn-sm" style="width:auto;padding:2px 7px;font-size:11px;background:#e53e3e;border-color:#e53e3e;"
                                            onclick="deleteActivity('${s.id}','${esc(s.activity_name)}')">🗑️</button>
                                    <button class="${s.status === 'active' ? 'btn-red' : 'btn-green'} btn-sm"
                                            style="width:auto;padding:2px 8px;font-size:11px;"
                                            onclick="toggleActivity('${s.id}','${s.status}')">
                                        ${s.status === 'active' ? '🔴' : '🟢'}
                                    </button>
                                </div>
                            </div>`).join('')
                            : '<div style="color:var(--muted);font-size:12px;padding:4px 0 6px;">No sub-activities yet.</div>'}
                    </div>
                </div>`;
            }).join('');
        }

        // Project specific drag-and-drop (retained cleanly)
        let _draggedId = null;

        function dragStart(e) {
            _draggedId = e.currentTarget.getAttribute('data-id');
            e.dataTransfer.setData('text/plain', _draggedId);
            e.dataTransfer.effectAllowed = 'move';
        }

        function dragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }

        async function dropProject(e) {
            e.preventDefault();
            const targetId = e.currentTarget.getAttribute('data-id');
            if (!_draggedId || _draggedId === targetId) return;

            const tops = _projects.filter(p => (!p.parent_id || String(p.parent_id).trim() === ''));
            const draggedIdx = tops.findIndex(p => p.id === _draggedId);
            const targetIdx = tops.findIndex(p => p.id === targetId);

            if (draggedIdx !== -1 && targetIdx !== -1) {
                const [moved] = tops.splice(draggedIdx, 1);
                tops.splice(targetIdx, 0, moved);

                const newOrder = [];
                tops.forEach(top => {
                    newOrder.push(top.id);
                    const subs = _projects.filter(p => String(p.parent_id) === String(top.id));
                    subs.forEach(s => newOrder.push(s.id));
                });
                
                const sortedProjects = [];
                newOrder.forEach(id => {
                    const found = _projects.find(p => p.id === id);
                    if (found) sortedProjects.push(found);
                });
                _projects = sortedProjects;
                renderAdminProjects();
                
                await saveOrderToCloud('projects', newOrder);
            }
        }

        // Clean HTML5 drag-and-drop state trackers for Activities module
        let _draggedActivityId = null;

        function dragStartActivity(e) {
            _draggedActivityId = e.currentTarget.getAttribute('data-id');
            e.dataTransfer.setData('text/plain', _draggedActivityId);
            e.dataTransfer.effectAllowed = 'move';
            e.currentTarget.style.opacity = '0.4';
        }

        function dragOverActivity(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }

        function dragEndActivity(e) {
            e.currentTarget.style.opacity = '1';
        }

        function dropActivity(e) {
            e.preventDefault();
            // data-id attribute is always a string — coerce both sides with String() for safe comparison
            const targetId = String(e.currentTarget.getAttribute('data-id')).trim();
            if (!_draggedActivityId || _draggedActivityId === targetId) return;

            const mains = _activities.filter(a => !a.parent_id || String(a.parent_id).trim() === '');
            // String-coerce both sides so numeric JSON ids match string data-id attributes
            const draggedIdx = mains.findIndex(a => String(a.id).trim() === String(_draggedActivityId).trim());
            const targetIdx  = mains.findIndex(a => String(a.id).trim() === String(targetId).trim());

            if (draggedIdx === -1 || targetIdx === -1) {
                console.warn('dropActivity: could not find dragged or target item in mains list', { _draggedActivityId, targetId });
                return;
            }

            // Re-order mains array in memory
            const [moved] = mains.splice(draggedIdx, 1);
            mains.splice(targetIdx, 0, moved);

            // Build flat ordered ID list: each main followed by its subs
            const newOrder = [];
            mains.forEach(main => {
                newOrder.push(String(main.id));
                _activities
                    .filter(a => String(a.parent_id).trim() === String(main.id).trim())
                    .forEach(s => newOrder.push(String(s.id)));
            });

            // Reconstruct _activities in the new sequence (string-safe find)
            const sortedActivities = [];
            newOrder.forEach(id => {
                const found = _activities.find(a => String(a.id).trim() === id);
                if (found) sortedActivities.push(found);
            });
            _activities = sortedActivities;

            // Instant local re-render — UI is authoritative
            renderAdminActivities();

            // Fire-and-forget background sync
            saveActivityOrderDirect(newOrder);
        }

        function saveActivityOrderDirect(orderedIds) {
            // Always send the flat ordered-id string array the backend expects.
            // orderedIds[0] → sort_order 1, orderedIds[1] → sort_order 2, etc.
            const directUrl = 'https://script.google.com/macros/s/AKfycbzyjSPIlewC31HdvS0LQneOudT-gQ1h-qCs_1q_50U47nej9zGSFRyaW7QI91yvVk1PEw/exec';
            const payload = {
                action:     'updateSortOrder',
                type:       'activities',
                orderedIds: orderedIds.map(id => String(id))   // normalise to strings before sending
            };

            console.info('[ActivitySync] Firing background sort commit →', JSON.stringify(payload));

            // mode:'no-cors' → opaque response, fetch promise ALWAYS resolves,
            // never rejects on HTTP errors. UI is already authoritative; we never
            // show a toast or alert from this background transaction.
            fetch(directUrl, {
                method:  'POST',
                mode:    'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body:    JSON.stringify(payload)
            })
            .then(() => {
                console.info('[ActivitySync] Background sort commit handshake resolved (opaque — verify in Apps Script execution log).');
            })
            .catch(err => {
                console.warn('[ActivitySync] Network proxy metadata (non-blocking):', err);
            });
        }

        // Shared/Projects network sync
        async function saveOrderToCloud(type, orderedIds) {
            console.log(`Optimistic Update Triggered: Syncing sorted ${type} order to cloud in the background...`);
            const payload = {
                action: 'updateSortOrder',
                type: type,
                orderedIds: orderedIds
            };
            console.log("Reordering Sync Payload:", JSON.stringify(payload));
            
            fetch(SHEET_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`HTTP status ${response.status}`);
                }
                const resText = await response.text();
                console.log('Background sort order sync raw response text:', resText);
                
                const t = document.getElementById('toast');
                if (t) {
                    t.classList.remove('show');
                    t.textContent = '';
                    clearTimeout(t._tid);
                }
            })
            .catch(err => {
                console.warn('Background sort order sync failed silently (optimistic UI remains active):', err);
            });
        }

        if (typeof window !== "undefined") {
            window.dragStart = dragStart;
            window.dragOver = dragOver;
            window.dropProject = dropProject;
            window.dropActivity = dropActivity;
            window.dragStartActivity = dragStartActivity;
            window.dragOverActivity = dragOverActivity;
            window.dragEndActivity = dragEndActivity;
        }

        // ── Data Maintenance ────────────────────────────────────────
        async function runDataCleanup() {
            if (!confirm('This will delete rows with corrupted/shifted column data from DPR_Records and DPR_Detail. Proceed?')) return;
            showToast('🧹 Running cleanup...');
            try {
                const res = await apiPost({ action: 'cleanCorrupted' });
                const r   = res.cleaned || {};
                const rDel = (r.records || []).length;
                const dDel = (r.detail  || []).length;
                showToast(`✅ Cleaned ${rDel} Records + ${dDel} Detail rows`);
                loadHistory();
            } catch (e) { showToast('⚠️ Cleanup failed'); }
        }

        /* ═══════════════════════════════════════════════════════════
           DASHBOARD
        ═══════════════════════════════════════════════════════════ */
        function toggleDashboardAccordion(id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        }

        function setPeriod(p, btn) {
            _dashPeriod = p;
            document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            renderDashboard();
        }

        function renderDashboard() {
            if (!_history.length) return;
            const now  = new Date();
            const data = _history.filter(item => {
                const ymd = toYMD(item.date);
                if (!ymd || ymd.length < 10) return _dashPeriod === 'all';
                const [yr, mo, da] = ymd.split('-').map(Number);
                const d = new Date(yr, mo - 1, da);
                if (_dashPeriod === 'week') {
                    const day = now.getDay() || 7;
                    const mon = new Date(now); mon.setDate(now.getDate() - day + 1); mon.setHours(0,0,0,0);
                    return d >= mon;
                }
                if (_dashPeriod === 'month') return mo === now.getMonth() + 1 && yr === now.getFullYear();
                return true;
            });

            const totalW = data.reduce((a, i) => a + (Number(i.total) || 0), 0);
            const totalD = data.length;
            document.getElementById('dTotalWorkers').textContent = totalW;
            document.getElementById('dTotalDPR').textContent     = totalD;
            document.getElementById('dAvgWorkers').textContent   = totalD ? Math.round(totalW / totalD) : 0;
            document.getElementById('dActiveSites').textContent  = [...new Set(data.map(i => i.site).filter(Boolean))].length;

            // Map project name to project for lookup
            const projMap = {};
            _projects.forEach(p => { projMap[p.project_name] = p; });
            const projById = {};
            _projects.forEach(p => { projById[p.id] = p; });

            // Structure:
            // mainMap = {
            //   [mainName]: {
            //     total: 0,
            //     hasSubs: false,
            //     subs: {
            //       [subName]: { total: 0, activities: { [actName]: total } }
            //     }
            //   }
            // }
            const mainMap = {};
            
            data.forEach(item => {
                const siteName = item.site || 'Unknown';
                const p = projMap[siteName];
                let mainName = siteName;
                let subName = '';
                
                if (p) {
                    if (p.parent_id && projById[p.parent_id]) {
                        mainName = projById[p.parent_id].project_name;
                        subName = p.project_name;
                    }
                }
                
                if (!mainMap[mainName]) {
                    mainMap[mainName] = { total: 0, hasSubs: false, subs: {} };
                }
                
                mainMap[mainName].total += (Number(item.total) || 0);
                
                if (subName) {
                    mainMap[mainName].hasSubs = true;
                }
                
                if (!mainMap[mainName].subs[subName]) {
                    mainMap[mainName].subs[subName] = { total: 0, activities: {} };
                }
                mainMap[mainName].subs[subName].total += (Number(item.total) || 0);
                
                const details = Array.isArray(item.details) ? item.details : [];
                details.forEach(det => {
                    const actName = det.activity || 'Unknown';
                    const actTotal = (Number(det.total) || (Number(det.skilled) || 0) + (Number(det.unskilled) || 0));
                    mainMap[mainName].subs[subName].activities[actName] = 
                        (mainMap[mainName].subs[subName].activities[actName] || 0) + actTotal;
                });
            });

            const maxW = Math.max(...Object.values(mainMap).map(m => m.total), 1);
            let counter = 0;
            document.getElementById('siteBreakdown').innerHTML =
                Object.entries(mainMap)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([mainName, mainData]) => {
                        counter++;
                        const mainId = `db_main_${counter}`;
                        const w = mainData.total;
                        
                        let bodyHtml = '';
                        if (mainData.hasSubs) {
                            bodyHtml = Object.entries(mainData.subs)
                                .sort((a, b) => b[1].total - a[1].total)
                                .map(([subName, subData]) => {
                                    counter++;
                                    const subId = `db_sub_${counter}`;
                                    const subW = subData.total;
                                    const displayName = subName ? `↳ ${subName}` : `↳ General / Direct`;
                                    
                                    const actEntries = Object.entries(subData.activities)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([act, actW]) => `
                                        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0 4px 28px;font-size:12px;color:var(--muted);border-bottom:1px dashed #f1f5f9;">
                                            <span>${act}</span>
                                            <span style="font-weight:600;">${actW}</span>
                                        </div>`).join('') || '<div style="font-size:11px;color:var(--muted);padding-left:28px;">No activity details.</div>';
                                        
                                    return `
                                    <div style="margin-bottom:8px;border-bottom:1px solid #f1f5f9;padding-bottom:6px;">
                                        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;cursor:pointer;background:#f8fafc;border-radius:6px;transition:background 0.2s;"
                                             onclick="toggleDashboardAccordion('${subId}')"
                                             onmouseover="this.style.background='#f1f5f9'"
                                             onmouseout="this.style.background='#f8fafc'">
                                            <span style="font-size:13px;font-weight:600;color:var(--primary);">${displayName}</span>
                                            <span style="font-size:12px;font-weight:700;color:var(--muted);">${subW}</span>
                                        </div>
                                        <div id="${subId}" style="display:none;margin-top:4px;">
                                            ${actEntries}
                                        </div>
                                    </div>`;
                                }).join('');
                        } else {
                            const subData = mainData.subs[''] || { activities: {} };
                            bodyHtml = Object.entries(subData.activities)
                                .sort((a, b) => b[1] - a[1])
                                .map(([act, actW]) => `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0 4px 18px;font-size:12px;color:var(--muted);border-bottom:1px dashed #f1f5f9;">
                                    <span>↳ ${act}</span>
                                    <span style="font-weight:600;">${actW}</span>
                                </div>`).join('') || '<div style="font-size:11px;color:var(--muted);padding-left:18px;">No activity details.</div>';
                        }
                        
                        return `
                        <div style="margin-bottom:16px;background:#ffffff;border:1px solid var(--border);border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.02);">
                            <div class="site-row" 
                                 style="margin-bottom:0;background:transparent;border:none;padding:12px;cursor:pointer;transition:background 0.2s;"
                                 onclick="toggleDashboardAccordion('${mainId}')"
                                 onmouseover="this.parentElement.style.borderColor='var(--primary)'"
                                 onmouseout="this.parentElement.style.borderColor='var(--border)'">
                                <div style="font-size:14px;font-weight:700;flex:0 0 auto;max-width:55%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📍 ${mainName}</div>
                                <div class="bar-wrap"><div class="bar-fill" style="width:${Math.round(w / maxW * 100)}%"></div></div>
                                <div class="site-total" style="font-weight:700;">${w}</div>
                            </div>
                            <div id="${mainId}" style="display:none;padding:0 12px 12px;border-top:1px solid #f1f5f9;background:#fafbfc;">
                                <div style="margin-top:8px;">
                                    ${bodyHtml}
                                </div>
                            </div>
                        </div>`;
                    }).join('') ||
                    '<p style="color:#aaa;font-size:13px;text-align:center;">No data for this period</p>';
        }

        /* ═══════════════════════════════════════════════════════════
           DOWNLOADS
        ═══════════════════════════════════════════════════════════ */
        function downloadImage() {
            const rep = document.getElementById('report');
            if (rep.style.display === 'none') { showToast('⚠️ Generate DPR first'); return; }
            
            const oldWidth = rep.style.width;
            const oldColor = rep.style.color;
            const oldMaxW = rep.style.maxWidth;
            const oldShadow = rep.style.boxShadow;
            
            rep.style.width = '480px';
            rep.style.maxWidth = '480px';
            rep.style.color = '#000000';
            rep.style.boxShadow = 'none';
            
            const allItems = rep.querySelectorAll('.report-activity, .report-meta, .report-total');
            allItems.forEach(el => {
                el.style.pageBreakInside = 'avoid';
                el.style.breakInside = 'avoid';
            });
            
            showToast('⏳ Generating Image...');
            html2canvas(rep, {
                scale: 3.5,
                devicePixelRatio: 3.5,
                useCORS: true,
                allowTaint: false,
                backgroundColor: '#ffffff',
                logging: false,
                scrollX: 0,
                scrollY: -window.scrollY,
                onclone: function(clonedDoc) {
                    const canvas = clonedDoc.querySelector('canvas');
                    if (canvas) {
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = false;
                        ctx.webkitImageSmoothingEnabled = false;
                        ctx.mozImageSmoothingEnabled = false;
                    }
                }
            }).then(c => {
                rep.style.width = oldWidth;
                rep.style.maxWidth = oldMaxW;
                rep.style.color = oldColor;
                rep.style.boxShadow = oldShadow;
                
                const dataUrl = c.toDataURL('image/jpeg', 0.95);
                const a = document.createElement('a');
                a.download = `DPR_${document.getElementById('date').value}.jpg`;
                a.href = dataUrl;
                a.click();
                showToast('📷 Image Downloaded!');
            }).catch(err => {
                rep.style.width = oldWidth;
                rep.style.maxWidth = oldMaxW;
                rep.style.color = oldColor;
                rep.style.boxShadow = oldShadow;
                showToast('⚠️ Image generation failed');
            });
        }

        function downloadPDF() {
            const rep = document.getElementById('report');
            if (rep.style.display === 'none') { showToast('⚠️ Generate DPR first'); return; }
            
            const oldWidth = rep.style.width;
            const oldColor = rep.style.color;
            const oldMaxW = rep.style.maxWidth;
            const oldShadow = rep.style.boxShadow;
            
            rep.style.width = '480px';
            rep.style.maxWidth = '480px';
            rep.style.color = '#000000';
            rep.style.boxShadow = 'none';
            
            const allItems = rep.querySelectorAll('.report-activity, .report-meta, .report-total');
            allItems.forEach(el => {
                el.style.pageBreakInside = 'avoid';
                el.style.breakInside = 'avoid';
            });
            
            showToast('⏳ Generating PDF...');
            html2canvas(rep, {
                scale: 3.5,
                devicePixelRatio: 3.5,
                useCORS: true,
                allowTaint: false,
                backgroundColor: '#ffffff',
                logging: false,
                scrollX: 0,
                scrollY: -window.scrollY,
                onclone: function(clonedDoc) {
                    const canvas = clonedDoc.querySelector('canvas');
                    if (canvas) {
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = false;
                        ctx.webkitImageSmoothingEnabled = false;
                        ctx.mozImageSmoothingEnabled = false;
                    }
                }
            }).then(c => {
                rep.style.width = oldWidth;
                rep.style.maxWidth = oldMaxW;
                rep.style.color = oldColor;
                rep.style.boxShadow = oldShadow;
                
                const dataUrl = c.toDataURL('image/jpeg', 0.95);
                const { jsPDF } = window.jspdf;
                const imgWidth = c.width;
                const imgHeight = c.height;
                const pdf = new jsPDF({
                    orientation: 'portrait',
                    unit: 'px',
                    format: [imgWidth, imgHeight]
                });
                
                pdf.addImage(dataUrl, 'JPEG', 0, 0, imgWidth, imgHeight);
                pdf.save(`DPR_${document.getElementById('date').value}.pdf`);
                showToast('📄 PDF Downloaded!');
            }).catch(err => {
                rep.style.width = oldWidth;
                rep.style.maxWidth = oldMaxW;
                rep.style.color = oldColor;
                rep.style.boxShadow = oldShadow;
                showToast('⚠️ PDF generation failed');
            });
        }

        function copyWhats() {
            const rep = document.getElementById('report');
            if (rep.style.display === 'none') { showToast('⚠️ Generate DPR first'); return; }
            const text = rep.innerText.replace(/\n{3,}/g, '\n\n');
            navigator.clipboard.writeText(text)
                .then(() => showToast('💬 Copied for WhatsApp!'))
                .catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text; document.body.appendChild(ta);
                    ta.select(); document.execCommand('copy');
                    document.body.removeChild(ta);
                    showToast('💬 Copied!');
                });
        }

        /* ═══════════════════════════════════════════════════════════
           WINDOW EXPORTS (for onclick= handlers in HTML)
        ═══════════════════════════════════════════════════════════ */

        /* ══ INIT ══ */
        if (typeof window !== "undefined") {
            const runInit = () => {
                renderLoginChips();
                try {
                    const s = sessionStorage.getItem('dprUser');
                    if (s) { _currentUser = JSON.parse(s); showApp(); }
                } catch (e) { }

                // Set Date cleanly
                const dateEl = document.getElementById('date');
                if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];

                window.addEventListener('offline', () => { document.getElementById('offlineBadge').style.display = 'block'; });
                window.addEventListener('online', () => { document.getElementById('offlineBadge').style.display = 'none'; syncOfflineQueue(); });
                if (!navigator.onLine) document.getElementById('offlineBadge').style.display = 'block';
            };

            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                runInit();
            } else {
                window.addEventListener('load', runInit);
            }

            // Delegate listeners
            document.addEventListener('click', () => {
                if (window.closeAllHistoryDropdowns) {
                    window.closeAllHistoryDropdowns();
                }
            });
            
            document.addEventListener('input', (e) => {
                if (!e.target.closest('#tabForm')) return;
                if (e.target.classList.contains('skill') || e.target.classList.contains('unskill')) {
                    const row = e.target.closest('.activitybox');
                    if (row) {
                        const sk = Math.max(0, Number(row.querySelector('.skill')?.value) || 0);
                        const un = Math.max(0, Number(row.querySelector('.unskill')?.value) || 0);
                        const valEl = row.querySelector('.row-total-val');
                        if (valEl) valEl.textContent = sk + un;
                    }
                }
                saveFormDraft();
            });

            document.addEventListener('change', (e) => {
                if (!e.target.closest('#tabForm')) return;
                saveFormDraft();
            });

            const loginBtn = document.getElementById('loginSubmitBtn');
            if (loginBtn) {
                loginBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    doLogin();
                });
                // touchend fires immediately on iOS without the 300ms delay
                loginBtn.addEventListener('touchend', function(e) {
                    e.preventDefault();   // cancel the subsequent ghost click
                    doLogin();
                }, { passive: false });
            }

            // ── Also wire Enter key on username field (mobile keyboards) ─────────
            const loginNameEl = document.getElementById('loginName');
            if (loginNameEl) {
                loginNameEl.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        document.getElementById('loginPass')?.focus();
                    }
                });
            }
        }
    // -- Attach functions to window --

    window.toYMD = toYMD;
    window.formatDate = formatDate;
    window.sameDate = sameDate;
    window.esc = esc;
    window.isCivilActivity = isCivilActivity;
    window.toTitleCase = toTitleCase;
    window.detectSection = detectSection;
    window.getSiteDisplayName = getSiteDisplayName;
    window.showToast = showToast;
    window.bootApp = bootApp;
    window.renderLoginChips = renderLoginChips;
    window.doLogin = doLogin;
    window.doLogout = doLogout;
    window.showApp = showApp;
    window.switchTab = switchTab;
    window.resetAndSwitchToForm = resetAndSwitchToForm;
    window.getLocalTodayYMD = getLocalTodayYMD;
    window.populateSearchSiteDropdown = populateSearchSiteDropdown;
    window.populateSiteDropdown = populateSiteDropdown;
    window.mainActivities = mainActivities;
    window.subActivitiesOf = subActivitiesOf;
    window.resetForm = resetForm;
    window.addActivityRow = addActivityRow;
    window.removeActivityRow = removeActivityRow;
    window.onMainActChange = onMainActChange;
    window.collectActivityRows = collectActivityRows;
    window.generate = generate;
    window.renderSection = renderSection;
    window.saveToCloud = saveToCloud;
    window.syncOfflineQueue = syncOfflineQueue;
    window.loadHistory = loadHistory;
    window.updateHistoryCount = updateHistoryCount;
    window.toggleHistoryDropdown = toggleHistoryDropdown;
    window.closeAllHistoryDropdowns = closeAllHistoryDropdowns;
    window.getReportHtmlForRecord = getReportHtmlForRecord;
    window.downloadHistoryDPR = downloadHistoryDPR;
    window.getSkeletonLoader = getSkeletonLoader;
    window.updateFormTotals = updateFormTotals;
    window.saveFormDraft = saveFormDraft;
    window.loadFormDraft = loadFormDraft;
    window.exportMasterLogCSV = exportMasterLogCSV;
    window.populateSupervisorDropdown = populateSupervisorDropdown;
    window.resetHistoryPageAndRender = resetHistoryPageAndRender;
    window.changeHistoryPage = changeHistoryPage;
    window.renderAdminAnalytics = renderAdminAnalytics;
    window.renderHistory = renderHistory;
    window.clearHistoryFilter = clearHistoryFilter;
    window.openDPR = openDPR;
    window.closeDPRModal = closeDPRModal;
    window.deleteDPR = deleteDPR;
    window.editDPR = editDPR;
    window.requestEditDPR = requestEditDPR;
    window.approveEditDPR = approveEditDPR;
    window.renderPendingEditRequests = renderPendingEditRequests;
    window.renderAdminPanel = renderAdminPanel;
    window.createUser = createUser;
    window.deleteUser = deleteUser;
    window.resetPassword = resetPassword;
    window.renderAdminUsers = renderAdminUsers;
    window.adminAddProject = adminAddProject;
    window.toggleProject = toggleProject;
    window.editProjectName = editProjectName;
    window.deleteProject = deleteProject;
    window.renderAdminProjects = renderAdminProjects;
    window.editActivityName = editActivityName;
    window.deleteActivity = deleteActivity;
    window.renderAdminActivities = renderAdminActivities;
    window.dragStart = dragStart;
    window.dragOver = dragOver;
    window.dropProject = dropProject;
    window.dragStartActivity = dragStartActivity;
    window.dragOverActivity = dragOverActivity;
    window.dragEndActivity = dragEndActivity;
    window.dropActivity = dropActivity;
    window.saveActivityOrderDirect = saveActivityOrderDirect;
    window.saveOrderToCloud = saveOrderToCloud;
    window.runDataCleanup = runDataCleanup;
    window.toggleDashboardAccordion = toggleDashboardAccordion;
    window.setPeriod = setPeriod;
    window.renderDashboard = renderDashboard;
    window.downloadImage = downloadImage;
    window.downloadPDF = downloadPDF;
    window.copyWhats = copyWhats;

    // -- Bootstrap: restore session and fetch users --
    setTimeout(() => {
      if (typeof fetchUsersFromCloud === 'function') fetchUsersFromCloud();
      try {
        const s = sessionStorage.getItem('dprUser');
        if (s && typeof showApp === 'function') {
          window._currentUser = JSON.parse(s);
          showApp();
        }
      } catch (e) {}
    }, 600);

    function toggleAdminAccordion(el) {
      const body = el.nextElementSibling;
      body.classList.toggle('open');
      const icon = el.querySelector('.aci');
      if (icon) {
        icon.textContent = body.classList.contains('open') ? '▼' : '▶';
      }
    }
    window.toggleAdminAccordion = toggleAdminAccordion;

  }, []);

  return (
    <>
      {/* ── LOGIN ──────────────────────────────────────────────────â”€ */}
      <div id="loginOverlay">
        <div className="login-box">
          <div className="login-logo">📋 DPR — Man Power Report</div>
          <div className="login-sub">Trimandir Construction Project</div>
          <label style={{ textAlign: 'left' }}>Username</label>
          <input
            type="text"
            id="loginName"
            placeholder="Enter username"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
          />
          <label style={{ textAlign: 'left' }}>Password</label>
          <input
            type="password"
            id="loginPass"
            placeholder="Enter password"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter') window.doLogin();
            }}
          />
          <button
            className="btn-green"
            id="loginSubmitBtn"
            style={{ marginTop: '6px' }}
            onClick={() => window.doLogin()}
          >
            Sign In →
          </button>
          <div className="login-err" id="loginErr"></div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '16px', textAlign: 'center' }}>
            Please sign in to continue
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'rgba(255,255,255,.55)', fontSize: '11px', marginBottom: '8px' }}>
            — Quick Select —
          </div>
          <div className="user-chips" id="userChips"></div>
        </div>
      </div>

      {/* ── HEADER ──────────────────────────────────────────────────â”€ */}
      <div className="header-wrap">
        <div>
          <div className="logo">📋 MAN POWER REPORT</div>
          <div className="sub">Trimandir Construction Project</div>
        </div>
        <div className="header-right">
          <div className="header-user" id="headerUser"></div>
          <button className="btn-signout" onClick={() => window.doLogout()}>
            Sign Out
          </button>
        </div>
      </div>

      <div id="offlineBadge">âš ï¸ Offline Mode — data will sync on reconnect</div>

      {/* ── TABS ──────────────────────────────────────────────────── */}
      <div className="tab-bar">
        <button
          className="tab-btn active"
          id="tabBtnForm"
          onClick={(e) => window.resetAndSwitchToForm(e.currentTarget)}
        >
          ðŸ“ New DPR
        </button>
        <button
          className="tab-btn"
          id="tabBtnHistory"
          onClick={(e) => window.switchTab('History', e.currentTarget)}
        >
          ðŸ“ History
        </button>
        <button
          className="tab-btn"
          id="tabBtnDashboard"
          onClick={(e) => window.switchTab('Dashboard', e.currentTarget)}
        >
          📊 Dashboard
        </button>
        <button
          className="tab-btn"
          id="adminTabBtn"
          onClick={(e) => window.switchTab('Admin', e.currentTarget)}
          style={{ display: 'none' }}
        >
          ⚙️ Admin
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
           NEW DPR FORM
          ═══════════════════════════════════════════════════════════════ */}
      <div className="tab-page active" id="tabForm">
        <div className="card">
          <div className="section-title">ðŸ“… Date &amp; Site</div>
          <label>Date</label>
          <input type="date" id="date" />
          <label>Site / Project</label>
          <select id="site">
            <option value="">⌛ Loading projects...</option>
          </select>
        </div>

        <div className="card">
          <div className="section-title">📋 Work Activities</div>
          <div id="activityRowsContainer"></div>
          <button
            className="btn-add"
            onClick={() => window.addActivityRow()}
            style={{ marginTop: '6px' }}
          >
            + Add Activity Row
          </button>
        </div>

        <button className="btn-green" onClick={() => window.generate()}>
          ✅ Generate DPR
        </button>
        <div className="btn-group">
          <button className="btn-blue" onClick={() => window.downloadImage()}>
            ðŸ“· Download Image
          </button>
          <button className="btn-blue" onClick={() => window.downloadPDF()}>
            ðŸ“„ Download PDF
          </button>
        </div>
        <button className="btn-wa" onClick={() => window.copyWhats()}>
          ðŸ’¬ Copy for WhatsApp
        </button>

        <div id="report" style={{ display: 'none' }}>
          <h3>DPR — MAN POWER REPORT</h3>
          <div className="report-meta" id="rdate"></div>
          <div id="rcivil"></div>
          <div id="rmanpower"></div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
           HISTORY TAB
          ═══════════════════════════════════════════════════════════════ */}
      <div className="tab-page" id="tabHistory" style={{ display: 'none' }}>
        <div className="card">
          <div className="section-title">ðŸ“ DPR History</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label>Start Date</label>
              <input
                type="date"
                id="searchStartDate"
                onChange={() => window.resetHistoryPageAndRender()}
                style={{ marginBottom: 0 }}
              />
            </div>
            <div>
              <label>End Date</label>
              <input
                type="date"
                id="searchEndDate"
                onChange={() => window.resetHistoryPageAndRender()}
                style={{ marginBottom: 0 }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label>Site / Project</label>
              <select
                id="searchSite"
                onChange={() => window.resetHistoryPageAndRender()}
                style={{ marginBottom: 0 }}
              >
                <option value="">— Show All Sites —</option>
              </select>
            </div>
            <div>
              <label>Supervisor</label>
              <select
                id="searchSupervisor"
                onChange={() => window.resetHistoryPageAndRender()}
                style={{ marginBottom: 0 }}
              >
                <option value="">— Show All Supervisors —</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              className="btn-blue btn-sm"
              onClick={() => window.loadHistory()}
              style={{ flex: 1 }}
            >
              🔄 Refresh
            </button>
            <button
              className="btn-gray btn-sm"
              onClick={() => window.clearHistoryFilter()}
              style={{ flex: 1 }}
            >
              ❌ Clear Filter
            </button>
          </div>

          <div id="historyCount" style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', marginBottom: '8px' }}></div>
          <div id="historyList">
            <p style={{ color: '#aaa', textAlign: 'center', padding: '16px' }}>⏳ Loading...</p>
          </div>

          <div
            id="historyPagination"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '14px',
              borderTop: '1px solid var(--border)',
              paddingTop: '12px'
            }}
          >
            <button
              id="btnPrevPage"
              className="btn-blue btn-sm"
              style={{ width: 'auto', margin: 0 }}
              onClick={() => window.changeHistoryPage(-1)}
            >
              ◀ Previous
            </button>
            <span id="historyPageIndicator" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>
              Page 1 of 1
            </span>
            <button
              id="btnNextPage"
              className="btn-blue btn-sm"
              style={{ width: 'auto', margin: 0 }}
              onClick={() => window.changeHistoryPage(1)}
            >
              Next ▶
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
           DASHBOARD TAB
          ═══════════════════════════════════════════════════════════════ */}
      <div className="tab-page" id="tabDashboard" style={{ display: 'none' }}>
        <div className="card">
          <div className="section-title">📊 Summary Dashboard</div>
          <div className="period-tabs">
            <button className="period-tab active" onClick={(e) => window.setPeriod('week', e.currentTarget)}>
              This Week
            </button>
            <button className="period-tab" onClick={(e) => window.setPeriod('month', e.currentTarget)}>
              This Month
            </button>
            <button className="period-tab" onClick={(e) => window.setPeriod('all', e.currentTarget)}>
              All Time
            </button>
          </div>
          <div className="dash-grid">
            <div className="dash-stat">
              <div className="num" id="dTotalWorkers">—</div>
              <div className="lbl">Total Workers</div>
            </div>
            <div className="dash-stat">
              <div className="num" id="dTotalDPR">—</div>
              <div className="lbl">Total DPRs</div>
            </div>
            <div className="dash-stat">
              <div className="num" id="dAvgWorkers">—</div>
              <div className="lbl">Avg / Day</div>
            </div>
            <div className="dash-stat">
              <div className="num" id="dActiveSites">—</div>
              <div className="lbl">Active Sites</div>
            </div>
          </div>
          <div className="section-title" style={{ marginTop: '4px' }}>
            📍 Site-wise Manpower
          </div>
          <div id="siteBreakdown">
            <p style={{ color: '#aaa', fontSize: '13px' }}>Load history first</p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
           ADMIN TAB
          ═══════════════════════════════════════════════════════════════ */}
      <div className="tab-page" id="tabAdmin" style={{ display: 'none' }}>
        {/* Analytics Dashboard */}
        <div className="card" style={{ marginBottom: '12px' }}>
          <div className="section-title">📊 Admin Analytics Dashboard</div>
          <div
            className="dash-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '10px', marginBottom: '12px' }}
          >
            <div className="dash-stat" style={{ padding: '12px 8px' }}>
              <div className="num" id="adminWorkforceToday" style={{ fontSize: '24px' }}>
                0
              </div>
              <div className="lbl">Workforce Today</div>
            </div>
            <div className="dash-stat" style={{ padding: '12px 8px' }}>
              <div
                className="num"
                id="adminActiveSite"
                style={{
                  fontSize: '14px',
                  wordBreak: 'break-all',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700
                }}
              >
                —
              </div>
              <div className="lbl">Most Active Site</div>
            </div>
            <div className="dash-stat" style={{ padding: '12px 8px' }}>
              <div className="num" id="adminProjectRatio" style={{ fontSize: '24px' }}>
                0/0
              </div>
              <div className="lbl">Active Projects</div>
            </div>
          </div>
          <button
            className="btn-green"
            onClick={() => window.exportMasterLogCSV()}
            style={{
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontSize: '13px',
              padding: '10px 14px'
            }}
          >
            📥 Export Master Log (CSV)
          </button>
        </div>

        {/* Pending edit requests */}
        <div className="card" style={{ marginBottom: '12px' }}>
          <div className="section-title">✏️ Pending Edit Requests</div>
          <div id="pendingEditRequests">
            <p style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '10px' }}>
              ✅ No pending requests.
            </p>
          </div>
        </div>

        {/* Data Maintenance */}
        <div className="admin-acc-card">
          <div
            className="admin-acc-header"
            onClick={(e) => window.toggleAdminAccordion(e.currentTarget)}
          >
            <span>🔗 Data Maintenance</span>
            <span className="aci admin-acc-icon">▶</span>
          </div>
          <div className="admin-acc-body">
            <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '14px' }}>
              Remove rows with corrupted or shifted column data from DPR_Records and DPR_Detail. This targets rows
              where the Date column (Col A) is blank or contains a non-date value.
            </p>
            <button
              className="btn-red"
              onClick={() => window.runDataCleanup()}
              style={{ marginBottom: 0 }}
            >
              🧹 Clean Corrupted Rows
            </button>
          </div>
        </div>

        {/* Users */}
        <div className="admin-acc-card">
          <div
            className="admin-acc-header"
            onClick={(e) => window.toggleAdminAccordion(e.currentTarget)}
          >
            <span>⚙️ Create / Manage Users</span>
            <span className="aci admin-acc-icon">▼</span>
          </div>
          <div className="admin-acc-body open">
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid var(--border)',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '14px'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)', marginBottom: '10px' }}>
                ➕ Create New User
              </div>
              <label>Username</label>
              <input type="text" id="newUsername" placeholder="e.g. site-manager-01" />
              <label>Display Name</label>
              <input type="text" id="newDisplayName" placeholder="e.g. Ramesh Patel" />
              <label>Password</label>
              <input type="text" id="newPassword" placeholder="Set a password" />
              <label>Role</label>
              <select id="newRole">
                <option value="user">User — Can create &amp; view DPRs</option>
                <option value="admin">Admin — Full access + Management</option>
              </select>
              <button className="btn-green" onClick={() => window.createUser()}>
                ✅ Create User
              </button>
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)', marginBottom: '4px' }}>
              👥 All Users
            </div>
            <div className="admin-list-scroll" id="adminUserList"></div>
          </div>
        </div>

        {/* Projects */}
        <div className="admin-acc-card">
          <div
            className="admin-acc-header"
            onClick={(e) => window.toggleAdminAccordion(e.currentTarget)}
          >
            <span>📍 Manage Projects &amp; Sub-Projects</span>
            <span className="aci admin-acc-icon">▶</span>
          </div>
          <div className="admin-acc-body">
            <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '14px' }}>
              Only <b>active</b> projects appear in the DPR form.
            </p>
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid var(--border)',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '14px'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)', marginBottom: '10px' }}>
                ➕ Add Project
              </div>
              <label>Parent Project (blank = top-level)</label>
              <select id="newProjectParent">
                <option value="">— None (Top-level) —</option>
              </select>
              <label>Project Name</label>
              <input type="text" id="newProjectName" placeholder="e.g. New Hospital Wing" />
              <button className="btn-green" onClick={() => window.adminAddProject()}>
                ✅ Add Project
              </button>
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)', marginBottom: '4px' }}>
              📋 All Projects
            </div>
            <div className="admin-list-scroll" style={{ maxHeight: '360px' }} id="adminProjectList">
              <p style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '12px' }}>
                Loading...
              </p>
            </div>
          </div>
        </div>

        {/* Activities */}
        <div className="admin-acc-card">
          <div
            className="admin-acc-header"
            onClick={(e) => window.toggleAdminAccordion(e.currentTarget)}
          >
            <span>📋 Manage Activities &amp; Sub-Activities</span>
            <span className="aci admin-acc-icon">▶</span>
          </div>
          <div className="admin-acc-body">
            <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '14px' }}>
              Main Activities = work categories (e.g. RCC Work). Sub-Activities = specific tasks (e.g. Steel work).
              Selecting a Main Activity dynamically loads its Sub-Activities in the form.
            </p>
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid var(--border)',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '12px'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)', marginBottom: '10px' }}>
                ➕ Add Main Activity
              </div>
              <label>Category Name</label>
              <input type="text" id="newMainActivityName" placeholder="e.g. MEP Work" />
              <button className="btn-green" onClick={() => window.adminAddMainActivity()}>
                ✅ Add Category
              </button>
            </div>
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid var(--border)',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '14px'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)', marginBottom: '10px' }}>
                ➕ Add Sub-Activity
              </div>
              <label>Parent Main Activity</label>
              <select id="subActivityParent">
                <option value="">— Select Main Activity —</option>
              </select>
              <label>Sub-Activity Name</label>
              <input type="text" id="newSubActivityName" placeholder="e.g. Panel Wiring" />
              <button className="btn-green" onClick={() => window.adminAddSubActivity()}>
                ✅ Add Sub-Activity
              </button>
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)', marginBottom: '4px' }}>
              📊 All Activities
            </div>
            <div className="admin-list-scroll" style={{ maxHeight: '480px' }} id="adminActivityList">
              <p style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '12px' }}>
                Loading...
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
           DPR VIEW MODAL
          ═══════════════════════════════════════════════════════════════ */}
      <div id="dprModal" onClick={(e) => { if (e.target === e.currentTarget) window.closeDPRModal(); }}>
        <div className="modal-box">
          <div className="modal-header">
            <h3>📊 DPR — Man Power Report</h3>
            <button className="modal-close" onClick={() => window.closeDPRModal()}>
              ✕
            </button>
          </div>
          <div className="modal-body" id="dprModalBody"></div>
        </div>
      </div>

      <div id="toast"></div>
      <footer>© 2026 Trimandir Construction Project | Trimandir Site DPR</footer>
    </>
  );
}