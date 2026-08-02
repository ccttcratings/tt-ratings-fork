#!/usr/bin/env python3

from pymongo import MongoClient, ASCENDING, DESCENDING
import certifi
from datetime import datetime
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.auth.exceptions import RefreshError
from google_auth_httplib2 import AuthorizedHttp
from collections import Counter
import argparse
import copy
import httplib2
import os.path
import re

from mongodb_config import CONNECTION_URI

class ELO:

    def __init__(self):
        self.match_K = 5
        self.game_K = 40

    def update_rating(self, player1_rating, player2_rating, score_differentials):
        results = [0 if diff < 0 else 1 for diff in score_differentials]

        counts = Counter(results)
        game_score_diff = counts[1] - counts[0]
        rating_diff = player1_rating - player2_rating
        rating_change = self.rating_change(rating_diff, game_score_diff)
        return player1_rating + rating_change

    def expected_result(self, player1_rating, player2_rating):
        exp = (player2_rating - player1_rating) / 400.0
        return 1 / ((10.0 ** (exp)) + 1)

    def rating_change(self, rating_diff, game_score_diff):
        is_higher_rated = rating_diff >= 0
        is_winner = game_score_diff > 0
        is_tie = game_score_diff == 0
        is_expected = not (is_higher_rated ^ is_winner)
        rating_diff = abs(rating_diff)
        games_left = abs(game_score_diff) - 1

        # Handle ties (2-2 matches)
        if is_tie:
            # For ties, use the 0 index (games_left = 0) rating change
            # Higher rated player loses points, lower rated player gains
            games_left = 0
            is_winner = not is_higher_rated  # Lower rated player "wins" the tie
            is_expected = False  # A tie is never the expected result

        rating_range_list = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195,
                             210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 360, 375,
                             390, 405, 420, 435, 450, 465, 480]

        rating_change_expected_dict = {0: [4, 6, 8],
                                       1: [3.25, 5.5, 7.75],
                                       2: [2.5, 5, 7.5],
                                       3: [1.75, 4.5, 7.25],
                                       4: [1, 4, 7],
                                       5: [0.25, 3.5, 6.75],
                                       6: [-0.5, 3, 6.5],
                                       7: [-1.25, 2.5, 6.25],
                                       8: [-2, 2, 6],
                                       9: [-2.75, 1.5, 5.75],
                                       10: [-3.5, 1, 5.5],
                                       11: [-4.25, 0.5, 5.25],
                                       12: [-5, 0, 5],
                                       13: [-5.75, -0.5, 4.75],
                                       14: [-6.5, -1, 4.5],
                                       15: [-7.25, -1.5, 4.25],
                                       16: [-8, -2, 4],
                                       17: [-8.75, -2.5, 3.75],
                                       18: [-9.5, -3, 3.5],
                                       19: [-10.25, -3.5, 3.25],
                                       20: [-11, -4, 3],
                                       21: [-11.75, -4.5, 2.75],
                                       22: [-12.5, -5, 2.5],
                                       23: [-13.25, -5.5, 2.25],
                                       24: [-14, -6, 2],
                                       25: [-14.75, -6.5, 1.75],
                                       26: [-15.5, -7, 1.5],
                                       27: [-16.25, -7.5, 1.25],
                                       28: [-17, -8, 1],
                                       29: [-17.75, -8.5, 0.75],
                                       30: [-18.5, -9, 0.5],
                                       31: [-19.25, -9.5, 0.25],
                                       32: [-20, -10, 0]
                                       }

        rating_change_unexpected_dict = {0: [4, 6, 8],
                                         1: [5, 7.25, 9.5],
                                         2: [6, 8.5, 11],
                                         3: [7.25, 10, 12.75],
                                         4: [8.5, 11.5, 14.5],
                                         5: [10, 13.25, 16.5],
                                         6: [11.5, 15, 18.5],
                                         7: [13.25, 17, 20.75],
                                         8: [15, 19, 23],
                                         9: [17, 21.25, 25.5],
                                         10: [19, 23.5, 28],
                                         11: [21.25, 26, 30.75],
                                         12: [23.5, 28.5, 33.5],
                                         13: [26, 31.25, 36.5],
                                         14: [28.5, 34, 39.5],
                                         15: [31.25, 37, 42.75],
                                         16: [34, 40, 46],
                                         17: [37, 43.25, 49.5],
                                         18: [40, 46.5, 53],
                                         19: [43.25, 50, 56.75],
                                         20: [46.5, 53.5, 60.5],
                                         21: [50, 57.25, 64.5],
                                         22: [53.5, 61, 68.5],
                                         23: [57.25, 65, 72.75],
                                         24: [61, 69, 77],
                                         25: [65, 73.25, 81.5],
                                         26: [69, 77.5, 86],
                                         27: [73.25, 82, 90.75],
                                         28: [77.5, 86.5, 95.5],
                                         29: [82, 91.25, 100.5],
                                         30: [86.5, 96, 105.5],
                                         31: [91.25, 101, 110.75],
                                         32: [96, 106, 116]
                                         }

        try:
            rating_change_index = next(i for i, x in enumerate(rating_range_list) if rating_diff <= x)
        except StopIteration:
            rating_change_index = 32

        rating_change_dict = rating_change_expected_dict if is_expected else rating_change_unexpected_dict

        rating_change_list = rating_change_dict[rating_change_index]

        rating_offset = rating_change_list[games_left] if is_winner else -rating_change_list[games_left]

        return rating_offset

class Player:

    def __init__(self, name, rating=None):
        self.name = name
        self.matches_history = None

        if rating is not None:
            self.rating = rating
        else:
            self.rating = 1000

    def add_match_against(self, player: 'Player', score_differentials: list, print_out):
        e = ELO()
        new_rating = e.update_rating(self.rating, player.rating, score_differentials)
        if print_out:
            p1_info = f'{self.name} [{round(self.rating, 2): >7.02f}]'
            p2_info = f'{player.name} [{round(player.rating, 2): >7.02f}]'
            score_diffs = ''
            for i in range(len(score_differentials)):
                diff = score_differentials[i]
                if i != 0:
                    score_diffs += ', '
                score_diffs += f'{diff: >3}'
            rating_change_str = f'{p1_info: >30} : {p2_info: >30}  =>  {score_diffs: <25}  =>  {round(new_rating - self.rating, 2):+.02f}'
            print(rating_change_str)
        return new_rating

class MongoDB():
    CONNECTION_URI = CONNECTION_URI

    def __init__(self, date_str):
        client = MongoClient(
            self.CONNECTION_URI,

            tls=True,
            tlsAllowInvalidCertificates=True,
            tlsCAFile=certifi.where(),
        )

        db = client['CCTTC-Players-RatingsDB']
        self.collection = db['CCTTC-Players-Ratings']

        self.all_players = None
        self.current_ratings = {}
        self.date_str = date_str

    def get_all_players(self):
        self.all_players = self.collection.find().sort('Ratings', DESCENDING)
        return self.all_players

    def get_current_ratings(self):
        if self.all_players is None:
            self.get_all_players()

        self.all_players.rewind()
        self.current_ratings = {}

        for p in self.all_players:
            if 'rating_history' in p and len(p['rating_history']) > 0:
                last_entry = p['rating_history'][-1]

                # Case A: If it's the new dictionary format {'rating': 1500, 'date': ...}
                if isinstance(last_entry, dict):
                    self.current_ratings[p['name']] = float(last_entry.get('rating', 1000.0))

                # Case B: If it's the old list format [1500, 'date']
                elif isinstance(last_entry, list):
                    self.current_ratings[p['name']] = float(last_entry[0])

                else:
                    self.current_ratings[p['name']] = 1000.0
            else:
                self.current_ratings[p['name']] = 1000.0

        return self.current_ratings

    def get_player_history(self, player_name: str):
        player_info = self.collection.find_one({'name': player_name})
        if player_info is not None:
            return player_info.get('rating_history', [])
        else:
            return []

    def get_ratings_history(self, player_list: list):
        ratings_history = {}
        if 'all' in map(str.lower, player_list):
            if self.all_players is None:
                self.get_all_players()

            self.all_players.rewind()
            for p in self.all_players:
                ratings_history[p['name']] = p.get('rating_history', [])
        else:
            for p in player_list:
                ratings_history[p] = self.get_player_history(p)
        return ratings_history

    def get_last_update_date(self):
        if self.all_players is None:
            self.get_all_players()

        last_update = datetime.strptime('01-01-2025', '%m-%d-%Y').replace(hour=14)
        self.all_players.rewind()
        for p in self.all_players:
            player_date = p.get('Ratings', last_update)
            last_update = player_date if player_date > last_update else last_update
        return last_update

    def set_new_ratings(self, new_ratings: dict, new_emails: dict = None):
        for k, v in new_ratings.items():
            player = self.collection.find_one({'name': k})
            r = float(v[0])
            d = v[1]

            email_val = new_emails.get(k,
                                       f"unknown_{k.lower().replace(' ', '_')}@ccttc.com") if new_emails else f"unknown_{k.lower().replace(' ', '_')}@ccttc.com"

            if player is None:
                new_player = {
                    'name': k,
                    'emails': [email_val],
                    'leagues_played': 1,
                    'Ratings': d,
                    'rating_history': [
                        {
                            'date': d,
                            'rating': r
                        }
                    ]
                }
                self.collection.insert_one(new_player)
            else:
                last_played_date = player.get('Ratings', datetime.min)
                if last_played_date < d:
                    # Target history tracking list
                    history_list = player.get('rating_history', [])
                    history_list.append({
                        'date': d,
                        'rating': r
                    })

                    self.collection.update_one(
                        {'name': k},
                        {
                            '$inc': {'leagues_played': 1},
                            '$set': {
                                'Ratings': d,
                                'rating_history': history_list
                            }
                        }
                    )

    def update_ratings_from_sheet(self, new_ratings: dict, new_emails: dict = None, name_mapping: dict = None):
        if new_emails is None:
            new_emails = {}
        if name_mapping is None:
            name_mapping = {}

        ratings_updated_count = 0
        names_updated_count = 0

        # Get all database players sorted by current rating to match with sheet order
        all_db_players = list(self.collection.aggregate([
            {'$addFields': {
                'last_rating': {'$last': '$rating_history.rating'}
            }},
            {'$sort': {'last_rating': DESCENDING}}
        ]))

        # Create a list of sheet players in order (already sorted by rating)
        sheet_players_in_order = list(new_ratings.items())

        for sheet_idx, (sheet_name, v) in enumerate(sheet_players_in_order):
            r = float(v[0])
            d = v[1]

            # First try to find by exact name match
            player = self.collection.find_one({'name': sheet_name})

            # If no exact match, try the old name from name_mapping (renamed players)
            if player is None and sheet_name in name_mapping:
                player = self.collection.find_one({'name': name_mapping[sheet_name]})
                if player is not None:
                    print(f'Name change detected (from mapping): "{name_mapping[sheet_name]}" -> "{sheet_name}"')

            # If still no match, try by position/index (matching by rank)
            if player is None and sheet_idx < len(all_db_players):
                # Try matching by position - the Nth player in sheet corresponds to Nth in DB
                potential_match = all_db_players[sheet_idx]

                # Extract actual current rating from rating_history
                hist = potential_match.get('rating_history', [])
                if hist:
                    last = hist[-1]
                    match_rating = float(last['rating']) if isinstance(last, dict) else float(last[0])
                else:
                    match_rating = 1000.0
                if abs(match_rating - r) < 50:
                    # Verify this is a rename by checking email overlap
                    sheet_emails = new_emails.get(sheet_name, [])
                    if isinstance(sheet_emails, list):
                        sheet_emails = [e for e in sheet_emails if e]
                    else:
                        sheet_emails = [sheet_emails] if sheet_emails else []
                    db_emails = potential_match.get('emails', [])
                    email_overlap = any(e in db_emails for e in sheet_emails)
                    if email_overlap or not sheet_emails:
                        player = potential_match
                        old_name = player['name']
                        print(f'Name change detected: "{old_name}" -> "{sheet_name}"')
                    else:
                        print(f'Skipped position match "{potential_match["name"]}" -> "{sheet_name}" (no email overlap)')

            if player is None:
                # New player
                email_cb = new_emails.get(sheet_name, ['', ''])
                if isinstance(email_cb, list):
                    email_cb = email_cb[0] if email_cb[0] else ''
                new_player = {
                    'name': sheet_name,
                    'emails': [email_cb] if email_cb else [],
                    'leagues_played': 1,
                    'Ratings': d,
                    'rating_history': [
                        {
                            'date': d,
                            'rating': r
                        }
                    ]
                }
                self.collection.insert_one(new_player)
                print(f'Added new player: {sheet_name}')
            else:
                # Existing player - update rating, name, and optionally email
                old_hist = player.get('rating_history', [])
                if old_hist:
                    last_old = old_hist[-1]
                    old_rating = float(last_old['rating']) if isinstance(last_old, dict) else float(last_old[0])
                else:
                    old_rating = 1000.0
                old_name = player['name']
                rating_diff = r - old_rating

                update_dict = {}

                # Only append history entry if the rating actually changed
                if abs(rating_diff) > 0.01:
                    history_entry = {'date': d, 'rating': r}
                    history_list = player.get('rating_history', [])
                    history_list.append(history_entry)
                    update_dict['Ratings'] = d
                    update_dict['rating_history'] = history_list
                    print(f'Updated rating for {sheet_name}: {old_rating:.2f} -> {r:.2f} ({rating_diff:+.2f})')
                    ratings_updated_count += 1

                # Update name if it has changed
                if old_name != sheet_name:
                    update_dict['name'] = sheet_name
                    print(f'Updated name: "{old_name}" -> "{sheet_name}"')
                    names_updated_count += 1

                # Update emails if provided in new_emails
                if sheet_name in new_emails:
                    email_data = new_emails[sheet_name]
                    if isinstance(email_data, list):
                        email_cb = email_data[0] if email_data[0] else ''
                        email_cd = email_data[1] if len(email_data) > 1 and email_data[1] else ''
                    else:
                        email_cb = email_data
                        email_cd = ''
                    new_emails_list = []
                    if email_cb:
                        new_emails_list.append(email_cb)
                    if email_cd:
                        new_emails_list.append(email_cd)
                    if new_emails_list:
                        update_dict['emails'] = new_emails_list
                        print(f'Updated emails for {sheet_name}: {new_emails_list}')

                if update_dict:
                    self.collection.update_one(
                        {'_id': player['_id']},
                        {'$set': update_dict}
                    )

        if ratings_updated_count > 0:
            print(f'\nUpdated ratings for {ratings_updated_count} players')
        if names_updated_count > 0:
            print(f'Updated names for {names_updated_count} players')

    def update_emails_only(self, player_emails: dict):
        """Update emails for players without changing their ratings"""
        if not player_emails:
            return

        updated_count = 0
        for player_name, email_data in player_emails.items():
            player = self.collection.find_one({'name': player_name})
            if player is not None:
                if isinstance(email_data, list):
                    email_cb = email_data[0] if email_data[0] else ''
                    email_cd = email_data[1] if len(email_data) > 1 and email_data[1] else ''
                else:
                    email_cb = email_data
                    email_cd = ''
                new_emails_list = []
                if email_cb:
                    new_emails_list.append(email_cb)
                if email_cd:
                    new_emails_list.append(email_cd)
                current_emails = player.get('emails', [])
                if current_emails != new_emails_list:
                    self.collection.update_one(
                        {'name': player_name},
                        {'$set': {'emails': new_emails_list}}
                    )
                    print(f'Updated emails for {player_name}: {new_emails_list}')
                    updated_count += 1
            else:
                print(f'Player "{player_name}" not found in database, skipping email update')

        if updated_count > 0:
            print(f'\nUpdated emails for {updated_count} players')

    
class GoogleSheet():
    # If modifying these scopes, delete the file token.json.
    SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

    # The ID and range of a sample spreadsheet.
    SPREADSHEET_ID = '1IYGaCxJjT8H2oTvIdm423oCuSsRGHjWGnTW7dD_7kxg'

    RATINGS_HEADERS_RANGE = 'Ratings!C1:C1'
    RATINGS_RANGE = 'Ratings!A2:D'
    PLAYERS_RANGE = 'Ratings!B2:D'

    def __init__(self, date_str, cred_file="google_cred.json"):
        self.date_str = date_str
        self.ratings_range = [f'{date_str}!D3:F8', f'{date_str}!D20:F25', f'{date_str}!D37:F42']
        self.score_ranges = [f'{date_str}!I3:U17', f'{date_str}!I20:U34', f'{date_str}!I37:U51']
        self.player_ranges = [f'{date_str}!C3:C8', f'{date_str}!C20:C25', f'{date_str}!C37:C42']
        self.point_winner_ranges = [f'{date_str}!D12', f'{date_str}!D29', f'{date_str}!D46']
        self.creds = None
        self.sheet = None
        self.scores = []
        self.all_players = []
        self.players_per_league = {}

        # The file token.json stores the user's access and refresh tokens, and is
        # created automatically when the authorization flow completes for the first
        # time.
        if os.path.exists('token.json'):
            self.creds = Credentials.from_authorized_user_file('token.json', self.SCOPES)

        # If there are no (valid) credentials available, let the user log in.
        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                try:
                    self.creds.refresh(Request())
                except RefreshError:
                    flow = InstalledAppFlow.from_client_secrets_file(cred_file, self.SCOPES)
                    self.creds = flow.run_local_server(port=0)
            else:
                flow = InstalledAppFlow.from_client_secrets_file(cred_file, self.SCOPES)
                self.creds = flow.run_local_server(port=0)
            # Save the credentials for the next run
            with open('token.json', 'w') as token:
                token.write(self.creds.to_json())

    def get_sheet(self):
        try:
            # Longer timeout (300s) to handle slow internet connections
            http = AuthorizedHttp(self.creds, http=httplib2.Http(timeout=300))
            service = build('sheets', 'v4', http=http)
            self.sheet = service.spreadsheets()
        except HttpError as err:
            print(f'Failed to get spreadsheet, error: {err}')
            exit(1)
        return self.sheet

    def get_scores(self):
        if self.sheet is None:
            self.get_sheet()

        try:
            for r in self.score_ranges:
                result = self.sheet.values().get(spreadsheetId=self.SPREADSHEET_ID, range=r).execute()
                scores = result.get('values', [])
                for row in scores:
                    if len(row) >= 2:
                        row[:2] = [s.strip() if s else '' for s in row[:2]]
                        for i in range(2, len(row)):
                            try:
                                row[i] = int(row[i])
                            except (ValueError, TypeError):
                                pass
                self.scores.extend(scores)
        except HttpError as err:
            print(f'Failed to get league scores, error: {err}')
            exit(1)
        return self.scores

    def get_all_ratings(self, allow_missing_dates=False):
        if self.sheet is None:
            self.get_sheet()

        try:
            values = self.sheet.values().get(spreadsheetId=self.SPREADSHEET_ID, range=self.PLAYERS_RANGE).execute()
            ratings = values.get('values', [])

            player_ratings = {}
            skipped_count = 0
            for player in ratings:
                # Check if we have at least name and rating
                if len(player) < 2 or not player[0] or not player[1]:
                    skipped_count += 1
                    continue

                player_name = player[0].strip()

                # Try to parse rating
                try:
                    rating = float(player[1])
                except (ValueError, TypeError):
                    print(f'Warning: Skipping invalid rating for player: {player_name}')
                    skipped_count += 1
                    continue

                # Handle date - use from sheet if available, otherwise placeholder
                if len(player) >= 3 and player[2]:
                    date = player[2]
                elif allow_missing_dates:
                    # Placeholder - will be replaced with existing date from database
                    date = None
                else:
                    skipped_count += 1
                    continue

                player_ratings[player_name] = [rating, date]

            if skipped_count > 0:
                print(f'Skipped {skipped_count} rows with incomplete data')

            return player_ratings
        except HttpError as err:
            print(f'Failed to get current ratings, error: {err}')
            exit(1)

    def get_league_players(self):
        if self.sheet is None:
            self.get_sheet()

        try:
            for i in range(len(self.player_ranges)):
                r = self.player_ranges[i]
                league = i + 1
                self.players_per_league[league] = []
                result = self.sheet.values().get(spreadsheetId=self.SPREADSHEET_ID, range=r).execute()
                values = result.get('values', [])
                for v in values:
                    self.players_per_league[league].extend(v)
                self.players_per_league[league] = list(map(str.strip, self.players_per_league[league]))
                self.all_players.extend(self.players_per_league[league])
        except HttpError as err:
            print(f'Failed to get league players, error: {err}')
            exit(1)
        return self.all_players

    def get_player_emails_from_sheet(self):
        """Get all player emails from columns CB and CD of the Ratings sheet"""
        if self.sheet is None:
            self.get_sheet()

        try:
            # Read player names (column B) and emails (columns CB, CD) together
            result = self.sheet.values().get(
                spreadsheetId=self.SPREADSHEET_ID,
                range='Ratings!B2:CD'
            ).execute()

            values = result.get('values', [])
            player_emails = {}

            for row in values:
                if row and row[0]:  # If there's a player name in column B
                    player_name = row[0].strip()
                    # Column B = index 0
                    # CB is 78 columns after B (index 78)
                    # CD is 80 columns after B (index 80)
                    email_cb = row[78].strip() if len(row) > 78 and row[78] else ''
                    email_cd = row[80].strip() if len(row) > 80 and row[80] else ''
                    if email_cb or email_cd:
                        player_emails[player_name] = [email_cb, email_cd]

            print(f'Retrieved {len(player_emails)} player emails from Ratings sheet')
            return player_emails
        except HttpError as err:
            print(f'Failed to get player emails: {err}')
            return {}

    def update_player_emails_in_sheet(self, player_emails, all_player_names, new_emails=None):
        """Update player emails in columns CB and CD for all ranked players"""
        if self.sheet is None:
            self.get_sheet()

        try:
            # Clear old emails in CB and CD from row 2 onward
            max_clear_row = max(len(all_player_names) + 5, 200)
            self.sheet.values().clear(
                spreadsheetId=self.SPREADSHEET_ID,
                range=f'Ratings!CB2:CD{max_clear_row}'
            ).execute()

            # Build email data for every row in the rankings (CB and CD written separately)
            email_data = []
            row_num = 2
            for player_name in all_player_names:
                email_cb = ''
                email_cd = ''
                if player_name and player_name != '---' and player_name != 'Not in Database':
                    if player_emails and player_name in player_emails:
                        email_cb = player_emails[player_name][0] if player_emails[player_name] else ''
                        email_cd = player_emails[player_name][1] if len(player_emails[player_name]) > 1 else ''
                    if new_emails and player_name in new_emails:
                        email_cb = new_emails[player_name]
                email_data.append({'range': f'Ratings!CB{row_num}', 'values': [[email_cb]]})
                email_data.append({'range': f'Ratings!CD{row_num}', 'values': [[email_cd]]})
                row_num += 1

            # Batch write all email rows
            if email_data:
                body = {
                    'valueInputOption': 'RAW',
                    'data': email_data
                }
                self.sheet.values().batchUpdate(
                    spreadsheetId=self.SPREADSHEET_ID,
                    body=body
                ).execute()
                print(f'Updated {len(email_data)} player email rows in columns CB and CD')

        except HttpError as err:
            print(f'Failed to update player emails: {err}')

    def set_new_ratings(self, new_ratings: dict, rating_increased: dict, rating_decreased: dict, active_days,
                        match_rating_changes: dict = None, new_emails: dict = None):
        try:
            # Get existing player emails before updating rankings
            print('Retrieving player emails from Ratings sheet...')
            player_emails = self.get_player_emails_from_sheet()

            all_player_ratings = []
            league_player_ratings = {}
            ranking = 0
            for k, v in new_ratings.items():
                if k in self.all_players:
                    try:
                        rating_diff_num = rating_increased[k]
                        rating_diff = f'+{rating_diff_num:.2f}'
                    except KeyError:
                        try:
                            rating_diff_num = rating_decreased[k]
                            rating_diff = f'{rating_diff_num:.2f}'
                        except KeyError:
                            rating_diff_num = 0
                            rating_diff = '0.00'
                    # Pad rating_diff with '.' characters colored to match the E-column background
                    # (#c9daf8) so they are invisible but occupy real width on every platform
                    # (trailing spaces get trimmed on Android). Leading apostrophe forces text;
                    # USER_ENTERED strips the apostrophe from the stored value.
                    pad_len = max(7 - len(rating_diff), 0)
                    padded_diff = "'" + rating_diff + '.' * pad_len
                    before_rating = v[0] - rating_diff_num
                    league_player_ratings[k] = [f'{before_rating:.2f}', padded_diff, f'{v[0]:.2f}']

                ranking += 1
                active_player = True
                if (datetime.strptime(self.date_str, '%m-%d-%Y').replace(hour=14) - v[1]).days > active_days:
                    active_player = False
                all_player_ratings.append([ranking, k, v[0], ''])
                print(f'{k}     active:{active_player}')

            # Update player ratings in league sheets
            for l in self.players_per_league:
                values = []
                for p in self.players_per_league[l]:
                    if p == '':
                        values.append(['', '', ''])
                    elif p in league_player_ratings:
                        values.append(league_player_ratings[p])
                    else:
                        values.append(['', '', ''])

                # Write via updateCells: stringValue stores clean text (no literal apostrophe),
                # and textFormatRuns colors the trailing '.' padding blue (#c9daf8, the E-column
                # background) so it is invisible but keeps real width on all platforms.
                sheet_name = self.ratings_range[l - 1].split('!')[0]
                range_parts = self.ratings_range[l - 1].split('!')[1].split(':')
                start_row = int(re.search(r'\d+', range_parts[0]).group())
                end_row = int(re.search(r'\d+', range_parts[1]).group())
                start_col = ord(range_parts[0][0]) - ord('A')  # D=3
                end_col = ord(range_parts[1][0]) - ord('A') + 1  # F=5

                spreadsheet = self.sheet.get(spreadsheetId=self.SPREADSHEET_ID).execute()
                sheet_id = None
                for sheet in spreadsheet.get('sheets', []):
                    if sheet['properties']['title'] == sheet_name:
                        sheet_id = sheet['properties']['sheetId']
                        break

                blue = {'red': 0.7882353, 'green': 0.85490197, 'blue': 0.972549}
                rows_data = []
                for row in values:
                    if not row[1]:
                        rows_data.append({'values': [
                            {'userEnteredValue': {'stringValue': row[0]}},
                            {'userEnteredValue': {'stringValue': ''}, 'userEnteredFormat': {'numberFormat': {'type': 'TEXT', 'pattern': '@'}}},
                            {'userEnteredValue': {'stringValue': row[2]}},
                        ]})
                        continue
                    text_val = row[1][1:]  # drop leading apostrophe
                    num_len = len(text_val.rstrip('.'))
                    runs = [{'startIndex': 0, 'format': {'foregroundColor': {'red': 0, 'green': 0, 'blue': 0}}}]
                    if len(text_val) > num_len:
                        runs.append({'startIndex': num_len, 'format': {'foregroundColor': blue}})
                    rows_data.append({'values': [
                        {'userEnteredValue': {'stringValue': row[0]}},
                        {'userEnteredValue': {'stringValue': text_val}, 'textFormatRuns': runs,
                         'userEnteredFormat': {'numberFormat': {'type': 'TEXT', 'pattern': '@'}}},
                        {'userEnteredValue': {'stringValue': row[2]}},
                    ]})

                ucreq = {'requests': [{'updateCells': {
                    'range': {'sheetId': sheet_id, 'startRowIndex': start_row - 1, 'endRowIndex': end_row,
                              'startColumnIndex': start_col, 'endColumnIndex': end_col},
                    'rows': rows_data, 'fields': 'userEnteredValue,textFormatRuns,userEnteredFormat.numberFormat'}}]}
                self.sheet.batchUpdate(spreadsheetId=self.SPREADSHEET_ID, body=ucreq).execute()

            # Write match ELO changes to the sheet (column I for P1 change)
            if match_rating_changes:
                for l in self.players_per_league:
                    # Get the scores for this league to build the update values
                    league_scores = []
                    try:
                        result = self.sheet.values().get(spreadsheetId=self.SPREADSHEET_ID,
                                                         range=self.score_ranges[l - 1]).execute()
                        league_scores = result.get('values', [])
                    except HttpError:
                        pass

                    # Build a list with the full row data including the ELO change in column I (index 1)
                    updated_rows = []
                    format_requests = []  # To store formatting requests

                    # Parse the range to get sheet ID and starting row
                    range_parts = self.score_ranges[l - 1].split('!')
                    sheet_name = range_parts[0]

                    # Get sheet ID (we'll need to get this from the spreadsheet metadata)
                    try:
                        spreadsheet = self.sheet.get(spreadsheetId=self.SPREADSHEET_ID).execute()
                        sheet_id = None
                        for sheet in spreadsheet.get('sheets', []):
                            if sheet['properties']['title'] == sheet_name:
                                sheet_id = sheet['properties']['sheetId']
                                break
                    except HttpError:
                        sheet_id = None

                    # Extract starting row from range (e.g., "H2:S16" -> row 2)
                    range_coords = range_parts[1].split(':')[0]
                    start_row = int(re.search(r'\d+', range_coords).group()) - 1  # 0-indexed

                    for row_idx, row in enumerate(league_scores):
                        if len(row) >= 3:
                            p1_name = row[0].strip() if row[0] else ''
                            # Player 2 is in column 2 (index 2), not column 1
                            p2_name = row[2].strip() if row[2] else ''

                            new_row = row.copy()
                            # Ensure the row has at least 2 elements
                            while len(new_row) < 2:
                                new_row.append('')

                            if p1_name and p2_name:
                                # Only treat as a completed match if this row actually has game
                                # scores; otherwise an empty row with the same player pair would
                                # wrongly inherit the ELO change from a different match.
                                has_scores = len(row) > 4 and isinstance(row[3], (int, float)) \
                                    and isinstance(row[4], (int, float))
                                match_key = (p1_name, p2_name)
                                if has_scores and match_key in match_rating_changes:
                                    p1_change, p2_change = match_rating_changes[match_key]
                                    # Put P1's change in column I (index 1) - absolute value, 2 decimal places
                                    new_row[1] = f'{abs(p1_change):.2f}'

                                    # Determine winner and add formatting request
                                    if sheet_id is not None:
                                        if p1_change > 0:  # Player 1 wins
                                            format_requests.append({
                                                'repeatCell': {
                                                    'range': {
                                                        'sheetId': sheet_id,
                                                        'startRowIndex': start_row + row_idx,
                                                        'endRowIndex': start_row + row_idx + 1,
                                                        'startColumnIndex': 8,  # Column I (0-indexed)
                                                        'endColumnIndex': 9
                                                    },
                                                    'cell': {
                                                        'userEnteredFormat': {
                                                            'backgroundColor': {
                                                                'red': 0.773,  # C5EEC5 in RGB (197/255)
                                                                'green': 0.933,  # (238/255)
                                                                'blue': 0.773  # (197/255)
                                                            }
                                                        }
                                                    },
                                                    'fields': 'userEnteredFormat.backgroundColor'
                                                }
                                            })
                                        elif p2_change > 0:  # Player 2 wins
                                            format_requests.append({
                                                'repeatCell': {
                                                    'range': {
                                                        'sheetId': sheet_id,
                                                        'startRowIndex': start_row + row_idx,
                                                        'endRowIndex': start_row + row_idx + 1,
                                                        'startColumnIndex': 10,  # Column K (0-indexed)
                                                        'endColumnIndex': 11
                                                    },
                                                    'cell': {
                                                        'userEnteredFormat': {
                                                            'backgroundColor': {
                                                                'red': 0.773,  # C5EEC5 in RGB (197/255)
                                                                'green': 0.933,  # (238/255)
                                                                'blue': 0.773  # (197/255)
                                                            }
                                                        }
                                                    },
                                                    'fields': 'userEnteredFormat.backgroundColor'
                                                }
                                            })
                                else:
                                    new_row[1] = ''
                            else:
                                new_row[1] = ''
                            updated_rows.append(new_row)
                        else:
                            # For short rows, just pass them through
                            updated_rows.append(row if row else [''])

                    if updated_rows:
                        # Update the entire score range with the ELO changes included
                        self.sheet.values().update(spreadsheetId=self.SPREADSHEET_ID, range=self.score_ranges[l - 1],
                                                   valueInputOption='USER_ENTERED',
                                                   body={'values': updated_rows}).execute()

                        # Apply formatting if we have any requests
                        if format_requests:
                            self.sheet.batchUpdate(spreadsheetId=self.SPREADSHEET_ID,
                                                   body={'requests': format_requests}).execute()

            self.sheet.values().clear(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_HEADERS_RANGE).execute()
            self.sheet.values().update(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_HEADERS_RANGE,
                                       valueInputOption='RAW', body={'values': [[f'{self.date_str}']]}).execute()
            self.sheet.values().clear(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_RANGE).execute()
            self.sheet.values().update(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_RANGE,
                                       valueInputOption='RAW', body={'values': all_player_ratings}).execute()

            # Restore player emails to columns CB and CD with updated rankings
            print('Updating player emails in columns CB and CD with new rankings...')
            all_player_names = [p[1] for p in all_player_ratings]
            self.update_player_emails_in_sheet(player_emails, all_player_names, new_emails)

            # Write highest point winners for each league
            print('Calculating and writing highest point winners...')
            self.write_highest_point_winners(rating_increased, rating_decreased, new_ratings)

        except HttpError as err:
            print(f'Failed to update ratings, error: {err}')
            exit(1)

    def write_highest_point_winners(self, rating_increased: dict, rating_decreased: dict, new_ratings: dict):
        """Calculate and write the highest point winner for each league to D12, D29, D46"""
        if self.sheet is None:
            self.get_sheet()

        try:
            for l in self.players_per_league:
                league_idx = l - 1
                league_players = self.players_per_league[l]

                # Calculate total rating change for each player in the league
                player_changes = {}
                for player in league_players:
                    if player == '':
                        continue

                    # Get the rating change (positive or negative)
                    if player in rating_increased:
                        player_changes[player] = rating_increased[player]
                    elif player in rating_decreased:
                        player_changes[player] = rating_decreased[player]
                    else:
                        player_changes[player] = 0.0

                if not player_changes:
                    continue

                # Find the maximum rating change
                max_change = max(player_changes.values())

                # Find all players with the maximum change (for ties)
                winners = [player for player, change in player_changes.items() if change == max_change]

                # If there's a tie, sort by rating (highest first)
                if len(winners) > 1:
                    winners.sort(key=lambda p: new_ratings[p][0], reverse=True)

                # Format the winner string
                winner_str = ', '.join(winners)

                # Write to the appropriate cell
                self.sheet.values().update(
                    spreadsheetId=self.SPREADSHEET_ID,
                    range=self.point_winner_ranges[league_idx],
                    valueInputOption='RAW',
                    body={'values': [[winner_str]]}
                ).execute()

                print(f'  League {l} highest point winner: {winner_str} (+{max_change:.2f})')

        except HttpError as err:
            print(f'Failed to write highest point winners: {err}')

    def print_active_status(self, new_ratings: dict, rating_increased: dict, rating_decreased: dict, active_days):
        all_player_ratings = []
        league_player_ratings = {}
        ranking = 0
        for k, v in new_ratings.items():
            if k in self.all_players:
                try:
                    rating_diff = f'+{rating_increased[k]}'
                except KeyError:
                    try:
                        rating_diff = f'{rating_decreased[k]}'
                    except KeyError:
                        rating_diff = ''
                league_player_ratings[k] = [v[0], rating_diff]

            ranking += 1
            active_player = True
            if (datetime.strptime(self.date_str, '%m-%d-%Y').replace(hour=14) - v[1]).days > active_days:
                active_player = False
            all_player_ratings.append([ranking, k, v[0], active_player])
            print(f'{k}     active:{active_player}')

def calculate_new_ratings(current_ratings, league_scores, date_str, print_out):
    rating_changes = {}
    match_rating_changes = {}  # Store individual match rating changes

    for row in league_scores:
        if len(row) < 3:
            continue
        p1_name = row[0]
        p2_name = row[2] if len(row) > 2 else ''
        if p1_name == '' or p2_name == '':
            continue

        p1_raw = current_ratings.get(p1_name, 1000.0)
        p2_raw = current_ratings.get(p2_name, 1000.0)

        if isinstance(p1_raw, list):
            p1_rating = float(p1_raw[0])
        elif isinstance(p1_raw, dict):
            p1_rating = float(p1_raw.get('rating', 1000.0))
        else:
            p1_rating = float(p1_raw)

        if isinstance(p2_raw, list):
            p2_rating = float(p2_raw[0])
        elif isinstance(p2_raw, dict):
            p2_rating = float(p2_raw.get('rating', 1000.0))
        else:
            p2_rating = float(p2_raw)

        p1 = Player(p1_name, p1_rating)
        p2 = Player(p2_name, p2_rating)

        score_diffs_p1vp2 = []
        score_diffs_p2vp1 = []

        for game in range(5):
            idx = game * 2 + 3
            try:
                if idx + 1 >= len(row):
                    break
                score1 = row[idx]
                score2 = row[idx + 1]

                if isinstance(score1, int) and isinstance(score2, int):
                    score_diffs_p1vp2.append(score1 - score2)
                    score_diffs_p2vp1.append(score2 - score1)
            except (IndexError, TypeError, ValueError):
                continue

        if len(score_diffs_p1vp2) > 0 and len(score_diffs_p2vp1) > 0:
            try:
                new_p1_rating = p1.add_match_against(p2, score_diffs_p1vp2, print_out)
                new_p2_rating = p2.add_match_against(p1, score_diffs_p2vp1, print_out)

                match_key = (p1_name, p2_name)
                match_rating_changes[match_key] = (new_p1_rating - p1_rating, new_p2_rating - p2_rating)

                if p1_name not in rating_changes:
                    rating_changes[p1_name] = [new_p1_rating - p1_rating]
                else:
                    rating_changes[p1_name].append(new_p1_rating - p1_rating)

                if p2_name not in rating_changes:
                    rating_changes[p2_name] = [new_p2_rating - p2_rating]
                else:
                    rating_changes[p2_name].append(new_p2_rating - p2_rating)
            except (TypeError, ValueError, AttributeError):
                continue

    new_ratings = copy.copy(current_ratings)
    for player in rating_changes:
        if player not in new_ratings:
            new_ratings[player] = 1000.0

        if isinstance(new_ratings[player], list):
            new_ratings[player] = float(new_ratings[player][0])
        elif isinstance(new_ratings[player], dict):
            new_ratings[player] = float(new_ratings[player].get('rating', 1000.0))
        else:
            new_ratings[player] = float(new_ratings[player])

        new_ratings[player] += sum(rating_changes[player])

    new_ratings = dict(
        sorted(new_ratings.items(), key=lambda item: item[1] if isinstance(item[1], (int, float)) else 1000.0,
               reverse=True))

    return new_ratings, match_rating_changes

def get_rating_diffs(current_ratings, new_ratings):
    rating_increased = {}
    rating_decreased = {}

    for key in new_ratings:
        old_raw = current_ratings.get(key, 1000.0)

        if isinstance(old_raw, list):
            old_rating = float(old_raw[0])
        elif isinstance(old_raw, dict):
            old_rating = float(old_raw.get('rating', 1000.0))
        else:
            old_rating = float(old_raw)

        new_raw = new_ratings[key]
        if isinstance(new_raw, list):
            new_rating = float(new_raw[0])
        elif isinstance(new_raw, dict):
            new_rating = float(new_raw.get('rating', 1000.0))
        else:
            new_rating = float(new_raw)

        rating_diff = round(new_rating - old_rating, 2)

        if rating_diff > 0:
            rating_increased[key] = rating_diff
        elif rating_diff < 0:
            rating_decreased[key] = rating_diff

    return rating_increased, rating_decreased

def new_league(date_str, google_cred, active_days, execute, print_out):
    google_sheet = GoogleSheet(date_str, google_cred)
    mongodb = MongoDB(date_str)
    league_scores = google_sheet.get_scores()
    league_players = google_sheet.get_league_players()

    current_ratings = mongodb.get_current_ratings()
    missing_players = league_players - current_ratings.keys()

    league_avg_ratings = {}
    for i in range(len(google_sheet.players_per_league)):
        league = i + 1
        if len(google_sheet.players_per_league[league]) == 0:
            break

        print(f'League {league}:')
        total_ratings = 0.0
        player_count = 0

        for p in google_sheet.players_per_league[league]:
            try:
                raw_val = current_ratings.get(p, 1000.0)
                if isinstance(raw_val, list):
                    total_ratings += float(raw_val)
                elif isinstance(raw_val, dict):
                    total_ratings += float(raw_val.get('rating', 1000.0))
                else:
                    total_ratings += float(raw_val)
                player_count += 1
            except KeyError:
                pass
            print(f'  {p}')

        if player_count > 0:
            league_avg_ratings[league] = total_ratings / player_count
        else:
            league_avg_ratings[league] = 0
        print()

    new_emails = {}
    for p in missing_players:
        if p != '':
            while True:
                for i in range(len(google_sheet.players_per_league)):
                    league = i + 1
                    if p in google_sheet.players_per_league[league]:
                        print(
                            f'Missing rating for "{p}", average ratings for league {league} is {round(league_avg_ratings[league], 2)}. Please enter initial rating: ',
                            end='')
                        break
                try:
                    current_ratings[p] = float(input())
                    break
                except ValueError:
                    print('Rating must be a number, please try again.')
                    continue
                except KeyboardInterrupt:
                    return

            while True:
                print(f'Please enter an email address for "{p}": ', end='')
                player_email = input()
                try:
                    new_emails[p] = player_email.strip().lower()
                    break
                except KeyboardInterrupt:
                    return

    print('Calculating new ratings...')
    new_ratings, match_rating_changes = calculate_new_ratings(current_ratings, league_scores, date_str, print_out)
    rating_increased, rating_decreased = get_rating_diffs(current_ratings, new_ratings)

    if print_out:
        for i in range(len(google_sheet.players_per_league)):
            league = i + 1
            if len(google_sheet.players_per_league[league]) == 0:
                break

            print(f'League {league}:')
            for p in google_sheet.players_per_league[league]:
                if p != '':
                    old_val = current_ratings.get(p, 1000.0)
                    if isinstance(old_val, list):
                        old_r = float(old_val)
                    elif isinstance(old_val, dict):
                        old_r = float(old_val.get('rating', 1000.0))
                    else:
                        old_r = float(old_val)

                    new_val = new_ratings.get(p, 1000.0)
                    new_r = float(new_val) if isinstance(new_val, list) else float(new_val)

                    print(f'  {p: >20}: {round(old_r, 2): >7.02f}   =>   {round(new_r - old_r, 2): >+7.02f}   =>   {round(new_r, 2): >7.02f}')
            print()

    if execute:
        while True:
            print('Update database and spreadsheet? [y/N] ', end='')
            execute_check = input()
            try:
                if execute_check.strip().lower() == 'y':
                    break
                else:
                    print('Database and spreadsheet NOT updated...')
                    return
            except KeyboardInterrupt:
                return
        print('Updating database and spreadsheet...')
        date_obj = datetime.strptime(date_str, '%m-%d-%Y')
        wrapped_new_ratings = {k: [v, date_obj] for k, v in new_ratings.items()}
        mongodb.set_new_ratings(wrapped_new_ratings, new_emails)
        google_sheet.set_new_ratings(wrapped_new_ratings, rating_increased, rating_decreased, active_days, match_rating_changes, new_emails)
        print('All done!')
    else:
        print('No execute flag detected, database and spreadsheet will not be updated.')

def update_database_from_sheet(date_str, google_cred, active_days, execute, print_out):
    print('Connecting to google sheets...')
    google_sheet = GoogleSheet(date_str, google_cred)

    print('Connecting to MongoDB...')
    mongodb = MongoDB(date_str)

    print('Reading ratings from sheet...')
    league_scores = google_sheet.get_all_ratings(allow_missing_dates=True)
    print(f'Successfully read {len(league_scores)} player ratings from sheet')

    print('Reading emails from sheet...')
    player_emails = google_sheet.get_player_emails_from_sheet()

    current_ratings = mongodb.get_current_ratings()

    # Build a dict of player -> last_played date from the database
    all_db_players_cursor = mongodb.get_all_players()
    all_db_players_cursor.rewind()
    player_dates = {}
    for p in all_db_players_cursor:
        if 'rating_history' in p and len(p['rating_history']) > 0:
            last_entry = p['rating_history'][-1]
            if isinstance(last_entry, dict):
                player_dates[p['name']] = last_entry.get('date', datetime.min)
            elif isinstance(last_entry, list):
                player_dates[p['name']] = last_entry[1] if len(last_entry) > 1 else datetime.min
            else:
                player_dates[p['name']] = datetime.min
        else:
            player_dates[p['name']] = datetime.min

    # Get all database players sorted by current rating to create a mapping
    all_db_players = list(mongodb.collection.aggregate([
        {'$addFields': {
            'last_rating': {'$last': '$rating_history.rating'}
        }},
        {'$sort': {'last_rating': DESCENDING}}
    ]))

    # Create a list of sheet players in order (already sorted by rating)
    sheet_players_in_order = list(league_scores.items())

    # Build a mapping from new names to old names (for players whose names changed)
    name_mapping = {}  # new_name -> old_name

    for sheet_idx, (sheet_name, v) in enumerate(sheet_players_in_order):
        r = float(v[0])

        # First try to find by exact name match
        player_db = mongodb.collection.find_one({'name': sheet_name})

        # If no exact match, try to find by position/index (matching by rank)
        if player_db is None and sheet_idx < len(all_db_players):
            potential_match = all_db_players[sheet_idx]

            # Extract actual current rating from rating_history
            hist = potential_match.get('rating_history', [])
            if hist:
                last = hist[-1]
                match_rating = float(last['rating']) if isinstance(last, dict) else float(last[0])
            else:
                match_rating = 1000.0
            if abs(match_rating - r) < 50:
                old_name = potential_match['name']

                # Verify this is a rename, not a new player: check if the DB player's
                # emails overlap with the sheet player's emails
                sheet_emails = player_emails.get(sheet_name, [])
                db_emails = potential_match.get('emails', [])
                email_overlap = any(e in db_emails for e in sheet_emails if e)
                if email_overlap or not sheet_emails:
                    name_mapping[sheet_name] = old_name
                    print(f'Name mapping: "{old_name}" -> "{sheet_name}"')
                else:
                    print(f'Skipped name mapping "{old_name}" -> "{sheet_name}" (no email overlap)')

    # Use existing dates from database for all players (preserving last played date)
    for sheet_player in league_scores:
        # Check if this is a renamed player
        db_player_name = name_mapping.get(sheet_player, sheet_player)

        if db_player_name in player_dates:
            league_scores[sheet_player][1] = player_dates[db_player_name]
        else:
            # New player without existing date - use a default
            league_scores[sheet_player][1] = datetime.strptime(date_str, '%m-%d-%Y').replace(hour=14)

    # For get_rating_diffs, we need to map the sheet names back to DB names temporarily
    current_ratings_adjusted = {}
    for sheet_name, rating_info in league_scores.items():
        db_name = name_mapping.get(sheet_name, sheet_name)
        if db_name in current_ratings:
            current_ratings_adjusted[sheet_name] = current_ratings[db_name]
        else:
            # New player - use the sheet rating as "current"
            current_ratings_adjusted[sheet_name] = rating_info

    print('Calculating rating changes...')
    rating_increased, rating_decreased = get_rating_diffs(current_ratings_adjusted, league_scores)

    if print_out:
        for sheet_name in league_scores:
            if sheet_name in current_ratings_adjusted:
                old_val = current_ratings_adjusted[sheet_name]
                if isinstance(old_val, list):
                    old_r = float(old_val[0])
                elif isinstance(old_val, dict):
                    old_r = float(old_val.get('rating', 1000.0))
                else:
                    old_r = float(old_val)
                new_val = league_scores[sheet_name][0]
                print(f'{sheet_name}')
                print(
                    f'  {round(old_r, 2): >7.02f}   =>   {round(new_val - old_r, 2): >+7.02f}   =>   {round(new_val, 2): >7.02f}')
                print()

    # Show which emails will be updated
    print(f'\nFound {len(player_emails)} player emails to update')

    google_sheet.print_active_status(league_scores, rating_increased, rating_decreased, active_days)
    if execute:
        while True:
            print('Update database? [y/N] ', end='')
            execute_check = input()
            try:
                if execute_check.strip().lower() == 'y':
                    break
                else:
                    print('Database and spreadsheet NOT updated...')
                    return
            except KeyboardInterrupt:
                return
        print('Updating database and spreadsheet...')
        # Update ratings for players with complete data
        mongodb.update_ratings_from_sheet(league_scores, player_emails, name_mapping)
        # Update emails for all other players in the database
        mongodb.update_emails_only(player_emails)

        # Re-sort the sheet by rating (highest first)
        print('Re-sorting player ratings on the sheet...')
        sorted_players = sorted(league_scores.items(), key=lambda x: x[1][0], reverse=True)
        all_player_ratings = [[i + 1, name, rating, ''] for i, (name, (rating, _)) in enumerate(sorted_players)]

        google_sheet.get_sheet()
        google_sheet.sheet.values().clear(
            spreadsheetId=google_sheet.SPREADSHEET_ID,
            range=google_sheet.RATINGS_RANGE
        ).execute()
        google_sheet.sheet.values().update(
            spreadsheetId=google_sheet.SPREADSHEET_ID,
            range=google_sheet.RATINGS_RANGE,
            valueInputOption='RAW',
            body={'values': all_player_ratings}
        ).execute()

        # Update the date header
        google_sheet.sheet.values().clear(
            spreadsheetId=google_sheet.SPREADSHEET_ID,
            range=google_sheet.RATINGS_HEADERS_RANGE
        ).execute()
        google_sheet.sheet.values().update(
            spreadsheetId=google_sheet.SPREADSHEET_ID,
            range=google_sheet.RATINGS_HEADERS_RANGE,
            valueInputOption='RAW',
            body={'values': [[f'{date_str}']]}
        ).execute()

        # Restore player emails with new rankings
        all_player_names = [name for name, _ in sorted_players]
        google_sheet.update_player_emails_in_sheet(player_emails, all_player_names, new_emails=None)
        print('All done!')
    else:
        print('No execute flag detected, database and spreadsheet will not be updated.')

def show_ratings(player_list: list, current, active_days):
    print('Connecting to MongoDB...')
    date_str = datetime.now().strftime('%m-%d-%Y')
    mongodb = MongoDB(date_str)
    player_list = mongodb.get_ratings_history(player_list)
    if current:
        print('   Name        Rating   Active')
    else:
        print('   Name        Ratings (latest ratings first)')
    for k, v in player_list.items():
        if current:
            active_player = True
            last_entry = v[-1]
            last_rating = float(last_entry['rating']) if isinstance(last_entry, dict) else float(last_entry[0])
            last_date = last_entry['date'] if isinstance(last_entry, dict) else last_entry[1]
            if (datetime.now() - last_date).days > active_days:
                active_player = False
            ratings = f'{round(last_rating, 2): >7.02f}   {active_player}'
        else:
            ratings = ', '.join([
                str(round(float(d['rating'] if isinstance(d, dict) else d[0]), 2))
                for d in v[::-1]
            ])
        player_info = f'  {k: <12} {ratings}'
        print(player_info)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '-m', '--mongodb-cert',
        dest='mongodb_cert',
        type=str,
        default='mongodb_cert.pem',
        help='Path to the MongoDB cert file, defaults to "mongodb_cert.pem".'
    )
    parser.add_argument(
        '-g', '--google-cred',
        dest='google_cred',
        type=str,
        default='google_cred.json',
        help='Path to the Google API credentials file, defaults to "google_cred.json".'
    )
    parser.add_argument(
        '-a', '--active-days',
        dest='active_days',
        type=int,
        default=60,
        help='The limit in days when players is set as inactive, defaults to 60 days.'
    )
    parser.add_argument(
        '-d', '--date',
        dest='date',
        type=str,
        help='The date of the league games, must be in the format of mm-dd-YYYY.'
    )
    parser.add_argument(
        '-n', '--new-league',
        dest='new_league',
        action='store_true',
        default=False,
        help='Use new league matches to update the ratings.'
    )
    parser.add_argument(
        '-s', '--show-ratings',
        dest='show_ratings',
        type=str,
        help='Show ratings history of players. Player names should be comma separated list, or "all" for all players.'
    )
    parser.add_argument(
        '-c', '--current',
        dest='current',
        action='store_true',
        default=False,
        help='This option must be paired with "-s", only show the current ratings of player(s).'
    )
    parser.add_argument(
        '-e', '--execute',
        dest='execute',
        action='store_true',
        default=False,
        help='This option is needed to actually update the database and spreadsheet.'
    )
    parser.add_argument(
        '-p', '--print-out',
        dest='print_out',
        action='store_true',
        default=False,
        help='Let the script print out the rating changes.'
    )
    parser.add_argument(
        '-u', '--update',
        dest='update_server',
        action='store_true',
        default=False,
        help='Update the server from Google Doc ratings sheet'
    )
    parser.add_argument(
        '-r', '--remove-league',
        dest='remove_league',
        action='store_true',
        default=False,
        help='Remove league matches of the specified date.'
    )
    args = parser.parse_args()

    if args.date:
        try:
            datetime.strptime(args.date, '%m-%d-%Y')
        except ValueError:
            print('Date must be in the format of mm-dd-YYYY.')
            exit(1)

    if args.new_league:
        if args.date is None:
            print('Must provide a date to process new league matches.')
            exit(1)
        new_league(args.date, args.google_cred, args.active_days, args.execute, args.print_out)
    elif args.update_server:
        if args.date is None:
            print('Must provide a date to process new league matches.')
            exit(1)
        update_database_from_sheet(args.date, args.google_cred, args.active_days,
                                   args.execute, args.print_out)
    elif args.remove_league:
        if args.date is None:
            print('Must provide a date to remove league matches.')
            exit(1)
        mongodb = MongoDB(args.date)
        mongodb.remove_league()
    elif args.show_ratings is not None:
        player_list = args.show_ratings.split(',')
        player_list = list(map(str.strip, player_list))
        show_ratings(player_list, args.current, args.active_days)

    exit(0)

if __name__ == '__main__':
    main()
