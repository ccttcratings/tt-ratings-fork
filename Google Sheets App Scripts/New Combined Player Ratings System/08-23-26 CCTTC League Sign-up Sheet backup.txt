const RESPONSE_SPREADSHEET_ID = '1_Ou_wAKDovm5ASpc85cpGGbxKZcJkiEIEgifOE0ClBk';
const MAIN_SPREADSHEET_ID = '1NdnC1kN831FVfcInOmFBfe-PU5tgKjFh3I-uxPdVGJM';
const RECIPIENT_EMAIL = 'jddavid6409@yahoo.com, bryant@champaigntabletennis.com';
const HEADER_ROW = 1;

function sendSaturdayEmail() {
  try {
    const signUpSS = SpreadsheetApp.openById(RESPONSE_SPREADSHEET_ID);
    const ratingsSS = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const ratingsSheet = ratingsSS.getSheetByName('Ratings');

    if (!ratingsSheet) {
      throw new Error('Ratings sheet not found in main spreadsheet');
    }

    const today = new Date();
    const sheetName = formatDateForSheet(today);
    const signUpSheet = signUpSS.getSheetByName('Raw ' + sheetName);

    if (!signUpSheet) {
      sendErrorEmail(`Saturday sheet "Raw ${sheetName}" not found.`);
      return;
    }

    const signUpData = signUpSheet.getDataRange().getValues();
    const headers = signUpData[HEADER_ROW - 1];
    const emailColIndex = headers.findIndex(h => String(h).toLowerCase().includes('email'));
    const playingColIndex = headers.findIndex(h => String(h).toLowerCase().includes('are you playing') || String(h).toLowerCase().includes('playing') || String(h).toLowerCase().includes('responses'));
    const nameColIndex = headers.findIndex(h => String(h).toLowerCase().includes('name'));

    if (emailColIndex === -1 || playingColIndex === -1 || nameColIndex === -1) {
      sendErrorEmail(`Could not find required columns in sheet "Raw ${sheetName}". Email col: ${emailColIndex}, Playing col: ${playingColIndex}, Name col: ${nameColIndex}`);
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

      if (!email || email === '') {
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
    emailBody += `<h2>Saturday Table Tennis Sign-ups for ${sheetName}</h2>`;
    emailBody += '<h3>Players Planning to Attend:</h3>';
    emailBody += '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">';
    emailBody += '<tr><th style="background-color: #b6d7a8; padding: 8px;"></th><th style="background-color: #b6d7a8; padding: 8px;">Names</th><th style="background-color: #b6d7a8; padding: 8px;">Ratings</th><th style="background-color: #b6d7a8; padding: 8px; text-align: center;">Responses</th></tr>';
    
    // Loop 1: YES Players (Response centered)
    for (let i = 0; i < yesPlayers.length; i++) {
      const player = yesPlayers[i];
      emailBody += `<tr><td style="padding: 8px;">${i + 1}.</td><td style="padding: 8px;">${player.name}</td><td style="padding: 8px;">${player.rating.toFixed(2)}</td><td style="padding: 8px; text-align: center;">${player.playingStatus}</td></tr>`;
    }

    emailBody += '</table>';
    emailBody += '<hr style="border: 2px solid black; margin: 20px 0;">';
    emailBody += '<h3>Other Responses:</h3>';
    emailBody += '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">';
    emailBody += '<tr><th style="background-color: #FFA5A5; padding: 8px;"></th><th style="background-color: #FFA5A5; padding: 8px;">Names</th><th style="background-color: #FFA5A5; padding: 8px;">Ratings</th><th style="background-color: #FFA5A5; padding: 8px; text-align: center;">Responses</th></tr>';

    // Loop 2: OTHER Players (Response centered)
    for (let i = 0; i < otherPlayers.length; i++) {
      const player = otherPlayers[i];
      emailBody += `<tr><td style="padding: 8px;">${i + 1}.</td><td style="padding: 8px;">${player.name}</td><td style="padding: 8px;">${player.rating.toFixed(2)}</td><td style="padding: 8px; text-align: center;">${player.playingStatus}</td></tr>`;
    }

    emailBody += '</table>';
    emailBody += `<p><br>Total responses: ${yesPlayers.length + otherPlayers.length}</p>`;
    emailBody += `<p>Players planning to attend: ${yesPlayers.length}</p>`;
    emailBody += '</body></html>';
    

    GmailApp.sendEmail(
      RECIPIENT_EMAIL,
      `Table Tennis Sign-ups for ${sheetName}`,
      '',
      { htmlBody: emailBody, name: 'CCTTC Ratings System' }
    );

    Logger.log(`Email sent successfully to ${RECIPIENT_EMAIL} for ${sheetName}`);

  } catch (error) {
    sendErrorEmail(`Error in sendSaturdayEmail: ${error.toString()}\n\nStack trace: ${error.stack}`);
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

function sendErrorEmail(errorMessage) {
  try {
    GmailApp.sendEmail(
      RECIPIENT_EMAIL,
      'ERROR: Saturday Table Tennis Email',
      errorMessage,
      { name: 'CCTTC Ratings System - ERROR' }
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

function getNextSaturday(date) {
  var skipDays = 6 - date.getDay();
  skipDays = skipDays < 1 ? 7 : skipDays;
  var nextSat = new Date(date.getTime());
  nextSat.setDate(date.getDate() + skipDays);
  return nextSat;
}

function createDisplayTab() {
  try {
    var ss = SpreadsheetApp.openById(RESPONSE_SPREADSHEET_ID);
    var template = ss.getSheetByName('New Template');
    if (!template) {
      throw new Error('New Template tab not found in sign-up spreadsheet');
    }

    var displayName = formatDateForSheet(getNextSaturday(new Date()));
    if (ss.getSheetByName(displayName)) {
      Logger.log('Display tab "' + displayName + '" already exists - skipping.');
      return;
    }

    var copy = template.copyTo(ss);
    copy.setName(displayName).showSheet();
    ss.setActiveSheet(copy);
    ss.moveActiveSheet(0);
    Logger.log('Created display tab "' + displayName + '" from New Template.');
  } catch (error) {
    sendErrorEmail('Error in createDisplayTab: ' + error.toString() + '\n\nStack trace: ' + error.stack);
  }
}

function populateDisplayTab() {
  try {
    var ss = SpreadsheetApp.openById(RESPONSE_SPREADSHEET_ID);
    var displayName = formatDateForSheet(getNextSaturday(new Date()));
    var rawSheet = ss.getSheetByName('Raw ' + displayName);
    var display = ss.getSheetByName(displayName);

    if (!rawSheet) {
      throw new Error('Raw tab "Raw ' + displayName + '" not found.');
    }
    if (!display) {
      throw new Error('Display tab "' + displayName + '" not found - run createDisplayTab() first.');
    }

    var rawLastRow = rawSheet.getLastRow();
    if (rawLastRow < 2) {
      Logger.log('No responses in "Raw ' + displayName + '" yet.');
      return 0;
    }
    var rawLastCol = rawSheet.getLastColumn();
    var headers = rawSheet.getRange(1, 1, 1, rawLastCol).getValues()[0];
    var tsIdx = -1, emailIdx = -1, nameIdx = -1, playingIdx = -1;
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || '').toLowerCase();
      if (h.indexOf('timestamp') !== -1) { tsIdx = c; }
      else if (h.indexOf('email') !== -1) { emailIdx = c; }
      else if (h.indexOf('name') !== -1) { nameIdx = c; }
      else if (h.indexOf('playing') !== -1) { playingIdx = c; }
    }
    if (tsIdx === -1 || emailIdx === -1 || nameIdx === -1 || playingIdx === -1) {
      tsIdx = 0; emailIdx = 1; nameIdx = 2; playingIdx = 3;
    }

    var dataRows = rawSheet.getRange(2, 1, rawLastRow - 1, rawLastCol).getValues();
    var players = [];
    for (var r = 0; r < dataRows.length; r++) {
      var row = dataRows[r];
      var ts = row[tsIdx];
      var email = String(row[emailIdx] || '').trim();
      var name = String(row[nameIdx] || '').trim();
      var playing = String(row[playingIdx] || '').trim();
      var combined = (email + ' ' + name + ' ' + playing).toLowerCase();
      if (combined.indexOf('player limit') !== -1 || combined.indexOf('total player') !== -1) {
        continue;
      }
      if (!email && !name && !playing) { continue; }
      players.push([ts, '  ' + email, '  ' + name, playing]);
    }
    if (players.length === 0) {
      Logger.log('No valid responses to populate.');
      return 0;
    }

    var footerRow = findFooterRow(display, 6);
    if (!footerRow) {
      throw new Error('Footer row not found on display tab "' + displayName + '".');
    }

    if (footerRow > 6) {
      display.deleteRows(6, footerRow - 6);
    }
    display.insertRows(6, players.length);

    display.getRange(6, 5, players.length, 4).setValues(players);
    Logger.log('Populated "' + displayName + '" with ' + players.length + ' players.');
    return players.length;
  } catch (error) {
    sendErrorEmail('Error in populateDisplayTab: ' + error.toString() + '\n\nStack trace: ' + error.stack);
    return 0;
  }
}

function findFooterRow(sheet, fromRow) {
  var lastRow = sheet.getLastRow();
  for (var r = fromRow; r <= lastRow; r++) {
    var vals = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var c = 0; c < vals.length; c++) {
      var v = String(vals[c] || '').toLowerCase();
      if (v.indexOf('player limit') !== -1 || v.indexOf('total player') !== -1) {
        return r;
      }
    }
  }
  return null;
}

function setupWeeklyDisplay() {
  refreshDisplayTab();
}

function testSaturdayEmail() {
  sendSaturdayEmail();
}

function onFormSubmit(e) {
  refreshDisplayTab();
}

function refreshDisplayTab() {
  createDisplayTab();
  var playerCount = populateDisplayTab();
  var ss = SpreadsheetApp.openById(RESPONSE_SPREADSHEET_ID);
  var displayName = formatDateForSheet(getNextSaturday(new Date()));
  var display = ss.getSheetByName(displayName);
  if (display && playerCount > 0) {
    formatDisplayRows(display, playerCount);
  }
}

function formatDisplayRows(display, playerCount) {
  try {
    if (!playerCount || playerCount < 1) return;
    var lastRow = 5 + playerCount;
  var black = '#000000';
  var thin = SpreadsheetApp.BorderStyle.SOLID_THIN;
  var medium = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  var thick = SpreadsheetApp.BorderStyle.SOLID_THICK;
  for (var r = 6; r <= lastRow; r++) {
    var alt = ((r - 6) % 2 === 0) ? '#ffffff' : '#d9d9d9';
    display.getRange(r, 1, 1, 11).setFontFamily('Roboto').setFontSize(11).setFontWeight('bold').setFontColor(black);
    for (var c = 1; c <= 11; c++) {
      var cell = display.getRange(r, c);
      switch (c) {
        case 1:
          cell.setBackground('#d9ead3');
          break;
        case 2:
          cell.setBackground('#dad3bc');
          cell.setBorder(null, true, null, null, false, false, black, medium);
          cell.setBorder(null, null, null, true, false, false, black, thick);
          break;
        case 3:
          cell.setBackground('#b3ab8d');
          cell.setBorder(null, null, null, true, false, false, black, thick);
          break;
        case 4:
          cell.setBackground(alt);
          cell.setBorder(true, null, null, null, false, false, black, thin);
          cell.setValue((r - 5) + ".");
          cell.setHorizontalAlignment('center').setVerticalAlignment('middle');
          break;
        case 5:
          cell.setBackground(alt);
          cell.setBorder(null, true, null, true, false, false, black, thin);
          cell.setBorder(true, null, null, null, false, false, black, thin);
          cell.setNumberFormat('M/d/yyyy HH:mm:ss');
          cell.setHorizontalAlignment('center').setVerticalAlignment('middle');
          break;
        case 6:
          cell.setBackground(alt);
          cell.setBorder(true, null, null, null, false, false, black, thin);
          cell.setHorizontalAlignment('left').setVerticalAlignment('middle');
          break;
        case 7:
          cell.setBackground(alt);
          cell.setBorder(null, true, null, true, false, false, black, thin);
          cell.setBorder(true, null, null, null, false, false, black, thin);
          cell.setHorizontalAlignment('left').setVerticalAlignment('middle');
          break;
        case 8:
          cell.setBackground(alt);
          cell.setBorder(true, null, null, null, false, false, black, thin);
          cell.setHorizontalAlignment('center').setVerticalAlignment('middle');
          break;
        case 9:
          cell.setBackground('#dad3bc');
          cell.setBorder(null, true, null, true, false, false, black, thick);
          break;
        case 10:
          cell.setBackground('#b3ab8d');
          cell.setBorder(null, true, null, null, false, false, black, thick);
          cell.setBorder(null, null, null, true, false, false, black, medium);
          break;
        case 11:
          cell.setBackground('#d9ead3');
          break;
      }
    }
    display.setRowHeight(r, 30);
  }
  display.getRange(5, 4, 1, 5).setBorder(null, null, true, null, false, false, black, thick);
  } catch (error) {
    sendErrorEmail('Error in formatDisplayRows: ' + error.toString() + '\n\nStack trace: ' + error.stack);
  }
}