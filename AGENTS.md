# tt-ratings — Working Rules

## Backup sync (IMPORTANT — always)
The user pastes scripts into Google Apps Script editors from the backup files,
NOT from the source files directly. Every time you modify
`Google Sheets App Scripts/Combined Player Ratings/Player Ratings.gs`, you MUST
also regenerate BOTH backup files in the same change, then tell the user you
updated them:

1. `Google Sheets App Scripts/08-07-26 CCTTC Player Ratings backup.txt` — a
   byte-for-byte copy of `Player Ratings.gs`.
2. `Google Sheets App Scripts/Combined Player Ratings/08-07-26 New Combined Player Ratings System Script.txt` —
   LF-normalized concatenation of the combined-system scripts with
   `// ==================== FILE: <name> ====================` markers, in this
   order: `JD Modified ELO Ratings Calculator.gs`, `Player Ratings.gs`,
   `Rating Engine.gs`, `USATT Ratings Alignment.gs`, `Ratings Graph Web App.gs`.

Backup filenames carry the current date (e.g. `08-07-26`); when a new version
of the system is produced, create same-named backups with the newer date.

The generator script is `C:\Users\jddav\AppData\Local\Temp\opencode\gen_backups.ps1`
(writes `combined_new.txt` to temp and copies it into place). After running it,
verify byte-identity: CCTTC backup hash must equal `Player Ratings.gs` hash,
and the combined backup file must equal the temp `combined_new.txt`. Always
report to the user ("backups updated") after regenerating them.
