/**
 * Club-kit template: League sign-up sheet (no hardcoded club values).
 *
 * Same behavior as the CCTTC version, but all club-specific values come from
 * a "Setup" sheet created by setupSpreadsheet(). Clubs only edit the Setup
 * sheet - no code changes needed.
 *
 * Setup sheet keys used here:
 *   Response spreadsheet ID      - the spreadsheet the signup form writes to
 *   Main spreadsheet ID          - the spreadsheet with the Ratings sheet
 *   Recipient emails             - comma-separated email recipients
 *   Sender name                  - shown as the email "from" name
 *   Club name                    - used in the email subject/body
 */

const SETUP_SHEET = 'Setup';
const HEADER_ROW = 3;

function getSetupValue(key, fallback) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SETUP_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SETUP_SHEET);
  }
  const defaults = [
    ['Club name', 'My Table Tennis Club'],
    ['Response spreadsheet ID', ''],
    ['Main spreadsheet ID', ''],
    ['Recipient emails', ''],
    ['Sender name', 'Club Ratings System'],
    ['USATT staleness (years)', '2'],
    ['Logo image URL', ''],
    ['Signup location', ''],
    ['Signup time', ''],
    ['Signup form link', '']
  ];
  const existing = {};
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0]) existing[String(data[i][0]).trim().toLowerCase()] = true;
  }
  for (let i = 0; i < defaults.length; i++) {
    if (!existing[defaults[i][0].toLowerCase()]) {
      sheet.appendRow(defaults[i]);
    }
  }
  sheet.getRange('A1:B' + Math.max(sheet.getLastRow(), defaults.length)).setFontWeight('bold');
  sheet.getRange('A1').setValue('Setting').setFontWeight('bold');
  sheet.getRange('B1').setValue('Value').setFontWeight('bold');
  ss.toast('Setup sheet ready - fill in the values, then re-run setup.', 'Setup', 5);
}

function sendSaturdayEmail() {
  try {
    const responseSpreadsheetId = getSetupValue('Response spreadsheet ID', '');
    const mainSpreadsheetId = getSetupValue('Main spreadsheet ID', '');
    const recipientEmail = getSetupValue('Recipient emails', '');
    const senderName = getSetupValue('Sender name', 'Club Ratings System');
    const clubName = getSetupValue('Club name', 'Club');

    if (!responseSpreadsheetId || !mainSpreadsheetId || !recipientEmail) {
      Logger.log('Setup incomplete: fill in the Setup sheet first.');
      return;
    }

    const signUpSS = SpreadsheetApp.openById(responseSpreadsheetId);
    const ratingsSS = SpreadsheetApp.openById(mainSpreadsheetId);
    const ratingsSheet = ratingsSS.getSheetByName('CCTTC Player Ratings');

    if (!ratingsSheet) {
      throw new Error('Ratings sheet not found in main spreadsheet');
    }

    const today = new Date();
    const sheetName = formatDateForSheet(today);
    const signUpSheet = signUpSS.getSheetByName(sheetName);

    if (!signUpSheet) {
      sendErrorEmail(recipientEmail, `Saturday sheet "${sheetName}" not found.`);
      return;
    }

    const signUpData = signUpSheet.getDataRange().getValues();
    const headers = signUpData[HEADER_ROW - 1];
    const emailColIndex = headers.findIndex(h => String(h).toLowerCase().includes('email'));
    const playingColIndex = headers.findIndex(h => String(h).toLowerCase().includes('are you playing') || String(h).toLowerCase().includes('playing'));
    const nameColIndex = headers.findIndex(h => String(h).toLowerCase().includes('name'));

    if (emailColIndex === -1 || playingColIndex === -1 || nameColIndex === -1) {
      sendErrorEmail(recipientEmail, `Could not find required columns in sheet "${sheetName}". Email col: ${emailColIndex}, Playing col: ${playingColIndex}, Name col: ${nameColIndex}`);
      return;
    }

    const ratingsData = ratingsSheet.getRange('A2:DC').getValues();
    const emailToRating = {};
    const emailToDBName = {};

    function addEmailLookup(emailAddr, rating, dbName) {
      if (emailAddr && String(emailAddr).trim() !== '') {
        const emailKey = String(emailAddr).trim().toLowerCase();
        if (!emailToRating[emailKey]) {
          emailToRating[emailKey] = rating || 0;
          emailToDBName[emailKey] = dbName || 'Unknown';
        }
      }
    }

    // Combined Ratings layout: CZ = primary email (index 103), DC = secondary email (index 106).
    for (let i = 0; i < ratingsData.length; i++) {
      addEmailLookup(ratingsData[i][103], ratingsData[i][2], ratingsData[i][1]);
      addEmailLookup(ratingsData[i][106], ratingsData[i][2], ratingsData[i][1]);
    }

    const yesPlayers = [];
    const otherPlayers = [];

    for (let i = HEADER_ROW; i < signUpData.length; i++) {
      const row = signUpData[i];
      const email = String(row[emailColIndex] || '').trim().toLowerCase();
      const playingStatus = String(row[playingColIndex] || '').trim();
      const signUpName = String(row[nameColIndex] || '').trim();

      if (!email || email === '' || email.includes('http') ||
          signUpName.toLowerCase().includes('league results') ||
          signUpName.toLowerCase().includes('total players') ||
          playingStatus.toLowerCase().includes('total players') ||
          email.toLowerCase().includes('player limit')) {
        continue;
      }

      const displayName = signUpName || emailToDBName[email] || 'Unknown';
      const playerInfo = {
        name: displayName,
        rating: parseFloat(emailToRating[email]) || 0,
        playingStatus: playingStatus
      };

      if (isYesResponse(playingStatus)) {
        yesPlayers.push(playerInfo);
      } else {
        otherPlayers.push(playerInfo);
      }
    }

    yesPlayers.sort((a, b) => b.rating - a.rating);
    otherPlayers.sort((a, b) => b.rating - a.rating);

    let emailBody = '<html><body>';
    emailBody += `<h2>${clubName} Table Tennis Sign-ups for ${sheetName}</h2>`;
    emailBody += '<h3>Players Planning to Attend:</h3>';
    emailBody += '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">';
    emailBody += '<tr><th style="background-color: #90EE90; padding: 8px;"></th><th style="background-color: #90EE90; padding: 8px;">Name</th><th style="background-color: #90EE90; padding: 8px;">Rating</th><th style="background-color: #90EE90; padding: 8px;">Status</th></tr>';

    for (let i = 0; i < yesPlayers.length; i++) {
      const player = yesPlayers[i];
      emailBody += `<tr><td>${i + 1}.</td><td>${player.name}</td><td>${player.rating.toFixed(2)}</td><td>${player.playingStatus}</td></tr>`;
    }

    emailBody += '</table>';
    emailBody += '<hr style="border: 2px solid black; margin: 20px 0;">';
    emailBody += '<h3>Other Responses:</h3>';
    emailBody += '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">';
    emailBody += '<tr><th style="background-color: #FFA5A5; padding: 8px;"></th><th style="background-color: #FFA5A5; padding: 8px;">Name</th><th style="background-color: #FFA5A5; padding: 8px;">Rating</th><th style="background-color: #FFA5A5; padding: 8px;">Status</th></tr>';

    for (let i = 0; i < otherPlayers.length; i++) {
      const player = otherPlayers[i];
      emailBody += `<tr><td>${i + 1}.</td><td>${player.name}</td><td>${player.rating.toFixed(2)}</td><td>${player.playingStatus}</td></tr>`;
    }

    emailBody += '</table>';
    emailBody += `<p><br>Total responses: ${yesPlayers.length + otherPlayers.length}</p>`;
    emailBody += `<p>Players planning to attend: ${yesPlayers.length}</p>`;
    emailBody += '</body></html>';

    GmailApp.sendEmail(
      recipientEmail,
      `${clubName} Table Tennis Sign-ups for ${sheetName}`,
      '',
      { htmlBody: emailBody, name: senderName }
    );

    Logger.log(`Email sent successfully to ${recipientEmail} for ${sheetName}`);

  } catch (error) {
    sendErrorEmail(getSetupValue('Recipient emails', ''), `Error in sendSaturdayEmail: ${error.toString()}\n\nStack trace: ${error.stack}`);
  }
}

function isYesResponse(response) {
  if (!response || response === '') {
    return false;
  }

  const lowerResponse = String(response).toLowerCase().trim();

  if (lowerResponse.includes('not')) {
    return false;
  }

  if (lowerResponse.includes('y')) {
    return true;
  }

  const specialWords = ['affirmative', 'sure', 'indeed'];
  for (const word of specialWords) {
    if (lowerResponse.includes(word)) {
      return true;
    }
  }

  return false;
}

function sendErrorEmail(recipientEmail, errorMessage) {
  try {
    GmailApp.sendEmail(
      recipientEmail,
      'ERROR: Saturday Table Tennis Email',
      errorMessage,
      { name: 'Club Ratings System - ERROR' }
    );
    Logger.log('Error email sent: ' + errorMessage);
  } catch (e) {
    Logger.log('Failed to send error email: ' + e.toString());
    Logger.log('Original error: ' + errorMessage);
  }
}

function formatDateForSheet(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function installSaturdayEmailTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'sendSaturdayEmail') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('sendSaturdayEmail')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(6)
    .create();

  Logger.log('Saturday email trigger installed - will run every Saturday at 6:00 AM');
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Saturday email trigger installed successfully!', 'Trigger Installed', 5
  );
}

function testSaturdayEmail() {
  sendSaturdayEmail();
}

function onFormSubmit(e) {
  const sheet = e.range.getSheet();
  const submittedRow = e.range.getRow();
  const lastColumn = sheet.getLastColumn();
  const colorWhite = "#ffffff";
  const colorGray = "#d9d9d9";
  const borderThinSolid = SpreadsheetApp.BorderStyle.SOLID_THIN;
  const borderThickSolid = SpreadsheetApp.BorderStyle.SOLID_THICK;
  const fullRowRange = sheet.getRange(submittedRow, 1, 1, lastColumn);
  fullRowRange.setFontSize(11).setFontWeight("bold").setFontColor("#000000");
  const colorToApply = ((submittedRow - 1) % 2 === 0) ? colorGray : colorWhite;
  const mainContentRange = sheet.getRange(submittedRow, 2, 1, 5);
  mainContentRange.setBackground(colorToApply);
  const topBorderStyle = submittedRow === 4 ? borderThickSolid : borderThinSolid;
  const cellA = sheet.getRange(submittedRow, 1);
  cellA.setBackground("#c6c0ab");
  cellA.setBorder(null, true, null, true, false, false, "#000000", borderThickSolid);
  const cellG = sheet.getRange(submittedRow, 7);
  cellG.setBackground("#c6c0ab");
  cellG.setBorder(null, true, null, true, false, false, "#000000", borderThickSolid);
  mainContentRange.setBorder(true, null, null, null, null, null, null, topBorderStyle);
  const cellC = sheet.getRange(submittedRow, 3);
  const cellD = sheet.getRange(submittedRow, 4);
  const cellE = sheet.getRange(submittedRow, 5);
  cellC.setBorder(null, true, null, true, null, null, null, borderThinSolid);
  cellD.setBorder(null, null, null, true, null, null, null, borderThinSolid);
  cellE.setBorder(null, null, null, true, null, null, null, borderThinSolid);
  const centerRangeList = sheet.getRangeList([`B${submittedRow}:C${submittedRow}`, `F${submittedRow}`]);
  centerRangeList.setHorizontalAlignment("center").setVerticalAlignment('middle');
  const leftRangeList = sheet.getRangeList([`D${submittedRow}:E${submittedRow}`]);
  leftRangeList.setHorizontalAlignment("left").setVerticalAlignment('middle');
  sheet.setRowHeight(submittedRow, 30);
  sheet.getRange('D3').setValue('Email Addresses');
  sheet.getRange('E3').setValue('Names');
  sheet.getRange('F3').setValue('Are youse playing?');
  sheet.getRange('3:3').setFontSize(15).setFontWeight('bold');
  sheet.getRange('B3:F3').setBorder(null, null, true, null, false, false, "#000000", SpreadsheetApp.BorderStyle.SOLID_THICK).setFontWeight('bold');
  sheet.getRange('C3').setValue('Timestamps').setBorder(null, true, null, true, false, false, "#000000", SpreadsheetApp.BorderStyle.SOLID_THIN);
  sheet.getRange('D3').setBorder(null, null, null, true, false, false, "#000000", SpreadsheetApp.BorderStyle.SOLID_THIN);
  sheet.getRange('F3').setBorder(null, true, null, null, false, false, "#000000", SpreadsheetApp.BorderStyle.SOLID_THIN);
}

function onOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (!sheet) return;
  var name = sheet.getName();
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}$/.test(name)) {
    sheet.getRange('C3').setValue('Timestamps');
    sheet.getRange('D3').setValue('Email Addresses');
    sheet.getRange('E3').setValue('Names');
    sheet.getRange('F3').setValue('Are youse playing?');
    sheet.getRange('3:3').setFontSize(15).setFontWeight('bold');
  }
}
