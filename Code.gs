// ================================================================
// Trimandir DPR — Google Apps Script Backend (Code.gs)
// STRICT SCHEMA — matching exact spreadsheet column layout
// FOR CIVIL WORKS ONLY
//
// DPR_Records (A→K):
//   A=Date  B=Site  C=Prepared By  D=Activity Details  E=Total Manpower
//   F=Last Updated  G=submittedAt  H=editPermission  I=requestedBy
//   J=activities(JSON)  K=SiteCondition
//
// DPR_Detail (A→J):
//   A=Date  B=Site  C=Section  D=Activity  E=Skilled  F=Unskilled
//   G=Total  H=Note  I=Prepared By  J=Timestamp
//
// Projects  (A→D): id | project_name | parent_id | status
// Activities(A→D): id | activity_name | parent_id | status
// Users     (A→D): username | displayName | password | role
// ================================================================

var SHEET_RECORDS    = 'DPR_Records';
var SHEET_DETAIL     = 'DPR_Detail';
var SHEET_USERS      = 'Users';
var SHEET_PROJECTS   = 'Projects';
var SHEET_ACTIVITIES = 'Activities';

// ── Exact header rows written when sheets are first created ──────
// RECORDS: A  B     C            D                  E               F             G             H                I             J
var RECORDS_HEADERS  = ['Date','Site','Prepared By','Activity Details','Total Manpower','Last Updated','submittedAt','editPermission','requestedBy','civilActivities','SiteCondition'];
// DETAIL: A      B      C         D          E         F           G       H      I            J
var DETAIL_HEADERS   = ['Date','Site','Section','Activity','Skilled','Unskilled','Total','Note','Prepared By','Timestamp'];
var USER_HEADERS     = ['username','displayName','password','role'];
var PROJECT_HEADERS  = ['id', 'main_project_name', 'sub_project_name', 'parent_id', 'status', 'sort_order'];
var ACTIVITY_HEADERS = ['id', 'main_category_name', 'sub_category_name', 'parent_id', 'status', 'sort_order'];

// ── Fixed column indexes (0-based) for DPR_Records ──────────────
var REC = {
  date:               0,   // A
  site:               1,   // B
  preparedBy:         2,   // C
  activityDetails:    3,   // D
  totalManpower:      4,   // E
  lastUpdated:        5,   // F
  submittedAt:        6,   // G
  editPermission:     7,   // H
  requestedBy:        8,   // I
  civilActivities:    9,   // J
  siteCondition:      10   // K
};

// ── Fixed column indexes (0-based) for DPR_Detail ───────────────
var DET = {
  date:       0,   // A
  site:       1,   // B
  section:    2,   // C
  activity:   3,   // D
  skilled:    4,   // E
  unskilled:  5,   // F
  total:      6,   // G
  note:       7,   // H
  preparedBy: 8,   // I
  timestamp:  9    // J
};

// ── ROUTER ───────────────────────────────────────────────────────

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  if (action === 'getUsers')      return handleGetUsers();
  if (action === 'getProjects')   return handleGetProjects();
  if (action === 'getActivities') return handleGetActivities();
  if (action === 'debug')         return handleDebug();
  return handleGetDPRs();
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonResponse({ error: 'Invalid JSON' }); }

  switch (body.action) {
    case 'login':            return handleLogin(body);
    case 'createUser':       return handleCreateUser(body);
    case 'deleteUser':       return handleDeleteUser(body);
    case 'resetPassword':    return handleResetPassword(body);
    case 'saveDPR':          return handleSaveDPR(body);
    case 'editDPR':          return handleEditDPR(body);
    case 'delete':           return handleDeleteDPR(body);
    case 'requestEditDPR':   return handleRequestEditDPR(body);
    case 'approveEditDPR':   return handleApproveEditDPR(body);
    case 'addProject':       return handleAddProject(body);
    case 'updateProject':    return handleUpdateProject(body);
    case 'deleteProject':    return handleDeleteProject(body);
    case 'addActivity':      return handleAddActivity(body);
    case 'updateActivity':   return handleUpdateActivity(body);
    case 'deleteActivity':   return handleDeleteActivity(body);
    case 'cleanCorrupted':   return handleCleanCorrupted(body);
    case 'updateSortOrder':  return handleUpdateSortOrder(body);
    default:                 return jsonResponse({ error: 'Unknown action: ' + body.action });
  }
}

// ── UTILITY: Date normalisation ──────────────────────────────────
// Always returns 'YYYY-MM-DD' string, handles Date objects (IST-safe),
// Excel serials, ISO strings, DD-MM-YYYY, DD/MM/YYYY, blank/null/undefined.

function normDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    try { return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
    catch (e) {
      var y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
      return y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    }
  }
  var s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);
  if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(s)) {
    var p = s.split(/[-\/]/);
    return p[2] + '-' + String(p[1]).padStart(2,'0') + '-' + String(p[0]).padStart(2,'0');
  }
  var n = Number(s);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    var d2 = new Date(Math.round((n - 25569) * 86400 * 1000));
    return d2.getUTCFullYear() + '-' +
           String(d2.getUTCMonth() + 1).padStart(2,'0') + '-' +
           String(d2.getUTCDate()).padStart(2,'0');
  }
  return s;
}

// Safely stringify any value (for JSON columns)
function toJsonStr(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return ''; }
}

// Safely parse JSON (returns [] on failure)
function parseJsonArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { var r = JSON.parse(String(v)); return Array.isArray(r) ? r : []; }
  catch (e) { return []; }
}

// ── UTILITY: Flexible header reader (for legacy/unknown sheets) ──
function normalizeKey(raw) {
  var s = String(raw || '').trim().toLowerCase()
            .replace(/[\s\-\/\\]+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
  var map = {
    'date': 'date',
    'site': 'site', 'project': 'site', 'location': 'site',
    'prepared_by': 'preparedBy', 'preparedby': 'preparedBy',
    'by': 'preparedBy', 'filled_by': 'preparedBy', 'submittedby': 'preparedBy',
    'activity_details': 'activityDetails', 'activitydetails': 'activityDetails',
    'activities': 'activityDetails', 'work_summary': 'activityDetails',
    'total_manpower': 'totalManpower', 'totalmanpower': 'totalManpower',
    'total': 'totalManpower', 'manpower': 'totalManpower', 'workers': 'totalManpower',
    'last_updated': 'lastUpdated', 'lastupdated': 'lastUpdated',
    'editedat': 'lastUpdated', 'edited_at': 'lastUpdated',
    'submittedat': 'submittedAt', 'submitted_at': 'submittedAt', 'timestamp': 'timestamp',
    'editpermission': 'editPermission', 'edit_permission': 'editPermission',
    'requestedby': 'requestedBy', 'requested_by': 'requestedBy',
    'civilactivities': 'civilActivities', 'civil_activities': 'civilActivities',
    'sitecondition': 'siteCondition', 'site_condition': 'siteCondition', 'weather': 'siteCondition',
    'section': 'section',
    'activity': 'activity', 'activity_name': 'activity', 'task': 'activity',
    'main_activity': 'activity', 'mainactivity': 'activity',
    'sub_activity': 'subActivity', 'subactivity': 'subActivity',
    'skilled': 'skilled', 'skilled_workers': 'skilled',
    'unskilled': 'unskilled', 'unskilled_workers': 'unskilled',
    'note': 'note', 'notes': 'note', 'remark': 'note', 'remarks': 'note',
    'username': 'username',
    'displayname': 'displayName', 'display_name': 'displayName', 'name': 'displayName',
    'password': 'password',
    'role': 'role',
    'id': 'id',
    'project_name': 'project_name', 'projectname': 'project_name',
    'activity_name2': 'activity_name', 'activityname': 'activity_name',
    'parent_id': 'parent_id', 'parentid': 'parent_id',
    'status': 'status',
    'main_category_name': 'main_category_name',
    'sub_category_name': 'sub_category_name',
    'main_project_name': 'main_project_name',
    'sub_project_name': 'sub_project_name',
  };
  return map[s] !== undefined ? map[s] : s;
}

// ── HELPERS ──────────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getOrCreateSheet(name, headers) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  // Always guarantee headers exist — safe even if sheet existed with no headers
  if (headers && headers.length) {
    ensureHeaders(sheet, headers);
  }
  return sheet;
}

// ── ONE-SHOT HEADER REPAIR ────────────────────────────────────────
// Run this ONCE from the Apps Script editor to fix any sheet that has
// data written into Row 1 (missing headers). It inserts a blank Row 1
// and writes the correct headers, pushing all data down safely.
function repairAllSheetHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var repairs = [];

  function repairSheet(sheetName, headers, bgColor) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      repairs.push(sheetName + ': CREATED with headers');
    } else {
      var firstRow = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn())).getValues()[0];
      // Check if Row 1 looks like a real header row (any cell matches a known header)
      var hasHeaders = headers.some(function(h) {
        return firstRow.some(function(cell) {
          return String(cell).trim().toLowerCase() === String(h).trim().toLowerCase();
        });
      });
      if (!hasHeaders) {
        // Row 1 is data — insert a blank row above and write headers there
        sheet.insertRowBefore(1);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        repairs.push(sheetName + ': REPAIRED — header row inserted above existing data');
      } else {
        // Headers exist — just rewrite them to ensure correct casing
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        repairs.push(sheetName + ': OK — headers verified and normalised');
      }
    }
    // Always apply formatting
    var hdrRange = sheet.getRange(1, 1, 1, headers.length);
    hdrRange.setFontWeight('bold');
    hdrRange.setBackground(bgColor);
    hdrRange.setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
    for (var c = 1; c <= headers.length; c++) sheet.setColumnWidth(c, 130);
  }

  repairSheet(SHEET_USERS,      USER_HEADERS,     '#f3f3f3');
  repairSheet(SHEET_RECORDS,    RECORDS_HEADERS,  '#e6f4ea');
  repairSheet(SHEET_DETAIL,     DETAIL_HEADERS,   '#e8f0fe');
  repairSheet(SHEET_PROJECTS,   PROJECT_HEADERS,  '#fff3e0');
  repairSheet(SHEET_ACTIVITIES, ACTIVITY_HEADERS, '#f3e5f5');

  SpreadsheetApp.flush();
  Logger.log('repairAllSheetHeaders results:\n' + repairs.join('\n'));
  return repairs;
}

function sheetToObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h) { return normalizeKey(h); });
  return data.slice(1)
    .filter(function(row) { return row[0] !== '' && row[0] !== null && row[0] !== undefined; })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) {
        var v = row[i];
        if (h === 'date') v = normDate(v);
        obj[h] = (v === undefined || v === null) ? '' : v;
      });
      return obj;
    });
}

function getMaxId(sheet, colIdx) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    var v = Number(data[i][colIdx]);
    if (!isNaN(v) && v > max) max = v;
  }
  return max;
}

// ── Current timestamp string for new records ─────────────────────
function nowStamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// ── INITIALIZATION LOGIC (SETUP SHEETS) ──────────────────────────
// Wipe and reset Projects & Activities strictly for Civil logic.

// ── SHEET INITIALIZATION ──────────────────────────────────────────
// Safe helper: gets a sheet by name, or creates it.
// Does NOT wipe existing data — preserves live rows.
function ensureSheet(ss, name) {
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  return s;
}

// Injects/overwrites a header row to guarantee correct column alignment.
function ensureHeaders(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

// Applies standard header formatting: bold, frozen, background colour.
function formatHeaderRow(sheet, numCols, bgColor) {
  var hdrRange = sheet.getRange(1, 1, 1, numCols);
  hdrRange.setFontWeight('bold');
  hdrRange.setBackground(bgColor);
  hdrRange.setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  // Auto-resize all columns for readability
  for (var c = 1; c <= numCols; c++) {
    sheet.setColumnWidth(c, 130);
  }
}

function setupDPRSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. USERS SHEET ──────────────────────────────────────────────
  // Headers: username | displayName | password | role
  // Colour:  light gray (#f3f3f3)
  var usersSheet = ensureSheet(ss, SHEET_USERS);
  ensureHeaders(usersSheet, USER_HEADERS);
  formatHeaderRow(usersSheet, USER_HEADERS.length, '#f3f3f3');

  // ── 2. DPR_RECORDS SHEET ────────────────────────────────────────
  // Headers: Date | Site | Prepared By | Activity Details | Total Manpower
  //          | Last Updated | submittedAt | editPermission | requestedBy | civilActivities
  // Colour:  light green (#e6f4ea)
  var recordsSheet = ensureSheet(ss, SHEET_RECORDS);
  ensureHeaders(recordsSheet, RECORDS_HEADERS);
  formatHeaderRow(recordsSheet, RECORDS_HEADERS.length, '#e6f4ea');
  // Widen the JSON columns so data is visible
  recordsSheet.setColumnWidth(4,  200);  // Activity Details
  recordsSheet.setColumnWidth(10, 200);  // civilActivities

  // ── 3. DPR_DETAIL SHEET ─────────────────────────────────────────
  // Headers: Date | Site | Section | Activity | Skilled | Unskilled
  //          | Total | Note | Prepared By | Timestamp
  // Colour:  light blue (#e8f0fe)
  var detailSheet = ensureSheet(ss, SHEET_DETAIL);
  ensureHeaders(detailSheet, DETAIL_HEADERS);
  formatHeaderRow(detailSheet, DETAIL_HEADERS.length, '#e8f0fe');

  // ── 4. PROJECTS SHEET ───────────────────────────────────────────
  // Headers: id | main_project_name | sub_project_name | parent_id | status | sort_order
  // Colour:  light orange (#fff3e0)
  var projectsSheet = ensureSheet(ss, SHEET_PROJECTS);
  ensureHeaders(projectsSheet, PROJECT_HEADERS);
  formatHeaderRow(projectsSheet, PROJECT_HEADERS.length, '#fff3e0');

  // Seed with one default project only if sheet is completely empty after headers
  var projLastRow = projectsSheet.getLastRow();
  if (projLastRow < 2) {
    projectsSheet.appendRow([1, 'Trimandir Project', '', '', 'active', 1]);
  }

  // ── 5. ACTIVITIES SHEET ─────────────────────────────────────────
  // Headers: id | main_category_name | sub_category_name | parent_id | status | sort_order
  // Colour:  light purple (#f3e5f5)
  var activitiesSheet = ensureSheet(ss, SHEET_ACTIVITIES);
  ensureHeaders(activitiesSheet, ACTIVITY_HEADERS);
  formatHeaderRow(activitiesSheet, ACTIVITY_HEADERS.length, '#f3e5f5');

  // Seed with core Civil work items only if sheet is completely empty after headers.
  // IDs are pure integers as required by the current ID policy.
  var actLastRow = activitiesSheet.getLastRow();
  if (actLastRow < 2) {
    var seedActivities = [
      //  id   main_category_name    sub_category_name              parent_id  status    sort_order
      [  1,  'Core Civil Work',     '',                            '',        'active',  1],
      [  2,  'Core Civil Work',     'Excavation / Backfilling',    1,         'active',  2],
      [  3,  'Core Civil Work',     'PCC / RCC',                   1,         'active',  3],
      [  4,  'Core Civil Work',     'Brickwork / Blockwork',       1,         'active',  4],
      [  5,  'Core Civil Work',     'Plaster',                     1,         'active',  5],
      [  6,  'Core Civil Work',     'Waterproofing',               1,         'active',  6],

      [  7,  'Door Shutter',        '',                            '',        'active',  7],
      [  8,  'Door Shutter',        'Frame Fixing',                7,         'active',  8],
      [  9,  'Door Shutter',        'Shutter Fixing',              7,         'active',  9],
      [ 10,  'Door Shutter',        'Hardware & Accessories',      7,         'active', 10],

      [ 11,  'Aluminium Work',      '',                            '',        'active', 11],
      [ 12,  'Aluminium Work',      'Track / Frame Fixing',        11,        'active', 12],
      [ 13,  'Aluminium Work',      'Glass & Shutter Fixing',      11,        'active', 13],
      [ 14,  'Aluminium Work',      'Louvers & Vents',             11,        'active', 14],

      [ 15,  'Paint Work',          '',                            '',        'active', 15],
      [ 16,  'Paint Work',          'Putty (1st & 2nd Coat)',      15,        'active', 16],
      [ 17,  'Paint Work',          'Primer',                      15,        'active', 17],
      [ 18,  'Paint Work',          'Paint Coat',                  15,        'active', 18],

      [ 19,  'Steel / Fabrication', '',                            '',        'active', 19],
      [ 20,  'Steel / Fabrication', 'Steel Cutting & Bending',     19,        'active', 20],
      [ 21,  'Steel / Fabrication', 'Fabrication Fixing',          19,        'active', 21],

      [ 22,  'Flooring',            '',                            '',        'active', 22],
      [ 23,  'Flooring',            'Marble / Granite',            22,        'active', 23],
      [ 24,  'Flooring',            'Tile Work',                   22,        'active', 24],
      [ 25,  'Flooring',            'Epoxy Flooring',              22,        'active', 25],

      [ 26,  'MEP Work',            '',                            '',        'active', 26],
      [ 27,  'MEP Work',            'Plumbing',                    26,        'active', 27],
      [ 28,  'MEP Work',            'Electrical',                  26,        'active', 28],
      [ 29,  'MEP Work',            'HVAC / AC Work',              26,        'active', 29],

      [ 30,  'Site Support',        '',                            '',        'active', 30],
      [ 31,  'Site Support',        'Material Shifting',           30,        'active', 31],
      [ 32,  'Site Support',        'Scaffolding',                 30,        'active', 32],
      [ 33,  'Site Support',        'Cleaning & Housekeeping',     30,        'active', 33]
    ];
    activitiesSheet.getRange(2, 1, seedActivities.length, ACTIVITY_HEADERS.length).setValues(seedActivities);
  }

  // Final flush to commit all formatting and data writes
  SpreadsheetApp.flush();

  return 'Setup complete: Users, DPR_Records, DPR_Detail, Projects, Activities — headers injected and formatted.';
}


// ── CORRUPTED ROW CLEANUP ─────────────────────────────────────────

function handleCleanCorrupted(body) {
  var report = { records: [], detail: [] };

  // Clean DPR_Records
  var recSheet = getSheet(SHEET_RECORDS);
  if (recSheet) {
    var recData = recSheet.getDataRange().getValues();
    for (var i = recData.length - 1; i >= 1; i--) {
      var cellA = recData[i][REC.date];
      var norm  = normDate(cellA);
      var isCorrupt = (!norm || norm === '' || (typeof cellA === 'number' && cellA > 1000000));
      if (isCorrupt) {
        report.records.push('Deleted Records row ' + (i + 1));
        recSheet.deleteRow(i + 1);
      }
    }
  }

  // Clean DPR_Detail
  var detSheet = getSheet(SHEET_DETAIL);
  if (detSheet) {
    var detData = detSheet.getDataRange().getValues();
    for (var j = detData.length - 1; j >= 1; j--) {
      var cellAD = detData[j][DET.date];
      var normD  = normDate(cellAD);
      var isCorrD = (!normD || normD === '' || (typeof cellAD === 'number' && cellAD > 1000000));
      if (isCorrD) {
        report.detail.push('Deleted Detail row ' + (j + 1));
        detSheet.deleteRow(j + 1);
      }
    }
  }

  return jsonResponse({ status: 'ok', cleaned: report });
}

// ── DELETE DETAIL ROWS (by date+site) ────
function deleteDetailRowsByKey(date, site) {
  var sheet = getSheet(SHEET_DETAIL);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var normTarget = normDate(date);
  var siteTarget = String(site || '').trim();
  for (var i = data.length - 1; i >= 1; i--) {
    if (normDate(data[i][DET.date]) === normTarget &&
        String(data[i][DET.site] || '').trim() === siteTarget) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ── READ ALL DPRs — joins DPR_Records with DPR_Detail ────────────

function handleGetDPRs() {
  var recSheet = getOrCreateSheet(SHEET_RECORDS, RECORDS_HEADERS);
  var detSheet = getOrCreateSheet(SHEET_DETAIL,  DETAIL_HEADERS);

  var recData = recSheet.getDataRange().getValues();
  var records = [];
  for (var ri = 1; ri < recData.length; ri++) {
    var row = recData[ri];
    var d   = normDate(row[REC.date]);
    var s   = String(row[REC.site] || '').trim();
    if (!d || !s) continue;
    records.push({
      date:               d,
      site:               s,
      by:                 String(row[REC.preparedBy]       || '').trim(),
      activityDetails:    String(row[REC.activityDetails]  || '').trim(),
      total:              Number(row[REC.totalManpower])   || 0,
      lastUpdated:        String(row[REC.lastUpdated]      || '').trim(),
      submittedAt:        row[REC.submittedAt]             || '',
      editPermission:     String(row[REC.editPermission]   || '').trim(),
      requestedBy:        String(row[REC.requestedBy]      || '').trim(),
      civilActivities:    parseJsonArr(row[REC.civilActivities]),
      siteCondition:      String(row[REC.siteCondition]     || '').trim()
    });
  }

  var detData   = detSheet.getDataRange().getValues();
  var detailMap = {};
  for (var di = 1; di < detData.length; di++) {
    var drow = detData[di];
    var dd   = normDate(drow[DET.date]);
    var ds   = String(drow[DET.site] || '').trim();
    if (!dd || !ds) continue;
    var dkey = dd + '||' + ds;
    if (!detailMap[dkey]) detailMap[dkey] = [];
    var sk  = Number(drow[DET.skilled])   || 0;
    var un  = Number(drow[DET.unskilled]) || 0;
    detailMap[dkey].push({
      section:    String(drow[DET.section]    || 'Civil').trim(),
      activity:   String(drow[DET.activity]   || '').trim(),
      skilled:    sk,
      unskilled:  un,
      total:      Number(drow[DET.total]) || sk + un,
      note:       String(drow[DET.note]   || '').trim(),
      preparedBy: String(drow[DET.preparedBy] || '').trim()
    });
  }

  var combined = records.map(function(r) {
    var key = r.date + '||' + r.site;
    return {
      date:               r.date,
      site:               r.site,
      total:              r.total,
      by:                 r.by,
      activityDetails:    r.activityDetails,
      lastUpdated:        r.lastUpdated,
      submittedAt:        r.submittedAt,
      editPermission:     r.editPermission,
      requestedBy:        r.requestedBy,
      civilActivities:    r.civilActivities,
      siteCondition:      r.siteCondition,
      details:            detailMap[key] || []
    };
  });

  combined.sort(function(a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  return jsonResponse(combined);
}

// ── SAVE DPR ─────────────────────────────────────────────────────

function handleSaveDPR(body) {
  var recSheet = getOrCreateSheet(SHEET_RECORDS, RECORDS_HEADERS);
  var d        = normDate(body.date);
  var s        = String(body.site || '').trim();
  if (!d || !s) return jsonResponse({ error: 'Missing date or site' });

  // Duplicate check using fixed column positions
  var recData = recSheet.getDataRange().getValues();
  for (var i = 1; i < recData.length; i++) {
    if (normDate(recData[i][REC.date]) === d && String(recData[i][REC.site] || '').trim() === s)
      return jsonResponse({ status: 'duplicate' });
  }

  var acts     = Array.isArray(body.activities) ? body.activities : [];
  var prepBy   = String(body.by || '').trim();
  var submAt   = body.submittedAt ? String(body.submittedAt) : nowStamp();
  var now      = nowStamp();

  var civilArr    = [];
  var totalMP     = 0;
  
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    totalMP += sk + un;
    var rec = { activity: actName, main_activity: a.main_activity || '', skilled: sk, unskilled: un, note: a.note || '' };
    civilArr.push(rec);
  });

  var actDetails = acts.map(function(a) { return a.main_activity || a.activity || ''; })
                       .filter(Boolean).filter(function(v, i, arr) { return arr.indexOf(v) === i; })
                       .join(' | ');

  recSheet.appendRow([
    d,                      // A: Date
    s,                      // B: Site
    prepBy,                 // C: Prepared By
    actDetails,             // D: Activity Details
    totalMP,                // E: Total Manpower
    now,                    // F: Last Updated
    submAt,                 // G: submittedAt
    '',                     // H: editPermission
    '',                     // I: requestedBy
    toJsonStr(civilArr),    // J: civilActivities
    String(body.siteCondition || '')  // K: SiteCondition
  ]);

  var detSheet = getOrCreateSheet(SHEET_DETAIL, DETAIL_HEADERS);
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    detSheet.appendRow([
      d,          // A: Date
      s,          // B: Site
      'Civil',    // C: Section
      actName,    // D: Activity
      sk,         // E: Skilled
      un,         // F: Unskilled
      sk + un,    // G: Total
      String(a.note || ''), // H: Note
      prepBy,     // I: Prepared By
      submAt      // J: Timestamp
    ]);
  });

  return jsonResponse({ status: 'ok' });
}

// ── EDIT DPR ─────────────────────────────────────────────────────

function handleEditDPR(body) {
  var recSheet = getOrCreateSheet(SHEET_RECORDS, RECORDS_HEADERS);
  var d        = normDate(body.date);
  var s        = String(body.site || '').trim();
  if (!d || !s) return jsonResponse({ error: 'Missing date or site' });

  var recData = recSheet.getDataRange().getValues();
  var rowNum  = -1;
  for (var i = 1; i < recData.length; i++) {
    if (normDate(recData[i][REC.date]) === d && String(recData[i][REC.site] || '').trim() === s) {
      rowNum = i + 1; break;
    }
  }
  if (rowNum < 0) return jsonResponse({ error: 'Record not found' });

  var acts     = Array.isArray(body.activities) ? body.activities : [];
  var prepBy   = String(body.by || '').trim();
  var editedBy = String(body.editedBy || '').trim();
  var now      = nowStamp();
  var submAt   = body.submittedAt ? String(body.submittedAt) : now;

  var civilArr    = [];
  var totalMP     = 0;
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    totalMP += sk + un;
    var rec = { activity: actName, main_activity: a.main_activity || '', skilled: sk, unskilled: un, note: a.note || '' };
    civilArr.push(rec);
  });

  var actDetails = acts.map(function(a) { return a.main_activity || a.activity || ''; })
                       .filter(Boolean).filter(function(v, i, arr) { return arr.indexOf(v) === i; })
                       .join(' | ');

  var range = recSheet.getRange(rowNum, 1, 1, RECORDS_HEADERS.length);
  var newRow = range.getValues()[0];
  newRow[REC.preparedBy]         = prepBy || newRow[REC.preparedBy];
  newRow[REC.activityDetails]    = actDetails;
  newRow[REC.totalManpower]      = totalMP;
  newRow[REC.lastUpdated]        = now + (editedBy ? ' (by ' + editedBy + ')' : '');
  newRow[REC.submittedAt]        = submAt;
  newRow[REC.editPermission]     = '';
  newRow[REC.civilActivities]    = toJsonStr(civilArr);
  newRow[REC.siteCondition]      = body.siteCondition || newRow[REC.siteCondition] || '';
  range.setValues([newRow]);

  deleteDetailRowsByKey(d, s);
  var detSheet = getOrCreateSheet(SHEET_DETAIL, DETAIL_HEADERS);
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    detSheet.appendRow([
      d, s, 'Civil', actName, sk, un, sk + un, String(a.note || ''), prepBy, now
    ]);
  });

  return jsonResponse({ status: 'ok' });
}

// ── DELETE DPR ───────────────────────────────────────────────────

function handleDeleteDPR(body) {
  var parts = String(body.id || '').split('||');
  var d     = parts[0];
  var s     = parts.slice(1).join('||');

  var recSheet = getSheet(SHEET_RECORDS);
  if (recSheet) {
    var recData = recSheet.getDataRange().getValues();
    for (var i = recData.length - 1; i >= 1; i--) {
      if (normDate(recData[i][REC.date]) === d && String(recData[i][REC.site] || '').trim() === s) {
        recSheet.deleteRow(i + 1); break;
      }
    }
  }
  deleteDetailRowsByKey(d, s);
  return jsonResponse({ status: 'ok' });
}

// ── EDIT PERMISSION REQUESTS ─────────────────────────────────────

function handleRequestEditDPR(body) {
  var sheet  = getSheet(SHEET_RECORDS);
  if (!sheet) return jsonResponse({ error: 'Sheet not found' });
  var kparts = String(body.key || '').split('||');
  var kd     = kparts[0], ks = kparts.slice(1).join('||');
  var data   = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (normDate(data[i][REC.date]) === kd && String(data[i][REC.site] || '').trim() === ks) {
      sheet.getRange(i + 1, REC.editPermission + 1).setValue('pending');
      sheet.getRange(i + 1, REC.requestedBy    + 1).setValue(body.requestedBy || '');
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'Not found' });
}

function handleApproveEditDPR(body) {
  var sheet  = getSheet(SHEET_RECORDS);
  if (!sheet) return jsonResponse({ error: 'Sheet not found' });
  var kparts = String(body.key || '').split('||');
  var kd     = kparts[0], ks = kparts.slice(1).join('||');
  var data   = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (normDate(data[i][REC.date]) === kd && String(data[i][REC.site] || '').trim() === ks) {
      sheet.getRange(i + 1, REC.editPermission + 1).setValue('granted');
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'Not found' });
}

// ── DEBUG ENDPOINT ───────────────────────────────────────────────

function handleDebug() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheets  = ss.getSheets().map(function(sh) {
    var data = sh.getDataRange().getValues();
    return {
      name:    sh.getName(),
      rows:    data.length,
      headers: data.length > 0 ? data[0] : [],
      sample:  sh.getName() === 'Users' ? data : (data.length > 1 ? data[1] : [])
    };
  });
  return jsonResponse({ sheets: sheets });
}

// ── USERS ─────────────────────────────────────────────────────────

function handleGetUsers() {
  var sheet = getSheet(SHEET_USERS);
  if (!sheet) return jsonResponse([]);

  var data = sheet.getDataRange().getValues();
  if (data.length < 1) return jsonResponse([]);

  // Determine column layout from header row (if present) or fall back to positional
  var hdrs = data[0].map(function(h) { return normalizeKey(h); });
  var uIdx = hdrs.indexOf('username');
  var dIdx = hdrs.indexOf('displayName');
  var rIdx = hdrs.indexOf('role');

  // Positional fallback: A=username B=displayName C=password D=role
  var hasHeaders = (uIdx !== -1);
  if (!hasHeaders) { uIdx = 0; dIdx = 1; rIdx = 3; }

  // Start from row index 1 if headers exist, 0 if no headers detected
  var startRow = hasHeaders ? 1 : 0;

  var users = [];
  for (var i = startRow; i < data.length; i++) {
    var u = String(data[i][uIdx] || '').trim();
    if (!u) continue;   // skip blank rows
    users.push({
      username:    u,
      displayName: String(data[i][dIdx] || u).trim() || u,
      role:        String(data[i][rIdx] || 'user').trim() || 'user'
    });
  }
  return jsonResponse(users);
}

function handleLogin(body) {
  var sheet = getSheet(SHEET_USERS);
  if (!sheet) return jsonResponse({ success: false });
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: false });

  // normalizeKey maps 'displayName' → 'displayname' in the lookup key,
  // then returns 'displayName' as the canonical value — BUT indexOf needs
  // to match exactly what normalizeKey outputs for each header string.
  var hdrs = data[0].map(function(h) { return normalizeKey(h); });

  // normalizeKey('username')    → 'username'
  // normalizeKey('displayName') → 'displayName'  (via map['displayname'])
  // normalizeKey('password')    → 'password'
  // normalizeKey('role')        → 'role'
  var uIdx = hdrs.indexOf('username');
  var pIdx = hdrs.indexOf('password');
  var dIdx = hdrs.indexOf('displayName');   // normalizeKey output is camelCase from map
  var rIdx = hdrs.indexOf('role');

  // Fallback: if the sheet still has no headers, columns A-D are the raw data;
  // assume fixed positional layout: A=username B=displayName C=password D=role
  if (uIdx === -1) uIdx = 0;
  if (dIdx === -1) dIdx = 1;
  if (pIdx === -1) pIdx = 2;
  if (rIdx === -1) rIdx = 3;

  for (var i = 1; i < data.length; i++) {
    var rowUser = String(data[i][uIdx] || '').trim();
    var rowPass = String(data[i][pIdx] || '').trim();
    if (rowUser.toLowerCase().trim() === String(body.username || '').toLowerCase().trim() && rowPass.trim() === String(body.password || '').trim()) {
      return jsonResponse({ success: true, user: {
        username:    rowUser,
        displayName: String(data[i][dIdx] || rowUser).trim() || rowUser,
        role:        String(data[i][rIdx] || 'user').trim() || 'user'
      }});
    }
  }
  return jsonResponse({ success: false });
}

function handleCreateUser(body) {
  var sheet = getOrCreateSheet(SHEET_USERS, USER_HEADERS);
  sheet.appendRow([body.username, body.displayName || body.username, body.password, body.role || 'user']);
  return jsonResponse({ status: 'ok' });
}

function handleDeleteUser(body) {
  var sheet = getSheet(SHEET_USERS);
  if (!sheet) return jsonResponse({ error: 'Not found' });
  var data  = sheet.getDataRange().getValues();
  var hdrs  = data[0].map(function(h) { return normalizeKey(h); });
  var uIdx  = hdrs.indexOf('username');
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][uIdx]).toLowerCase() === String(body.username || '').toLowerCase()) {
      sheet.deleteRow(i + 1); return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'User not found' });
}

function handleResetPassword(body) {
  var sheet = getSheet(SHEET_USERS);
  if (!sheet) return jsonResponse({ error: 'Not found' });
  var data  = sheet.getDataRange().getValues();
  var hdrs  = data[0].map(function(h) { return normalizeKey(h); });
  var uIdx  = hdrs.indexOf('username'), pIdx = hdrs.indexOf('password');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][uIdx]).toLowerCase() === String(body.username || '').toLowerCase()) {
      sheet.getRange(i + 1, pIdx + 1).setValue(body.password || '');
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'Not found' });
}

// ── PROJECTS ──────────────────────────────────────────────────────

function handleGetProjects() {
  var sheet = getSheet(SHEET_PROJECTS);
  if (!sheet) return jsonResponse([]);
  var projects = sheetToObjects(sheet).map(function(p) {
    return {
      id:            p.id,
      project_name:  p.sub_project_name || p.main_project_name,
      parent_id:     p.parent_id || '',
      status:        p.status || 'active',
      sort_order:    p.sort_order !== undefined && p.sort_order !== '' ? Number(p.sort_order) : 9999
    };
  });
  projects.sort(function(a, b) {
    return a.sort_order - b.sort_order;
  });
  return jsonResponse(projects);
}

function handleAddProject(body) {
  var sheet = getOrCreateSheet(SHEET_PROJECTS, PROJECT_HEADERS);
  var maxId = getMaxId(sheet, 0);         // pure integer max from col A
  var newId = maxId + 1;                  // integer ID — never alphanumeric
  var isSub = !!(body.parent_id && String(body.parent_id).trim() !== '');
  var mainName = isSub ? '' : (body.project_name || body.main_project_name || '');
  var subName  = isSub ? (body.project_name || body.sub_project_name || '') : '';
  var maxSortOrder = getMaxId(sheet, 5);
  sheet.appendRow([newId, mainName, subName, body.parent_id || '', 'active', maxSortOrder + 1]);
  return jsonResponse({ status: 'ok', id: newId });
}

function handleUpdateProject(body) {
  var sheet = getSheet(SHEET_PROJECTS);
  if (!sheet) return jsonResponse({ error: 'Sheet not found' });
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      var isSub = !!data[i][3];
      if (isSub && body.project_name) sheet.getRange(i + 1, 3).setValue(body.project_name);
      else if (!isSub && body.project_name) sheet.getRange(i + 1, 2).setValue(body.project_name);
      
      if (body.main_project_name !== undefined) sheet.getRange(i + 1, 2).setValue(body.main_project_name);
      if (body.sub_project_name  !== undefined) sheet.getRange(i + 1, 3).setValue(body.sub_project_name);
      if (body.parent_id         !== undefined) sheet.getRange(i + 1, 4).setValue(body.parent_id);
      if (body.status            !== undefined) sheet.getRange(i + 1, 5).setValue(body.status);
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'Not found' });
}

function handleDeleteProject(body) {
  var sheet = getSheet(SHEET_PROJECTS);
  if (!sheet) return jsonResponse({ error: 'Sheet not found' });
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(body.id) || String(data[i][3]) === String(body.id)) {
      sheet.deleteRow(i + 1);
    }
  }
  return jsonResponse({ status: 'ok' });
}

// ── ACTIVITIES ────────────────────────────────────────────────────

function handleGetActivities() {
  var sheet = getSheet(SHEET_ACTIVITIES);
  if (!sheet) return jsonResponse([]);
  var activities = sheetToObjects(sheet).map(function(a) {
    return {
      id:            a.id,
      activity_name: a.sub_category_name || a.main_category_name,
      parent_id:     a.parent_id || '',
      status:        a.status || 'active',
      sort_order:    a.sort_order !== undefined && a.sort_order !== '' ? Number(a.sort_order) : 9999
    };
  });
  activities.sort(function(a, b) {
    return a.sort_order - b.sort_order;
  });
  return jsonResponse(activities);
}

function handleAddActivity(body) {
  var sheet = getOrCreateSheet(SHEET_ACTIVITIES, ACTIVITY_HEADERS);
  var maxId = getMaxId(sheet, 0);
  var newId = maxId + 1;  // Pure integer, never prepend letters
  var maxSortOrder = getMaxId(sheet, 5);

  var parentId = body.parent_id || '';
  var activityName = body.activity_name || '';

  // Route the name into the correct column based on whether it is a sub-activity
  var mainName = body.main_category_name || (parentId === '' ? activityName : '');
  var subName  = body.sub_category_name  || (parentId !== '' ? activityName : '');

  sheet.appendRow([newId, mainName, subName, parentId, 'active', maxSortOrder + 1]);
  return jsonResponse({ status: 'ok', id: newId });
}

function handleUpdateActivity(body) {
  var sheet = getSheet(SHEET_ACTIVITIES);
  if (!sheet) return jsonResponse({ error: 'Sheet not found' });
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      var isSub = !!data[i][3];
      if (isSub && body.activity_name) sheet.getRange(i + 1, 3).setValue(body.activity_name);
      else if (!isSub && body.activity_name) sheet.getRange(i + 1, 2).setValue(body.activity_name);
      if (body.status !== undefined) sheet.getRange(i + 1, 5).setValue(body.status);
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'Not found' });
}

function handleDeleteActivity(body) {
  var sheet = getSheet(SHEET_ACTIVITIES);
  if (!sheet) return jsonResponse({ error: 'Sheet not found' });
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(body.id) || String(data[i][3]) === String(body.id)) {
      sheet.deleteRow(i + 1);
    }
  }
  return jsonResponse({ status: 'ok' });
}

function handleUpdateSortOrder(body) {
  try {
    var type       = body.type;
    var orderedIds = body.orderedIds;

    if (!orderedIds || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      return jsonResponse({ error: 'Missing or invalid orderedIds' });
    }

    var sheetName;
    if      (type === 'projects')    sheetName = SHEET_PROJECTS;
    else if (type === 'activities')  sheetName = SHEET_ACTIVITIES;
    else return jsonResponse({ error: 'Invalid type: ' + type });

    var sheet = getSheet(sheetName);
    if (!sheet) return jsonResponse({ error: 'Sheet not found: ' + sheetName });

    // ── Step 1: Read headers to locate the sort_order column index ──
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var sortOrderColIdx = -1;
    for (var c = 0; c < headers.length; c++) {
      if (String(headers[c]).trim().toLowerCase() === 'sort_order') {
        sortOrderColIdx = c;
        break;
      }
    }

    // If sort_order column does not exist yet, create it as the next column
    if (sortOrderColIdx === -1) {
      sortOrderColIdx = headers.length;
      sheet.getRange(1, sortOrderColIdx + 1).setValue('sort_order');
    }

    // ── Step 2: Build a dictionary: normalised-id → physical row number ──
    // This avoids any full-block setValues that could corrupt column counts.
    var lastRow  = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse({ success: true, message: 'No data rows to update' });

    var idCol    = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // col A only
    var idToRow  = {};  // { "78": 2, "79": 3, ... }
    for (var r = 0; r < idCol.length; r++) {
      var rawId = idCol[r][0];
      if (rawId === '' || rawId === null || rawId === undefined) continue;
      // Store by both String and numeric representations to handle type mismatches
      var strId = String(rawId).trim();
      idToRow[strId] = r + 2;  // +2: 1-based rows + skip header row
    }

    // ── Step 3: Write sort_order cell-by-cell for each ID in the payload ──
    // orderedIds[0] → sort_order = 1, orderedIds[1] → sort_order = 2, etc.
    var sortColNumber = sortOrderColIdx + 1;  // convert 0-based idx to 1-based sheet col
    var unmatched     = [];

    for (var i = 0; i < orderedIds.length; i++) {
      var payloadId = String(orderedIds[i]).trim();
      var physRow   = idToRow[payloadId];

      // Fallback: try matching by numeric value (handles "78" vs 78 edge cases)
      if (physRow === undefined) {
        var numericId = String(Number(payloadId));
        physRow = idToRow[numericId];
      }

      if (physRow !== undefined) {
        sheet.getRange(physRow, sortColNumber).setValue(i + 1);
      } else {
        unmatched.push(payloadId);
      }
    }

    // ── Step 4: Assign high-end sequence to any rows not in the payload ──
    // (orphan rows, deleted items, etc.) so they don't pollute the front
    var fallbackOrder = orderedIds.length + 1;
    for (var strKey in idToRow) {
      if (!idToRow.hasOwnProperty(strKey)) continue;
      // Check if this row's id was part of the ordered payload
      var inPayload = false;
      for (var j = 0; j < orderedIds.length; j++) {
        if (String(orderedIds[j]).trim() === strKey) { inPayload = true; break; }
      }
      if (!inPayload) {
        sheet.getRange(idToRow[strKey], sortColNumber).setValue(fallbackOrder++);
      }
    }

    // ── Step 5: Hard commit all pending cell writes ──────────────────
    SpreadsheetApp.flush();

    return ContentService
      .createTextOutput(JSON.stringify({
        success:   true,
        message:   'Sort order committed successfully',
        type:      type,
        count:     orderedIds.length,
        unmatched: unmatched
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return jsonResponse({ error: 'handleUpdateSortOrder error: ' + err.toString() });
  }
}

