# tt-ratings

## Project Overview

`tt-ratings` is a Python script designed to calculate and manage ELO ratings for table tennis players. It integrates with Google Sheets to retrieve league match results and a MongoDB database to store and maintain player historical ratings and information. The script provides functionalities to process new league matches, update player ratings in both the database and Google Sheet, and display player rating histories.

## Technical Information

The project is structured into several classes, each handling a specific aspect of the rating management system, along with several main functions that orchestrate the workflow.

### Key Components

#### 1. `ELO` Class
This class encapsulates the core ELO rating calculation logic.
-   **`__init__(self)`**: Initializes constants for match and game ELO `K` factors.
-   **`update_rating(self, player1_rating, player2_rating, score_differentials)`**: Calculates and returns the updated ELO rating for `player1` based on match outcomes against `player2`. This method considers the score differentials of individual games within a match.
-   **`expected_result(self, player1_rating, player2_rating)`**: Computes the probability of `player1` winning against `player2` based on their current ratings.
-   **`rating_change(self, rating_diff, game_score_diff)`**: Determines the precise rating adjustment by considering the rating difference between players, the game score differential, and whether the outcome was expected or unexpected. It uses predefined dictionaries for various rating differentials to fine-tune the change.

#### 2. `Player` Class
Represents an individual table tennis player within the system.
-   **`__init__(self, name, rating=None)`**: Initializes a player with a `name` and an optional `rating` (defaults to 1000 if not provided).
-   **`add_match_against(self, player: 'Player', score_differentials: list, print_out)`**: Updates the current player's rating by calling the `ELO.update_rating` method. It can also print a detailed summary of the rating change.

#### 3. `MongoDB` Class
Manages all interactions with the MongoDB database.
-   **`CONNECTION_URI`**: Stores the connection string for the MongoDB Atlas cluster.
-   **`__init__(self, date_str, cert_file='mongodb_cert.pem')`**: Connects to the MongoDB database using the provided certificate file for TLS. It accesses the `ccttc_ratings` database and the `players` collection.
-   **`backup(self)`**: Creates a local JSON backup of the `players` collection, useful for data recovery or migration.
-   **`get_all_players(self)`**: Fetches all player documents from the `players` collection, sorted by `current_rating` in descending order.
-   **`get_current_ratings(self)`**: Retrieves the most recent rating and `last_played` date for all players.
-   **`get_player_history(self, player_name: str)`**: Returns the entire historical ratings list for a specified player.
-   **`get_ratings_history(self, player_list: list)`**: Retrieves historical ratings for a given list of players or all players if "all" is specified.
-   **`get_last_update_date(self)`**: Determines the latest `last_played` date among all players in the database.
-   **`set_new_ratings(self, new_ratings: dict, new_emails: dict=None)`**: Inserts new players into the database or updates existing players' `leagues_played`, `last_played` date, `current_rating`, and `historical_ratings`.
-   **`update_ratings_from_sheet(self, new_ratings: dict, new_emails: dict=None)`**: Updates the ratings of existing players in the database based on data from Google Sheets, appending new ratings to their `historical_ratings`.
-   **`remove_league(self)`**: (Currently a placeholder) Intended to remove league matches of a specified date.

#### 4. `GoogleSheet` Class
Handles all communication and data manipulation with Google Sheets.
-   **`SCOPES`**: Defines the necessary Google API scopes for spreadsheet access.
-   **`SPREADSHEET_ID`**: The unique identifier for the Google Spreadsheet used for data.
-   **`RATINGS_HEADERS_RANGE`, `RATINGS_RANGE`, `PLAYERS_RANGE`**: Specifies the cell ranges within the Google Sheet for different data types.
-   **`__init__(self, date_str, cred_file="google_cred.json")`**: Initializes Google API credentials, handling `token.json` for persistent authorization and `google_cred.json` for initial setup. Sets up dynamic ranges based on the `date_str`.
-   **`get_sheet(self)`**: Authenticates and builds the Google Sheets service object.
-   **`get_scores(self)`**: Retrieves raw match scores from the configured spreadsheet ranges.
-   **`get_all_ratings(self)`**: Fetches all current player ratings and their last played dates from the Google Sheet.
-   **`get_league_players(self)`**: Extracts player names organized by league from the spreadsheet.
-   **`set_new_ratings(self, new_ratings: dict, rating_increased: dict, rating_decreased: dict, active_days)`**: Updates the Google Sheet with new player ratings, including their ranking, rating changes (increase/decrease), and active status based on `active_days`.
-   **`print_active_status(self, new_ratings: dict, rating_increased: dict, rating_decreased: dict, active_days)`**: Prints the calculated active status and rating differences without committing changes to the Google Sheet.

### Main Functions

-   **`calculate_new_ratings(current_ratings, league_scores, date_str, print_out)`**:
    Processes a list of league scores to compute updated ELO ratings for all involved players. It utilizes the `Player` and `ELO` classes for individual match calculations and aggregates the changes.
-   **`get_rating_diffs(current_ratings, new_ratings)`**:
    Compares the current and newly calculated ratings to identify and categorize players whose ratings have increased or decreased.
-   **`new_league(date_str, cert_file, google_cred, active_days, execute, print_out)`**:
    This is the primary function for processing new league matches. It connects to both Google Sheets and MongoDB, retrieves data, handles new players (prompting for initial ratings and emails), calculates new ratings, and, if `execute` is true, updates the database and Google Sheet after user confirmation. It also includes a check to prevent reprocessing the same league date.
-   **`update_database_from_sheet(date_str, cert_file, google_cred, active_days, execute, print_out)`**:
    Allows for updating the MongoDB database directly from an existing Google Sheet. It fetches all ratings from the sheet, compares them with current database ratings, and updates MongoDB if `execute` is true, after user confirmation.
-   **`show_ratings(cert_file, player_list: list, current, active_days)`**:
    Displays player ratings. It can show either the current ratings with an active status (based on `active_days`) or the full historical rating progression for specified players or all players.
-   **`main()`**:
    The entry point of the script. It parses command-line arguments to determine the desired operation (`-n` for new league, `-u` for update from sheet, `-r` for remove league, `-s` for show ratings). It performs argument validation (e.g., date format) and invokes the relevant functions.

### Dependencies

-   `pymongo`: Python driver for MongoDB.
-   `bson.json_util`: Utilities for encoding/decoding MongoDB BSON to/from extended JSON.
-   `datetime`: Standard Python library for date and time manipulation.
-   `google.auth.transport.requests`, `google.oauth2.credentials`, `google_auth_oauthlib.flow`, `googleapiclient.discovery`, `googleapiclient.errors`, `google.auth.exceptions`: Google API client libraries for authentication and interacting with Google services (Sheets in this case).
-   `numpy`: Numerical computing library, used for mathematical operations in ELO calculations.
-   `pandas`: Data manipulation and analysis library, used for series operations.
-   `argparse`: Standard library for parsing command-line arguments.
-   `copy`: Standard library for shallow and deep copy operations.
-   `os.path`: Standard library for pathname manipulation.

### Usage

To run the script, use the command line with appropriate arguments:

```bash
python tt-ratings.py [OPTIONS]
```

**Options:**
-   `-m`, `--mongodb-cert`: Path to the MongoDB certificate file (default: `mongodb_cert.pem`).
-   `-g`, `--google-cred`: Path to the Google API credentials file (default: `google_cred.json`).
-   `-a`, `--active-days`: Number of days to consider a player 'active' (default: 60).
-   `-d`, `--date`: Date of the league games in `yyyy-mm-dd` format (required for new league and update operations).
-   `-n`, `--new-league`: Process new league matches and update ratings.
-   `-s`, `--show-ratings`: Show ratings history for specified players (comma-separated names or "all").
-   `-c`, `--current`: Used with `-s` to show only current ratings.
-   `-e`, `--execute`: Required to actually update the database and Google Sheet.
-   `-p`, `--print-out`: Prints rating changes during processing.
-   `-u`, `--update`: Update the server from Google Doc ratings sheet.
-   `-r`, `--remove-league`: Remove league matches of the specified date.

### Example Usage

-   **Process a new league:**
    ```bash
    python tt-ratings.py -n -d 2024-09-27 -e -p
    ```
-   **Show current ratings for all players:**
    ```bash
    python tt-ratings.py -s all -c
    ```
-   **Show rating history for specific players:**
    ```bash
    python tt-ratings.py -s "Player A, Player B"
    ```
-   **Update database from Google Sheet:**
    ```bash
    python tt-ratings.py -u -d 2024-09-27 -e
    ```