// ================================================================
// TPD-DPR — Google Apps Script Backend (Code.gs)
// STRICT SCHEMA — matching exact spreadsheet column layout
//
// DPR_Records (A→K):
//   A=Date  B=Site  C=Prepared By  D=Activity Details  E=Total Manpower
//   F=Last Updated  G=submittedAt  H=editPermission  I=requestedBy
//   J=civilActivities(JSON)  K=interiorActivities(JSON)
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
// RECORDS: A  B     C            D                  E               F             G             H                I             J                  K
var RECORDS_HEADERS  = ['Date','Site','Prepared By','Activity Details','Total Manpower','Last Updated','submittedAt','editPermission','requestedBy','civilActivities','interiorActivities'];
// DETAIL: A      B      C         D          E         F           G       H      I            J
var DETAIL_HEADERS   = ['Date','Site','Section','Activity','Skilled','Unskilled','Total','Note','Prepared By','Timestamp'];
var USER_HEADERS     = ['username','displayName','password','role'];
var PROJECT_HEADERS  = ['id', 'main_project_name', 'sub_project_name', 'parent_id', 'status'];
var ACTIVITY_HEADERS = ['id', 'main_category_name', 'sub_category_name', 'parent_id', 'status'];

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
  interiorActivities: 10   // K
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
  if (action === 'fixSheet')      return handleFixSheetsAction();
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
// Maps many variants of column names to canonical keys.

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
    'interioractivities': 'interiorActivities', 'interior_activities': 'interiorActivities',
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
    if (headers && headers.length) sheet.appendRow(headers);
  }
  return sheet;
}

// Read a sheet using positional column INDEXES (not header text) —
// always returns objects with our canonical field names.
// colMap: { fieldName: colIndex0based }
function sheetToObjectsByIndex(sheet, colMap, dateFields) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  dateFields = dateFields || [];
  var maxIdx = 0;
  Object.values(colMap).forEach(function(i) { if (i > maxIdx) maxIdx = i; });
  return data.slice(1).filter(function(row) {
    return row.length > colMap.date && row[colMap.date] !== '' && row[colMap.date] !== null;
  }).map(function(row) {
    var obj = {};
    Object.keys(colMap).forEach(function(field) {
      var v = row[colMap[field]];
      if (dateFields.indexOf(field) >= 0) v = normDate(v);
      obj[field] = (v === undefined || v === null) ? '' : v;
    });
    return obj;
  });
}

// Flexible reader for sheets with unknown/varying headers (Projects, Activities, Users)
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

// ── CORRUPTED ROW CLEANUP ─────────────────────────────────────────
// Deletes rows in DPR_Records and DPR_Detail where data is clearly
// in wrong columns (e.g. total in date cell, or blank date with data elsewhere).

function handleCleanCorrupted(body) {
  var report = { records: [], detail: [] };

  // Clean DPR_Records: remove rows where Col A (Date) is not a recognisable date
  var recSheet = getSheet(SHEET_RECORDS);
  if (recSheet) {
    var recData = recSheet.getDataRange().getValues();
    for (var i = recData.length - 1; i >= 1; i--) {
      var cellA = recData[i][REC.date];
      var norm  = normDate(cellA);
      // Corrupted if date col is blank or a large number (like timestamp) or a long string
      var isCorrupt = (!norm || norm === '' || (typeof cellA === 'number' && cellA > 1000000));
      if (isCorrupt) {
        report.records.push('Deleted Records row ' + (i + 1) + ': ' + JSON.stringify(recData[i].slice(0, 5)));
        recSheet.deleteRow(i + 1);
      }
    }
  }

  // Clean DPR_Detail: remove rows where Col A (Date) is not a recognisable date
  var detSheet = getSheet(SHEET_DETAIL);
  if (detSheet) {
    var detData = detSheet.getDataRange().getValues();
    for (var j = detData.length - 1; j >= 1; j--) {
      var cellAD = detData[j][DET.date];
      var normD  = normDate(cellAD);
      var isCorrD = (!normD || normD === '' || (typeof cellAD === 'number' && cellAD > 1000000));
      if (isCorrD) {
        report.detail.push('Deleted Detail row ' + (j + 1) + ': ' + JSON.stringify(detData[j].slice(0, 5)));
        detSheet.deleteRow(j + 1);
      }
    }
  }

  return jsonResponse({ status: 'ok', cleaned: report });
}

// ── SECTION DETECTION ─────────────────────────────────────────────
// Determines Civil vs Interior section for an activity.
// Falls back to 'Civil' when unknown. Admin can override via parent id.

var INTERIOR_KEYWORDS = [
  'tile','marble','polishing','furniture','modular','paint','ceiling','false ceiling',
  'interior','electrical','hvac','ac','plumbing','cctv','it work','lift','epoxy'
];

function detectSection(activityName, parentName) {
  var check = ((activityName || '') + ' ' + (parentName || '')).toLowerCase();
  for (var i = 0; i < INTERIOR_KEYWORDS.length; i++) {
    if (check.indexOf(INTERIOR_KEYWORDS[i]) >= 0) return 'Interior';
  }
  return 'Civil';
}

// ── DELETE DETAIL ROWS (by date+site, using fixed col indexes) ────
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

// ── MIGRATION: legacy 'DPR' sheet → DPR_Records + DPR_Detail ─────
// Reads the old DPR sheet (any column layout), parses civilActivities
// and interiorActivities JSON, and writes to the EXACT correct column
// positions in DPR_Records and DPR_Detail.

function migrateLegacyDPRSheet() {
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var legacySheet = ss.getSheetByName('DPR');
  if (!legacySheet) return;

  var legacyData = legacySheet.getDataRange().getValues();
  if (legacyData.length < 2) { renameMigrated(legacySheet); return; }

  var legHeaders = legacyData[0].map(function(h) { return normalizeKey(h); });
  var legRows    = legacyData.slice(1).filter(function(r) { return r[0] !== '' && r[0] !== null; });
  if (!legRows.length) { renameMigrated(legacySheet); return; }

  var recSheet = getOrCreateSheet(SHEET_RECORDS, RECORDS_HEADERS);
  var detSheet = getOrCreateSheet(SHEET_DETAIL,  DETAIL_HEADERS);

  // Build set of already-migrated keys from DPR_Records (by date+site)
  var existingKeys = {};
  var existingRec  = recSheet.getDataRange().getValues();
  for (var ei = 1; ei < existingRec.length; ei++) {
    var ed = normDate(existingRec[ei][REC.date]);
    var es = String(existingRec[ei][REC.site] || '').trim();
    if (ed && es) existingKeys[ed + '||' + es] = true;
  }

  legRows.forEach(function(row) {
    var obj = {};
    legHeaders.forEach(function(h, i) { obj[h] = row[i]; });

    var d = normDate(obj.date || '');
    var s = String(obj.site || '').trim();
    if (!d || !s) return;
    var key = d + '||' + s;
    if (existingKeys[key]) return;

    // Parse civil and interior activity arrays
    var civilArr    = parseJsonArr(obj.civilActivities    || obj.civil_activities    || '');
    var interiorArr = parseJsonArr(obj.interiorActivities || obj.interior_activities || '');
    var totalMP     = Number(obj.totalManpower || obj.total || 0) || 0;
    var prepBy      = String(obj.preparedBy || obj.by || obj.submitted_by || '');
    var submAt      = String(obj.submittedAt || obj.timestamp || '');
    var editPerm    = String(obj.editPermission || '');
    var reqBy       = String(obj.requestedBy || '');
    var lastUpd     = String(obj.lastUpdated || d);

    // Build activity details summary string
    var allNames = [];
    civilArr.forEach(function(a)    { if (a.activity) allNames.push(a.activity); });
    interiorArr.forEach(function(a) { if (a.activity) allNames.push(a.activity); });
    var actDetails = allNames.join(' | ');

    // Compute total if not stored
    if (!totalMP) {
      [].concat(civilArr).concat(interiorArr).forEach(function(a) {
        totalMP += (Number(a.skilled) || 0) + (Number(a.unskilled) || 0);
      });
    }

    // Write to DPR_Records — EXACT column order A→K
    recSheet.appendRow([
      d,                        // A: Date
      s,                        // B: Site
      prepBy,                   // C: Prepared By
      actDetails,               // D: Activity Details
      totalMP,                  // E: Total Manpower
      lastUpd,                  // F: Last Updated
      submAt,                   // G: submittedAt
      editPerm,                 // H: editPermission
      reqBy,                    // I: requestedBy
      toJsonStr(civilArr),      // J: civilActivities
      toJsonStr(interiorArr)    // K: interiorActivities
    ]);
    existingKeys[key] = true;

    // Write to DPR_Detail — EXACT column order A→J — Civil rows
    civilArr.forEach(function(a) {
      if (!a.activity) return;
      var sk = Number(a.skilled)   || 0;
      var un = Number(a.unskilled) || 0;
      detSheet.appendRow([
        d,          // A: Date
        s,          // B: Site
        'Civil',    // C: Section
        String(a.activity),          // D: Activity
        sk,         // E: Skilled
        un,         // F: Unskilled
        sk + un,    // G: Total
        String(a.note || ''),        // H: Note
        prepBy,     // I: Prepared By
        submAt || d // J: Timestamp
      ]);
    });

    // Write to DPR_Detail — Interior rows
    interiorArr.forEach(function(a) {
      if (!a.activity) return;
      var sk = Number(a.skilled)   || 0;
      var un = Number(a.unskilled) || 0;
      detSheet.appendRow([
        d,            // A: Date
        s,            // B: Site
        'Interior',   // C: Section
        String(a.activity),          // D: Activity
        sk,           // E: Skilled
        un,           // F: Unskilled
        sk + un,      // G: Total
        String(a.note || ''),        // H: Note
        prepBy,       // I: Prepared By
        submAt || d   // J: Timestamp
      ]);
    });
  });

  renameMigrated(legacySheet);
}

function renameMigrated(sheet) {
  try {
    var today   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var newName = 'DPR_Migrated_' + today;
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSheetByName(newName)) newName += '_' + Date.now();
    sheet.setName(newName);
  } catch (e) { /* already renamed */ }
}

// ── READ ALL DPRs — joins DPR_Records with DPR_Detail ────────────

function handleGetDPRs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('DPR')) migrateLegacyDPRSheet();

  var recSheet = getOrCreateSheet(SHEET_RECORDS, RECORDS_HEADERS);
  var detSheet = getOrCreateSheet(SHEET_DETAIL,  DETAIL_HEADERS);

  // Read DPR_Records using fixed column positions
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
      interiorActivities: parseJsonArr(row[REC.interiorActivities])
    });
  }

  // Read DPR_Detail using fixed column positions — build detail map
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

  // Embed details into each record
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
      interiorActivities: r.interiorActivities,
      details:            detailMap[key] || []
    };
  });

  combined.sort(function(a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  return jsonResponse(combined);
}

// ── SAVE DPR ─────────────────────────────────────────────────────
// body.activities = [{ main_activity, sub_activity, section, skilled, unskilled, note }]

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

  // Separate into Civil / Interior arrays for Col J and K
  var civilArr    = [];
  var interiorArr = [];
  var totalMP     = 0;
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var section = String(a.section || detectSection(a.main_activity || '', a.sub_activity || ''));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    totalMP += sk + un;
    var rec = { activity: actName, main_activity: a.main_activity || '', skilled: sk, unskilled: un, note: a.note || '' };
    if (section === 'Interior') interiorArr.push(rec);
    else                        civilArr.push(rec);
  });

  var actDetails = acts.map(function(a) { return a.main_activity || a.activity || ''; })
                       .filter(Boolean).filter(function(v, i, arr) { return arr.indexOf(v) === i; })
                       .join(' | ');

  // Write DPR_Records row — EXACT A→K order
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
    toJsonStr(interiorArr)  // K: interiorActivities
  ]);

  // Write DPR_Detail rows — EXACT A→J order
  var detSheet = getOrCreateSheet(SHEET_DETAIL, DETAIL_HEADERS);
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var section = String(a.section || detectSection(a.main_activity || '', a.sub_activity || ''));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    detSheet.appendRow([
      d,          // A: Date
      s,          // B: Site
      section,    // C: Section  ('Civil' or 'Interior')
      actName,    // D: Activity  (sub-activity name, or main if no sub)
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

  // Find row in DPR_Records using fixed positions
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
  var interiorArr = [];
  var totalMP     = 0;
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var section = String(a.section || detectSection(a.main_activity || '', a.sub_activity || ''));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    totalMP += sk + un;
    var rec = { activity: actName, main_activity: a.main_activity || '', skilled: sk, unskilled: un, note: a.note || '' };
    if (section === 'Interior') interiorArr.push(rec);
    else                        civilArr.push(rec);
  });

  var actDetails = acts.map(function(a) { return a.main_activity || a.activity || ''; })
                       .filter(Boolean).filter(function(v, i, arr) { return arr.indexOf(v) === i; })
                       .join(' | ');

  // Update DPR_Records — only overwrite specific columns (preserve editPermission/requestedBy if not clearing)
  var range = recSheet.getRange(rowNum, 1, 1, RECORDS_HEADERS.length);
  var newRow = range.getValues()[0];
  newRow[REC.preparedBy]         = prepBy || newRow[REC.preparedBy];
  newRow[REC.activityDetails]    = actDetails;
  newRow[REC.totalManpower]      = totalMP;
  newRow[REC.lastUpdated]        = now + (editedBy ? ' (by ' + editedBy + ')' : '');
  newRow[REC.submittedAt]        = submAt;
  newRow[REC.editPermission]     = '';   // Clear after use
  newRow[REC.civilActivities]    = toJsonStr(civilArr);
  newRow[REC.interiorActivities] = toJsonStr(interiorArr);
  range.setValues([newRow]);

  // Replace DPR_Detail rows
  deleteDetailRowsByKey(d, s);
  var detSheet = getOrCreateSheet(SHEET_DETAIL, DETAIL_HEADERS);
  acts.forEach(function(a) {
    if (!a.main_activity && !a.activity) return;
    var actName = String(a.sub_activity && a.sub_activity.trim() ? a.sub_activity : (a.main_activity || a.activity));
    var section = String(a.section || detectSection(a.main_activity || '', a.sub_activity || ''));
    var sk      = Number(a.skilled)   || 0;
    var un      = Number(a.unskilled) || 0;
    detSheet.appendRow([
      d, s, section, actName, sk, un, sk + un, String(a.note || ''), prepBy, now
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
      sample:  data.length > 1 ? data[1]  : []
    };
  });
  return jsonResponse({ sheets: sheets });
}

// ── USERS ─────────────────────────────────────────────────────────

function handleGetUsers() {
  var sheet = getSheet(SHEET_USERS);
  if (!sheet) return jsonResponse([]);
  return jsonResponse(sheetToObjects(sheet).map(function(u) {
    return { username: u.username, displayName: u.displayName || u.username, role: u.role || 'user' };
  }));
}

function handleLogin(body) {
  var sheet = getSheet(SHEET_USERS);
  if (!sheet) return jsonResponse({ success: false });
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: false });
  var hdrs = data[0].map(function(h) { return normalizeKey(h); });
  var uIdx = hdrs.indexOf('username'), pIdx = hdrs.indexOf('password');
  var dIdx = hdrs.indexOf('displayName'), rIdx = hdrs.indexOf('role');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][uIdx]).toLowerCase() === String(body.username || '').toLowerCase() &&
        String(data[i][pIdx]) === String(body.password || '')) {
      return jsonResponse({ success: true, user: {
        username:    data[i][uIdx],
        displayName: data[i][dIdx] || data[i][uIdx],
        role:        data[i][rIdx] || 'user'
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
      sheet.getRange(i + 1, pIdx + 1).setValue(body.password);
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'User not found' });
}

// ── PROJECTS ─────────────────────────────────────────────────────

function seedProjects(sheet) {
  [
    'Amba School', 'Adalaj Mandir Podium Work',
    'ABP 540 Office', 'Baheno Gurukul',
    'UGWT-Old Vatsalya', 'Compound Wall-Raj Marg'
  ].forEach(function(name, i) { sheet.appendRow([i + 1, name, '', '', 'active']); });
  formatSheetTable(sheet);
}

function handleGetProjects() {
  var sheet = getOrCreateSheet(SHEET_PROJECTS, PROJECT_HEADERS);
  if (sheet.getDataRange().getValues().length < 2) seedProjects(sheet);
  
  return jsonResponse(sheetToObjects(sheet).map(function(p) {
    var mainProj = String(p.main_project_name || p.main_category_name || p.main_project || p.project_name || p.site || p.project || '').trim();
    var subProj  = String(p.sub_project_name || p.sub_category_name || p.sub_project || p.subproject || '').trim();
    if (subProj.indexOf('↳') === 0) {
      subProj = subProj.substring(1).trim();
    }
    var parentId = (p.parent_id === null || p.parent_id === undefined || p.parent_id === false || p.parent_id === 0) ? '' : String(p.parent_id).trim();
    var projName = (parentId && subProj) ? subProj : mainProj;
    return {
      id:           String(p.id           || p.id_ || ''),
      project_name: projName,
      parent_id:    parentId,
      status:       p.status || 'active'
    };
  }));
}

function handleAddProject(body) {
  var sheet = getOrCreateSheet(SHEET_PROJECTS, PROJECT_HEADERS);
  var newId = getMaxId(sheet, 0) + 1;
  var parentId = body.parent_id || '';
  var mainProj = '';
  var subProj = '';
  if (parentId) {
    var parentName = '';
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(parentId)) {
        parentName = String(data[i][1] || '').trim();
        break;
      }
    }
    mainProj = parentName;
    subProj = '↳ ' + (body.project_name || '');
  } else {
    mainProj = body.project_name || '';
  }
  sheet.appendRow([newId, mainProj, subProj, parentId, 'active']);
  formatSheetTable(sheet);
  return jsonResponse({ status: 'ok', id: String(newId) });
}

function handleUpdateProject(body) {
  var sheet = getSheet(SHEET_PROJECTS);
  if (!sheet) return jsonResponse({ error: 'Projects sheet not found' });
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      if (body.project_name !== undefined) {
        var parentId = String(data[i][3] || '').trim();
        if (parentId) {
          sheet.getRange(i + 1, 3).setValue('↳ ' + body.project_name);
        } else {
          sheet.getRange(i + 1, 2).setValue(body.project_name);
          var newName = body.project_name;
          for (var j = 1; j < data.length; j++) {
            if (String(data[j][3]) === String(body.id)) {
              sheet.getRange(j + 1, 2).setValue(newName);
            }
          }
        }
      }
      if (body.status !== undefined) {
        sheet.getRange(i + 1, 5).setValue(body.status);
      }
      formatSheetTable(sheet);
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'Project not found' });
}

function handleDeleteProject(body) {
  var sheet = getSheet(SHEET_PROJECTS);
  if (!sheet) return jsonResponse({ error: 'Projects sheet not found' });
  var id = String(body.id || '').trim();
  if (!id) return jsonResponse({ error: 'ID is required' });

  var data = sheet.getDataRange().getValues();
  var deletedCount = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var rowId = String(data[i][0] || '').trim();
    var parentId = String(data[i][3] || '').trim();
    if (rowId === id || parentId === id) {
      sheet.deleteRow(i + 1);
      deletedCount++;
    }
  }
  formatSheetTable(sheet);
  return jsonResponse({ status: 'ok', deletedCount: deletedCount });
}

// ── ACTIVITIES ────────────────────────────────────────────────────

function seedActivities(sheet) {
  var catalog = [
    { name: 'RCC Work',           subs: ['Steel work','Formwork','Casting work','Dressing work','Misc. work'] },
    { name: 'Brick Work',         subs: ['Inside work','Outside work','Misc. work'] },
    { name: 'Plaster',            subs: ['Inside Plaster','Outside Plaster','Misc. work'] },
    { name: 'Waterproofing Work', subs: ['Terrace WP','Toilet WP','Misc. work'] },
    { name: 'Tile Flooring',      subs: ['Flooring','Dado','Misc. work'] },
    { name: 'Marble Flooring',    subs: ['Flooring','Skirting','Misc. work'] },
    { name: 'Epoxy Grouting',     subs: ['Misc. work'] },
    { name: 'Plumbing',           subs: ['Internal Plumbing','External Plumbing','Misc. work'] },
    { name: 'Polishing',          subs: ['Misc. work'] },
    { name: 'Furniture Work',     subs: ['Carpentry','Polish','Misc. work'] },
    { name: 'Modular Furniture',  subs: ['Installation','Misc. work'] },
    { name: 'HVAC Work',          subs: ['Ducting','Insulation','Misc. work'] },
    { name: 'Electrical Work',    subs: ['Conduit','Wiring','Panel','Misc. work'] },
    { name: 'IT Work',            subs: ['Cabling','Installation','Misc. work'] },
    { name: 'Aluminium Work',     subs: ['Doors','Windows','Partition','Misc. work'] },
    { name: 'CCTV Work',          subs: ['Cabling','Camera','Misc. work'] },
    { name: 'Paint Work',         subs: ['Putty','Primer','Final Coat','Misc. work'] },
    { name: 'Lift Work',          subs: ['Misc. work'] },
    { name: 'Fabrication Work',   subs: ['Steel Fabrication','SS Fabrication','Misc. work'] },
    { name: 'Cleaning Work',      subs: ['Misc. work'] },
    { name: 'False Ceiling',      subs: ['Grid','Gypsum','Misc. work'] },
    { name: 'Misc. Work',         subs: ['General'] }
  ];
  var id = 1;
  catalog.forEach(function(item) {
    sheet.appendRow([id, item.name, '', '', 'active']); var parentId = id; id++;
    item.subs.forEach(function(s) { sheet.appendRow([id, item.name, '↳ ' + s, parentId, 'active']); id++; });
  });
  formatSheetTable(sheet);
}

function handleGetActivities() {
  var sheet = getOrCreateSheet(SHEET_ACTIVITIES, ACTIVITY_HEADERS);
  if (sheet.getDataRange().getValues().length < 2) seedActivities(sheet);
  
  return jsonResponse(sheetToObjects(sheet).map(function(a) {
    var mainAct = String(a.main_category_name || a.main_activity || a.activity || a.activity_name || '').trim();
    var subAct  = String(a.sub_category_name || a.sub_activity || a.subActivity || a.subactivity || '').trim();
    if (subAct.indexOf('↳') === 0) {
      subAct = subAct.substring(1).trim();
    }
    var parentId = (a.parent_id === null || a.parent_id === undefined || a.parent_id === false || a.parent_id === 0) ? '' : String(a.parent_id).trim();
    var actName = (parentId && subAct) ? subAct : mainAct;
    return {
      id:            String(a.id            || a.id_ || ''),
      activity_name: actName,
      parent_id:     parentId,
      status:        a.status || 'active'
    };
  }));
}

function handleAddActivity(body) {
  var sheet = getOrCreateSheet(SHEET_ACTIVITIES, ACTIVITY_HEADERS);
  var newId = getMaxId(sheet, 0) + 1;
  var parentId = body.parent_id || '';
  var mainAct = '';
  var subAct = '';
  if (parentId) {
    var parentName = '';
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(parentId)) {
        parentName = String(data[i][1] || '').trim();
        break;
      }
    }
    mainAct = parentName;
    subAct = '↳ ' + (body.activity_name || '');
  } else {
    mainAct = body.activity_name || '';
  }
  sheet.appendRow([newId, mainAct, subAct, parentId, 'active']);
  formatSheetTable(sheet);
  return jsonResponse({ status: 'ok', id: String(newId) });
}

function handleUpdateActivity(body) {
  var sheet = getSheet(SHEET_ACTIVITIES);
  if (!sheet) return jsonResponse({ error: 'Activities sheet not found' });
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      if (body.activity_name !== undefined) {
        var parentId = String(data[i][3] || '').trim();
        if (parentId) {
          sheet.getRange(i + 1, 3).setValue('↳ ' + body.activity_name);
        } else {
          sheet.getRange(i + 1, 2).setValue(body.activity_name);
          var newName = body.activity_name;
          for (var j = 1; j < data.length; j++) {
            if (String(data[j][3]) === String(body.id)) {
              sheet.getRange(j + 1, 2).setValue(newName);
            }
          }
        }
      }
      if (body.status !== undefined) {
        sheet.getRange(i + 1, 5).setValue(body.status);
      }
      formatSheetTable(sheet);
      return jsonResponse({ status: 'ok' });
    }
  }
  return jsonResponse({ error: 'Activity not found' });
}

function handleDeleteActivity(body) {
  var sheet = getSheet(SHEET_ACTIVITIES);
  if (!sheet) return jsonResponse({ error: 'Activities sheet not found' });
  var id = String(body.id || '').trim();
  if (!id) return jsonResponse({ error: 'ID is required' });

  var data = sheet.getDataRange().getValues();
  var deletedCount = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var rowId = String(data[i][0] || '').trim();
    var parentId = String(data[i][3] || '').trim();
    if (rowId === id || parentId === id) {
      sheet.deleteRow(i + 1);
      deletedCount++;
    }
  }
  formatSheetTable(sheet);
  return jsonResponse({ status: 'ok', deletedCount: deletedCount });
}

// ── VISUAL FORMATTING ──────────────────────────────────────────────

function formatSheetTable(sheet) {
  try {
    var range = sheet.getDataRange();
    var numRows = range.getNumRows();
    var numCols = range.getNumColumns();
    if (numRows < 1) return;

    // Font family and size
    range.setFontFamily('Roboto');
    range.setFontSize(10);
    range.setVerticalAlignment('middle');

    // Header row (Row 1)
    var headerRange = sheet.getRange(1, 1, 1, numCols);
    headerRange.setFontWeight('bold');
    headerRange.setFontSize(11);
    headerRange.setBackground('#1e293b'); // Dark Slate
    headerRange.setFontColor('#ffffff'); // White text
    headerRange.setHorizontalAlignment('center');

    // Body formatting (Row 2 onwards)
    if (numRows > 1) {
      var bodyRange = sheet.getRange(2, 1, numRows - 1, numCols);
      // Soft borders
      bodyRange.setBorder(true, true, true, true, true, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);
      bodyRange.setFontColor('#334155'); // Soft black/slate
      
      // Zebra striping
      for (var r = 2; r <= numRows; r++) {
        var rowRange = sheet.getRange(r, 1, 1, numCols);
        if (r % 2 === 0) {
          rowRange.setBackground('#ffffff');
        } else {
          rowRange.setBackground('#f8fafc'); // Soft grayish white
        }
      }

      // Column-specific alignments
      // Col 1 (ID), Col 4 (Parent ID), Col 5 (Status) -> center aligned
      sheet.getRange(2, 1, numRows - 1, 1).setHorizontalAlignment('center');
      if (numCols >= 4) {
        sheet.getRange(2, 4, numRows - 1, 1).setHorizontalAlignment('center');
      }
      if (numCols >= 5) {
        sheet.getRange(2, 5, numRows - 1, 1).setHorizontalAlignment('center');
        
        // Color status badge
        var statusValues = sheet.getRange(2, 5, numRows - 1, 1).getValues();
        for (var i = 0; i < statusValues.length; i++) {
          var cell = sheet.getRange(i + 2, 5);
          var val = String(statusValues[i][0]).toLowerCase().trim();
          if (val === 'active') {
            cell.setFontColor('#15803d'); // Green
            cell.setFontWeight('bold');
          } else if (val === 'inactive') {
            cell.setFontColor('#b91c1c'); // Red
            cell.setFontWeight('bold');
          }
        }
      }
      
      // Col 2 (Main), Col 3 (Sub) -> left aligned
      sheet.getRange(2, 2, numRows - 1, 1).setHorizontalAlignment('left');
      if (numCols >= 3) {
        sheet.getRange(2, 3, numRows - 1, 1).setHorizontalAlignment('left');
      }
    }

    // Row heights
    sheet.setRowHeight(1, 38);
    for (var row = 2; row <= numRows; row++) {
      sheet.setRowHeight(row, 28);
    }

    // Auto-fit columns
    for (var col = 1; col <= numCols; col++) {
      sheet.autoResizeColumn(col);
      // Add padding
      var currentWidth = sheet.getColumnWidth(col);
      sheet.setColumnWidth(col, currentWidth + 25);
    }
  } catch (e) {
    Logger.log('Formatting error: ' + e.message);
  }
}

function handleFixSheetsAction() {
  var resA = fixActivitiesSheet();
  var resP = fixProjectsSheet();
  return jsonResponse({ status: 'ok', activities: resA, projects: resP });
}

function fixActivitiesSheet() {
  var sheet = getSheet(SHEET_ACTIVITIES);
  if (!sheet) return 'Activities sheet not found';
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No data to fix';
  
  var parsedMap = {};
  var parsedList = [];
  
  // First pass: extract ID, rawName, parentId, status
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    
    var status = 'active';
    var numbers = [];
    var textParts = [];
    
    for (var c = 1; c < row.length; c++) {
      var val = String(row[c] || '').trim();
      if (!val) continue;
      var lowerVal = val.toLowerCase();
      if (lowerVal === 'active' || lowerVal === 'inactive') {
        status = lowerVal;
      } else if (!isNaN(Number(val))) {
        numbers.push(val);
      } else {
        textParts.push(val);
      }
    }
    
    var rawName = textParts.join(' ').trim();
    var parentId = (numbers.length > 0) ? String(numbers[numbers.length - 1]).trim() : '';
    
    if (rawName.indexOf('↳') === 0) {
      rawName = rawName.substring(1).trim();
    }
    
    var item = {
      id: id,
      rawName: rawName,
      parentId: parentId,
      status: status
    };
    parsedMap[id] = item;
    parsedList.push(item);
  }
  
  // Second pass: construct new rows with headers
  var newRows = [];
  newRows.push(ACTIVITY_HEADERS);
  
  parsedList.forEach(function(item) {
    var mainName = '';
    var subName = '';
    var parentId = item.parentId;
    
    if (!parentId || parentId === '0') {
      mainName = item.rawName;
      subName = '';
      parentId = '';
    } else {
      var parentObj = parsedMap[parentId];
      var parentName = parentObj ? parentObj.rawName : 'Unknown Category';
      mainName = parentName;
      subName = '↳ ' + item.rawName;
    }
    newRows.push([Number(item.id) || item.id, mainName, subName, parentId, item.status]);
  });
  
  sheet.clear();
  sheet.getRange(1, 1, newRows.length, ACTIVITY_HEADERS.length).setValues(newRows);
  formatSheetTable(sheet);
  
  return 'Success: aligned and formatted ' + (newRows.length - 1) + ' activities.';
}

function fixProjectsSheet() {
  var sheet = getSheet(SHEET_PROJECTS);
  if (!sheet) return 'Projects sheet not found';
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No data to fix';
  
  var parsedMap = {};
  var parsedList = [];
  
  // First pass: extract ID, rawName, parentId, status
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    
    var status = 'active';
    var numbers = [];
    var textParts = [];
    
    for (var c = 1; c < row.length; c++) {
      var val = String(row[c] || '').trim();
      if (!val) continue;
      var lowerVal = val.toLowerCase();
      if (lowerVal === 'active' || lowerVal === 'inactive') {
        status = lowerVal;
      } else if (!isNaN(Number(val))) {
        numbers.push(val);
      } else {
        textParts.push(val);
      }
    }
    
    var rawName = textParts.join(' ').trim();
    var parentId = (numbers.length > 0) ? String(numbers[numbers.length - 1]).trim() : '';
    
    if (rawName.indexOf('↳') === 0) {
      rawName = rawName.substring(1).trim();
    }
    
    var item = {
      id: id,
      rawName: rawName,
      parentId: parentId,
      status: status
    };
    parsedMap[id] = item;
    parsedList.push(item);
  }
  
  // Second pass: construct new rows with headers
  var newRows = [];
  newRows.push(PROJECT_HEADERS);
  
  parsedList.forEach(function(item) {
    var mainName = '';
    var subName = '';
    var parentId = item.parentId;
    
    if (!parentId || parentId === '0') {
      mainName = item.rawName;
      subName = '';
      parentId = '';
    } else {
      var parentObj = parsedMap[parentId];
      var parentName = parentObj ? parentObj.rawName : 'Unknown Project';
      mainName = parentName;
      subName = '↳ ' + item.rawName;
    }
    newRows.push([Number(item.id) || item.id, mainName, subName, parentId, item.status]);
  });
  
  sheet.clear();
  sheet.getRange(1, 1, newRows.length, PROJECT_HEADERS.length).setValues(newRows);
  formatSheetTable(sheet);
  
  return 'Success: aligned and formatted ' + (newRows.length - 1) + ' projects.';
}
