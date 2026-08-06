/**
 * Club-kit template: League sign-up form (no hardcoded club values).
 *
 * Same behavior as the CCTTC version, but all club-specific values come from
 * a "Setup" sheet in the linked response spreadsheet:
 *
 *   Signup form link   - URL the club shares for signups (used in messages)
 *   Signup location    - where the club plays (address + optional map link)
 *   Signup time        - when the club plays
 *   Logo image URL     - Google Drive image URL for the sheet banner
 *   League results link - URL to the club's Ratings/Results page
 *   Response spreadsheet ID - which spreadsheet the form writes to
 *
 * The setupSpreadsheet() function creates the Setup sheet with defaults.
 */

const SETUP_SHEET = 'Setup';

function getSetupValue(ss, key, fallback) {
  const sheet = ss.getSheetByName(SETUP_SHEET);
  if (!sheet) return fallback;
  const values = sheet.getDataRange().getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] && String(values[i][0]).trim().toLowerCase() === String(key).toLowerCase()) {
      return String(values[i][1]).trim();
    }
  }
  return fallback;
}

/**
 * Resolve the "Are youse playing?" multiple-choice question by scanning the
 * form for a Multiple Choice item instead of relying on a hardcoded item ID
 * (which is form-specific and breaks the club-kit template for other clubs).
 */
function getPlayingItem(form) {
  var items = form.getItems();
  for (var i = 0; i < items.length; i++) {
    if (items[i].getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      return items[i];
    }
  }
  throw new Error('No multiple-choice "Are youse playing?" question found on the form.');
}

function newLeagueDate() {
  var form = FormApp.getActiveForm();
  var ss = null;
  var responseSpreadsheetId = null;

  // Read Setup from the form's destination spreadsheet if available.
  try {
    responseSpreadsheetId = form.getDestinationId();
    if (responseSpreadsheetId) {
      ss = SpreadsheetApp.openById(responseSpreadsheetId);
    }
  } catch (e) {
    ss = null;
  }

  var signupLink = getSetupValue(ss, 'Signup form link', '');
  var location = getSetupValue(ss, 'Signup location', '');
  var time = getSetupValue(ss, 'Signup time', '');
  var resultsLink = getSetupValue(ss, 'League results link', '');
  var logoUrl = getSetupValue(ss, 'Logo image URL', '');

  form.setTitle(form.getTitle().replace("Signup(", "Signup\n(").replace(")**", ")\n**"));

  var form_description = "Short url to this page: " + signupLink + "\n\nRegistered players: " + resultsLink +
    "\n\nLocation: " + location + "\n\nTime: " + time + ".";
  var confirmation_msg = "Your response has been recorded. \n\nRegistered players: " + resultsLink +
    "\n\nTo signup or edit your response: " + signupLink + "\n\n";

  form.setConfirmationMessage(confirmation_msg);

  var formItems = form.getItems();
  for (var i = 0; i < formItems.length; i++) {
    var title = formItems[i].getTitle();
    if (/email/i.test(title)) {
      formItems[i].setTitle('Email Addresses');
    } else if (/name/i.test(title)) {
      formItems[i].setTitle('Names');
    }
  }
  getPlayingItem(form).setTitle('Are youse playing?');

  if (!form.isAcceptingResponses()) {
    form.setTitle(form.getTitle().replace("OPEN", "CLOSED"));
    form.setDescription('Signup is closed, please check back later.\n\n' + form_description);
    getPlayingItem(form).asMultipleChoiceItem().setChoiceValues(["No"]);
  } else {
    form.setTitle(form.getTitle().replace("CLOSED", "OPEN"));
    form.setDescription(form_description);
    getPlayingItem(form).asMultipleChoiceItem().setChoiceValues(["Yes", "No"]);
  }

  var now = new Date();

  var ss_id = form.getDestinationId();
  if (!ss_id) { ss_id = responseSpreadsheetId; }
  if (!ss_id) {
    Logger.log('No destination spreadsheet set on the form. Link the form to a spreadsheet first.');
    return;
  }
  if (!ss) { ss = SpreadsheetApp.openById(ss_id); }

  // Calculate next Saturday
  var skip_days = 6 - now.getDay();
  skip_days = skip_days < 1 ? 7 : skip_days;
  var next_sat = new Date(now.getTime());
  next_sat.setDate(now.getDate() + skip_days);

  var options = {month: 'short'};
  var new_date_str = `${new Intl.DateTimeFormat('en-US', options).format(next_sat)} ${next_sat.getDate()}, ${next_sat.getFullYear()}`;
  var new_title = `League Play Sign-up\n(${new_date_str})\n** Registration OPEN **`;

  form.setAcceptingResponses(true);
  form.setTitle(new_title);
  form.setDescription(form_description);
  form.deleteAllResponses();
  getPlayingItem(form).asMultipleChoiceItem().setChoiceValues(["Yes", "No"]);

  var sheet = ss.getSheetByName(new_date_str);
  if (sheet) {
    Logger.log('Sheet ' + new_date_str + ' already exists — skipping creation.');
    return;
  }
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  sheet = ss.getSheets()[0];
  sheet.setName(new_date_str);

    sheet.setFrozenRows(0);

    sheet.insertRowsBefore(1, 2);
    sheet.insertColumnsBefore(1, 2);
    var rowsToDelete = sheet.getMaxRows() - 5;
    if (rowsToDelete > 0) { sheet.deleteRows(6, rowsToDelete); }
    var colsToDelete = sheet.getMaxColumns() - 7;
    if (colsToDelete > 0) { sheet.deleteColumns(8, colsToDelete); }
    sheet.setColumnWidth(1, 60);
    sheet.setColumnWidth(2, 31);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 250);
    sheet.setColumnWidth(5, 175);
    sheet.setColumnWidth(6, 190);
    sheet.setColumnWidth(7, 60);
    sheet.setRowHeight(1, 60);
    sheet.setRowHeight(2, 90);
    sheet.setRowHeight(3, 31);
    sheet.setRowHeight(4, 31);
    sheet.setRowHeight(5, 60);
    sheet.getRange('B2:F2').mergeAcross();
    sheet.getRange('D4:E4').mergeAcross();
    sheet.getRange(3, 1, sheet.getMaxRows() - 2, 7).setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    sheet.getRange('D:D').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    sheet.getRange('E:E').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

    var tableBand = sheet.getRange('A3:F3').getBandings()[0];
    if (tableBand) {
        tableBand.setRange(sheet.getRange('C3:F3'));
        tableBand.setHeaderRowColor('#d9d2e9')
            .setFirstRowColor('#ffffff')
            .setSecondRowColor('#f8f9fa')
            .setFooterRowColor(null);
    }
    sheet.getRange('A3').clear({contentsOnly: true});

    sheet.getRange('B3').setFormula('=ARRAYFORMULA(If(ROW(B3:B)=1, "Number", (ROW(B3:B)-3)&"."))');
    sheet.getRange('F4').setFormula('="Total Players = "& COUNTIF (F:F, "Yes")').setBorder(null, true, null, null, null, null, '#000000',   SpreadsheetApp.BorderStyle.SOLID_THIN);
    sheet.getRange('B2:F2').setBorder(null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
    sheet.getRange('B4:F4').setBorder(true, null, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
    sheet.getRange('C3').setValue('Timestamps').setFontWeight('bold').setBorder(null, true, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID).setBorder(null, null, null, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange('C4').setBorder(null, null, null, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THIN);
    sheet.getRange('D3').setValue('Email Addresses').setFontWeight('bold').setBorder(null, null, null, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange('E3').setValue('Names');
    sheet.getRange('F3').setValue('Are youse playing?').setBorder(null, true, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange('3:4').setFontSize(15).setFontWeight('bold');
    sheet.getRange('D4:E4').setValue('Total Player Limit = 15').setBorder(null, true, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THIN).setHorizontalAlignment('center');
    sheet.getRange('A1:G1').setBackground('#c6c0ab');
    sheet.getRange('A2:A4').setBackground('#c6c0ab');
    sheet.getRange('B2:F2').setBackground('#fce5cd');
    sheet.getRange('B3').setBackground('#d9d2e9').setFontColor('#d9d2e9');
    sheet.getRange('B4:F4').setBackground('#c9daf8');
    sheet.getRange('B4').setFontColor('#c9daf8').setBorder(null, null, null, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THIN);
    sheet.getRange('C3:F3').setBackground('#d9d2e9').setFontColor('#000000');
    sheet.getRange('A5:G5').setBackground('#c6c0ab');
    sheet.getRange('G2:G4').setBackground('#c6c0ab');
    sheet.getRange('B5').setFontColor('#c6c0ab');
    sheet.getRange('A1:G5').setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
    sheet.getRange('B2:F4').setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
    sheet.setHiddenGridlines(true);
    sheet.getRange('C3:C5').setHorizontalAlignment('center');
    sheet.getRange('F3:F5').setHorizontalAlignment('center');
    if (logoUrl) {
      sheet.getRange('B2').setFormula('=IMAGE("' + logoUrl + '")');
    }
    sheet.getRange('C4').setRichTextValue(SpreadsheetApp.newRichTextValue().setText('League Results').setLinkUrl(resultsLink).build()).setFontColor('#000000').setFontLine('none');
    SpreadsheetApp.flush();

    // Fix headers on the previous response sheet (form push reverts C3/D3)
    var allSheets = ss.getSheets();
    var dateRegex = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}$/;
    for (var i = 0; i < allSheets.length; i++) {
        var s = allSheets[i];
        if (s.getSheetId() !== sheet.getSheetId() && dateRegex.test(s.getName())) {
            s.getRange('C3').setValue('Timestamps');
            s.getRange('D3').setValue('Email Addresses');
            s.getRange('E3').setValue('Names');
            s.getRange('F3').setValue('Are youse playing?');
            s.getRange('3:3').setFontSize(15).setFontWeight('bold');
            break;
        }
    }
    SpreadsheetApp.flush();
}

function limitYesResponses() {
  var form = FormApp.getActiveForm();
  var item = getPlayingItem(form);
  if (!item) {
    Logger.log('Item not found. Check the item ID.');
    return;
  }
  var responses = form.getResponses();
  var yesCount = 0;
  responses.forEach(function(response) {
    var itemResponses = response.getItemResponses();
    var itemResponse = itemResponses.find(function(r) {
      return r.getItem().getId() === itemId;
    });
    if (itemResponse) {
      var answers = itemResponse.getResponse();
      Logger.log('Answers: ' + answers);
      if (answers && answers.indexOf('Yes') !== -1) {
        yesCount++;
      }
    }
  });
  Logger.log('Number of Yes checks: ' + yesCount);
  if (yesCount >= 15) {
    form.setAcceptingResponses(false);
    Logger.log('Form has been closed due to Yes responses.');
  }
}

function logItemByIds() {
  var form = FormApp.getActiveForm();
  var items = form.getItems();
  for (var i in items) {
    Logger.log('"' + items[i].getTitle() + '" has ID: ' + items[i].getId());
  }
}
