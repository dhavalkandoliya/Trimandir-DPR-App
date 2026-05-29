// ================================================================
// Trimandir DPR — Google Apps Script Backend (Code.gs)
// STRICT SCHEMA — matching exact spreadsheet column layout
// FOR CIVIL WORKS ONLY
//
// DPR_Records (A→J):
//   A=Date  B=Site  C=Prepared By  D=Activity Details  E=Total Manpower
//   F=Last Updated  G=submittedAt  H=editPermission  I=requestedBy
//   J=activities(JSON)
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
var RECORDS_HEADERS  = ['Date','Site','Prepared By','Activity Details','Total Manpower','Last Updated','submittedAt','editPermission','requestedBy','civilActivities'];
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
  civilActivities:    9    // J
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

function setupDPRSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Setup Projects Sheet
  let projectsSheet = ss.getSheetByName('Projects');
  if (projectsSheet) {
    projectsSheet.clear(); // Completely wipe the sheet clean
  } else {
    projectsSheet = ss.insertSheet('Projects');
  }
  projectsSheet.appendRow(['id', 'main_project_name', 'sub_project_name', 'parent_id', 'status']);
  projectsSheet.getRange('A1:E1').setFontWeight('bold');
  projectsSheet.setFrozenRows(1);

  // 2. Setup Activities Sheet
  let activitiesSheet = ss.getSheetByName('Activities');
  if (activitiesSheet) {
    activitiesSheet.clear(); // Completely wipe the sheet clean
  } else {
    activitiesSheet = ss.insertSheet('Activities');
  }
  activitiesSheet.appendRow(['id', 'main_category_name', 'sub_category_name', 'parent_id', 'status']);
  activitiesSheet.getRange('A1:E1').setFontWeight('bold');
  activitiesSheet.setFrozenRows(1);
  
  // 3. Populate Core Civil Work Items ONLY
  const initialActivities = [
    ['c1', 'Core Civil Work', '', '', 'active'],
    ['c1_1', 'Core Civil Work', 'Excavation / Backfilling', 'c1', 'active'],
    ['c1_2', 'Core Civil Work', 'PCC / RCC', 'c1', 'active'],
    ['c1_3', 'Core Civil Work', 'Brickwork / Blockwork', 'c1', 'active'],
    ['c1_4', 'Core Civil Work', 'Plaster', 'c1', 'active'],
    ['c1_5', 'Core Civil Work', 'Waterproofing', 'c1', 'active'],
    
    ['c2', 'Door Shutter', '', '', 'active'],
    ['c2_1', 'Door Shutter', 'Frame Fixing', 'c2', 'active'],
    ['c2_2', 'Door Shutter', 'Shutter Fixing', 'c2', 'active'],
    ['c2_3', 'Door Shutter', 'Hardware & Accessories', 'c2', 'active'],
    
    ['c3', 'Aluminium Work', '', '', 'active'],
    ['c3_1', 'Aluminium Work', 'Track / Frame Fixing', 'c3', 'active'],
    ['c3_2', 'Aluminium Work', 'Glass & Shutter Fixing', 'c3', 'active'],
    ['c3_3', 'Aluminium Work', 'Louvers & Vents', 'c3', 'active'],
    
    ['c4', 'Paint Work', '', '', 'active'],
    ['c4_1', 'Paint Work', 'Putty (1st & 2nd Coat)', 'c4', 'active'],
    ['c4_2', 'Paint Work', 'Primer', 'c4', 'active'],
    ['c4_3', 'Paint Work', 'Paint Coat', 'c4', 'active']
  ];
  
  activitiesSheet.getRange(2, 1, initialActivities.length, 5).setValues(initialActivities);
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
      civilActivities:    parseJsonArr(row[REC.civilActivities])
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
    toJsonStr(civilArr)     // J: civilActivities
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
  return jsonResponse(sheetToObjects(sheet).map(function(p) {
    return {
      id:            p.id,
      project_name:  p.sub_project_name || p.main_project_name,
      parent_id:     p.parent_id || '',
      status:        p.status || 'active'
    };
  }));
}

function handleAddProject(body) {
  var sheet = getOrCreateSheet(SHEET_PROJECTS, PROJECT_HEADERS);
  var maxId = getMaxId(sheet, 0);
  var newId = 'p' + (maxId + 1);
  var isSub = !!body.parent_id;
  var mainName = isSub ? '' : (body.project_name || body.main_project_name || '');
  var subName  = isSub ? (body.project_name || body.sub_project_name || '') : '';
  sheet.appendRow([newId, mainName, subName, body.parent_id || '', 'active']);
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
  return jsonResponse(sheetToObjects(sheet).map(function(a) {
    return {
      id:            a.id,
      activity_name: a.sub_category_name || a.main_category_name,
      parent_id:     a.parent_id || '',
      status:        a.status || 'active'
    };
  }));
}

function handleAddActivity(body) {
  var sheet = getOrCreateSheet(SHEET_ACTIVITIES, ACTIVITY_HEADERS);
  var maxId = getMaxId(sheet, 0);
  var newId = 'a' + (maxId + 1);
  sheet.appendRow([newId, body.main_category_name || '', body.sub_category_name || '', body.parent_id || '', 'active']);
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
