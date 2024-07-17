#!/usr/bin/env python3

from ast import arg
from bson.json_util import dumps
from pymongo import MongoClient, ASCENDING, DESCENDING
from datetime import datetime
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.auth.exceptions import RefreshError
import numpy as np
import pandas as pd
import argparse
import copy
import os.path

class ELO:

    def __init__(self):
        self.match_K = 5
        self.game_K = 40
        return

    def update_rating(self, player1_rating, player2_rating, score_differentials):
        # e = self.expected_result(player1_rating, player2_rating)
        # match_K = self.match_K
        # match_update_vals = []
        #
        # if len(score_differentials) < 3:
        #     print("Invalid Game: Not Enough Matches")
        #     exit(1)
        #
        # for match_score_diff in score_differentials:
        #     if match_score_diff > 0:
        #         rating_winner = player1_rating
        #         rating_loser = player2_rating
        #     else:
        #         rating_winner = player2_rating
        #         rating_loser = player1_rating
        #
        #     g = (np.log(np.abs(match_score_diff) + 1) * (2.2 / ((rating_winner - rating_loser) * 0.001 + 2.2)))
        #     w = 1 if match_score_diff > 0 else 0
        #
        #     update_val = (match_K * g) * (w - e)
        #     match_update_vals.append(update_val)
        #
        # match_update_val = np.sum(match_update_vals)

        results = [0 if diff < 0 else 1 for diff in score_differentials]

        win_dict = {0: 0, 1: 0}
        win_dict.update(pd.Series(results).value_counts().to_dict())
        game_score_diff = win_dict[1] - win_dict[0]
        rating_diff = player1_rating - player2_rating
        rating_change = self.rating_change(rating_diff, game_score_diff)
        # g = np.log(np.abs(game_score_diff) + 1) * (2.2 / ((rating_winner - rating_loser) * 0.001 + 2.2))
        # w = pd.Series(results).value_counts().idxmax()
        # game_update_val = (self.game_K * g) * (w - e)
        # return player1_rating + (game_update_val + match_update_val) / 2
        return player1_rating + rating_change

    def expected_result(self, player1_rating, player2_rating):
        exp = (player2_rating - player1_rating) / 400.0
        return 1 / ((10.0 ** (exp)) + 1)

    def rating_change(self, rating_diff, game_score_diff):
        is_higher_rated = rating_diff >= 0
        is_winner = game_score_diff > 0
        is_expected = not (is_higher_rated ^ is_winner)
        rating_diff = abs(rating_diff)
        games_left = abs(game_score_diff) - 1

        rating_range_list_long = [14, 27.75, 41.25, 54.5, 67.5, 80.25, 92.75, 105, 117, 128.75, 140.25, 151.5, 162.5,
                                  173.25, 183.75, 194, 204, 213.75, 223.25, 232.5, 241.5, 250.25, 258.75, 267, 275,
                                  282.75, 290.25, 297.5, 304.5, 311.25, 317.75, 324]
        rating_range_list = [range(30), range(60), range(90), range(120), range(150), range(180), range(210),
                             range(240), range(270), range(300)]
        rating_change_expected_dict_long = {0: [4, 6, 8],
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
        rating_change_expected_dict = {0: [6, 8, 10],
                                       1: [5, 7, 9],
                                       2: [2, 5, 8],
                                       3: [-1, 3, 7],
                                       4: [-4, 1, 6],
                                       5: [-7, -1, 5],
                                       6: [-10, -4, 4],
                                       7: [-13, -5, 3],
                                       8: [-16, -7, 2],
                                       9: [-19, -9, 1],
                                       10: [-22, -11, 0]
                                       }
        rating_change_unexpected_dict = {0: [6, 8, 10],
                                         1: [8, 10, 12],
                                         2: [11, 14, 17],
                                         3: [15, 19, 23],
                                         4: [20, 25, 30],
                                         5: [26, 32, 38],
                                         6: [33, 40, 47],
                                         7: [41, 49, 57],
                                         8: [50, 59, 68],
                                         9: [60, 70, 80],
                                         10: [71, 82, 93]
                                         }
        rating_change_unexpected_dict_long = {0: [4, 6, 8],
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
            rating_change_index = next(i for i, x in enumerate(rating_range_list_long) if rating_diff <= x)
        except StopIteration:
            rating_change_index = 32

        rating_change_dict = rating_change_expected_dict_long if is_expected else rating_change_unexpected_dict_long

        rating_change_list = rating_change_dict[rating_change_index]

        rating_offset = rating_change_list[games_left] if is_winner else -rating_change_list[games_left]

        return rating_offset


class Player:

    def __init__(self, name, rating = None):
        self.name = name
        self.matches_history = None

        if rating is not None:
            self.rating = rating
        else:
            self.rating = 1000
        return

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

    CONNECTION_URI = 'mongodb+srv://duke-cluster.ops3ljm.mongodb.net/?authSource=%24external&authMechanism=MONGODB-X509&retryWrites=true&w=majority'

    def __init__(self, date_str, cert_file='mongodb_cert.pem'):
        # client = MongoClient('localhost', 27017)
        if not os.path.exists(cert_file):
            print(f'Missing mongodb cert file: {cert_file}')
            exit(1)
        client = MongoClient(self.CONNECTION_URI, tls=True, tlsCertificateKeyFile=cert_file)
        db = client['ccttc_ratings']
        self.collection = db['players']

        self.all_players = None
        self.current_ratings = {}
        self.date_str = date_str

        return

    def backup(self):
        cursor = self.collection.find()
        backup_file_name = f'ratings_before_{self.date_str}_'
        count = 0
        while True:
            if os.path.exists(f'{backup_file_name}{count}.json'):
                count += 1
            else:
                backup_file_name = f'{backup_file_name}{count}.json'
                break

        with open(backup_file_name, 'w') as out_file:
            for d in cursor:
                out_file.write(dumps(d) + '\n')
        return

    def get_all_players(self):
        self.all_players = self.collection.find().sort('current_rating', DESCENDING)
        return self.all_players

    def get_current_ratings(self):
        if self.all_players is None:
            self.get_all_players()

        self.all_players.rewind()
        for p in self.all_players:
            self.current_ratings[p['name']] = p['historical_ratings'][-1]
        return self.current_ratings

    def get_player_history(self, player_name: str):
        player_info = self.collection.find_one({'name': player_name})
        if player_info is not None:
            return player_info['historical_ratings']
        else:
            return []

    def get_ratings_history(self, player_list: list):
        ratings_history = {}
        if 'all' in map(str.lower, player_list):
            if self.all_players is None:
                self.get_all_players()

            self.all_players.rewind()
            for p in self.all_players:
                ratings_history[p['name']] = p['historical_ratings']
        else:
            for p in player_list:
                ratings_history[p] = self.get_player_history(p)
        return ratings_history

    def get_last_update_date(self):
        if self.all_players is None:
            self.get_all_players()

        last_update = datetime.strptime('2000-01-01', '%Y-%m-%d').replace(hour=14)
        self.all_players.rewind()
        for p in self.all_players:
            last_update = p['last_played'] if p['last_played'] > last_update else last_update
        return last_update

    def set_new_ratings(self, new_ratings: dict, new_emails: dict=None):
        for k, v in new_ratings.items():
            player = self.collection.find_one({'name': k})
            r = float(v[0])
            d = v[1]
            if player is None:
                new_player = {
                    'name': k,
                    'email': new_emails[k],
                    'leagues_played': 1,
                    'last_played': d,
                    'current_rating': r,
                    'historical_ratings': [[r, d]]
                }
                self.collection.insert_one(new_player)
            else:
                if player['last_played'] < d:
                    player['historical_ratings'].append([r, d])
                    self.collection.update_one(
                        {'name': k},
                        {
                            '$inc': {'leagues_played': 1},
                            '$set': {
                                'last_played': d,
                                'current_rating': r,
                                'historical_ratings': player['historical_ratings']
                            }
                        }
                    )
        return

    def update_ratings_from_sheet(self, new_ratings: dict, new_emails: dict=None):
        for k, v in new_ratings.items():
            player = self.collection.find_one({'name': k})
            r = float(v[0])
            d = v[1]
            if player is None:
                new_player = {
                    'name': k,
                    'email': new_emails[k],
                    'leagues_played': 1,
                    'last_played': d,
                    'current_rating': r,
                    'historical_ratings': [[r, d]]
                }
                self.collection.insert_one(new_player)
            else:
                player['historical_ratings'].append([r, d])
                self.collection.update_one(
                    {'name': k},
                    {
                        '$set': {
                            'last_played': d,
                            'current_rating': r,
                            'historical_ratings': player['historical_ratings']
                        }
                    }
                )
        return

    def remove_league(self):
        return


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
        self.ratings_range = [f'{date_str}!C2:D7', f'{date_str}!C19:D24', f'{date_str}!C36:D41']
        self.score_ranges = [f'{date_str}!G2:R16', f'{date_str}!G19:R33', f'{date_str}!G36:R50']
        self.player_ranges = [f'{date_str}!B2:B7', f'{date_str}!B19:B24', f'{date_str}!B36:B41']
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
        return

    def get_sheet(self):
        try:
            service = build('sheets', 'v4', credentials=self.creds)
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
                    row[:2] = map(str.strip, row[:2])
                    row[2:] = map(int, row[2:])
                self.scores.extend(scores)
        except HttpError as err:
            print(f'Failed to get league scores, error: {err}')
            exit(1)
        return self.scores

    def get_all_ratings(self):
        if self.sheet is None:
            self.get_sheet()

        try:
            values = self.sheet.values().get(spreadsheetId=self.SPREADSHEET_ID, range=self.PLAYERS_RANGE).execute()
            ratings = values.get('values', [])

            player_ratings = {}
            for player in ratings:
                player_ratings[player[0]] = [float(player[1]), player[2]]
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

    def set_new_ratings(self, new_ratings: dict, rating_increased: dict, rating_decreased: dict, active_days):
        try:
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
                if (datetime.strptime(self.date_str, '%Y-%m-%d').replace(hour=14) - v[1]).days > active_days:
                    active_player = False
                all_player_ratings.append([ranking, k, v[0], active_player])
                print(f'{k}     active:{active_player}')

            for l in self.players_per_league:
                values = []
                for p in self.players_per_league[l]:
                    if p == '':
                        values.append(['', ''])
                    else:
                        values.append(league_player_ratings[p])
                self.sheet.values().update(spreadsheetId=self.SPREADSHEET_ID, range=self.ratings_range[l - 1], valueInputOption='RAW', body={'values': values}).execute()

            self.sheet.values().clear(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_HEADERS_RANGE).execute()
            self.sheet.values().update(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_HEADERS_RANGE, valueInputOption='RAW', body={'values': [[f'{self.date_str}']]}).execute()
            self.sheet.values().clear(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_RANGE).execute()
            self.sheet.values().update(spreadsheetId=self.SPREADSHEET_ID, range=self.RATINGS_RANGE, valueInputOption='RAW', body={'values': all_player_ratings}).execute()
        except HttpError as err:
            print(f'Failed to update ratings, error: {err}')
            exit(1)
        return

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
            if (datetime.strptime(self.date_str, '%Y-%m-%d').replace(hour=14) - v[1]).days > active_days:
                active_player = False
            all_player_ratings.append([ranking, k, v[0], active_player])
            print(f'{k}     active:{active_player}')
        return


def calculate_new_ratings(current_ratings, league_scores, date_str, print_out):
    rating_changes = {}
    for row in league_scores:
        if len(row) < 2:
            continue
        p1_name = row[0]
        p2_name = row[1]
        if p1_name == '' or p2_name == '':
            continue
        p1_rating = current_ratings[p1_name][0]
        p2_rating = current_ratings[p2_name][0]
        p1 = Player(p1_name, p1_rating)
        p2 = Player(p2_name, p2_rating)
        score_diffs_p1vp2 = []
        score_diffs_p2vp1 = []
        for game in range(5): # the match is best of 5
            idx = game * 2 + 2
            try:
                score1 = row[idx]
                score2 = row[idx +1]
                if (not np.isnan(score1)) and (not np.isnan(score2)):
                    score_diffs_p1vp2.append(score1 - score2)
                    score_diffs_p2vp1.append(score2 - score1)
            except IndexError:
                break
        if (len(score_diffs_p1vp2) > 0) and (len(score_diffs_p2vp1) > 0):
            new_p1_rating = p1.add_match_against(p2, score_diffs_p1vp2, print_out)
            new_p2_rating = p2.add_match_against(p1, score_diffs_p2vp1, print_out)
            if print_out:
                print()

            if p1_name not in rating_changes:
                rating_changes[p1_name] = [new_p1_rating - p1_rating]
            else:
                rating_changes[p1_name].append(new_p1_rating - p1_rating)
            if p2_name not in rating_changes:
                rating_changes[p2_name] = [new_p2_rating - p2_rating]
            else:
                rating_changes[p2_name].append(new_p2_rating - p2_rating)

    new_ratings = copy.deepcopy(current_ratings)
    if date_str == '':
        print('No date provided, retaining existing dates')
    for player in rating_changes:
        new_ratings[player][0] += sum(rating_changes[player])
        if date_str != '':
            new_ratings[player][1] = datetime.strptime(date_str, '%Y-%m-%d').replace(hour=14)
        else:
            new_ratings[player][1] = current_ratings[player][1]
    new_ratings = dict(sorted(new_ratings.items(), key=lambda item: item[1][0], reverse=True))

    return new_ratings


def get_rating_diffs(current_ratings, new_ratings):
    rating_increased = {}
    rating_decreased = {}

    for key in new_ratings:
        rating_diff = round(new_ratings[key][0] - current_ratings[key][0], 2)
        if key in current_ratings and (rating_diff > 0):
            rating_increased[key] = rating_diff
        elif key in current_ratings and (rating_diff < 0):
            rating_decreased[key] = rating_diff

    return rating_increased, rating_decreased


def new_league(date_str, cert_file, google_cred, active_days, execute, print_out):
    print('Connecting to google sheets...')
    google_sheet = GoogleSheet(date_str, google_cred)

    print('Connecting to MongoDB...')
    mongodb = MongoDB(date_str, cert_file)

    league_scores = google_sheet.get_scores()
    if not league_scores:
        print(f'No scores found for {date_str}.')
        return
    league_players = google_sheet.get_league_players()

    last_update = mongodb.get_last_update_date()
    if last_update >= datetime.strptime(date_str, '%Y-%m-%d').replace(hour=14):
        print(f'Leagues on "{date_str}" has already been processed before.')
        return
    current_ratings = mongodb.get_current_ratings()
    missing_players = league_players - current_ratings.keys()

    print()
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
                total_ratings += current_ratings[p][0]
                player_count += 1
            except KeyError:
                pass
            print(f'  {p}')
        if player_count > 0:
            league_avg_ratings[league] = total_ratings / player_count
        else:
            league_avg_ratings[league] = 0
        print()

    while True:
        print('Please make sure the players listed above are correct for each league. [y/N] ', end='')
        player_check = input()
        try:
            if player_check.strip().lower() == 'y':
                break
            else:
                print('\nPlease check the date of the league matches, then try running the script again.')
                return
        except KeyboardInterrupt:
            return

    new_emails = {}
    for p in missing_players:
        if p != '':
            while True:
                for i in range(len(google_sheet.players_per_league)):
                    league = i + 1
                    if p in google_sheet.players_per_league[league]:
                        print(f'Missing rating for "{p}", average ratings for league {league} is {round(league_avg_ratings[league], 2)}. Please enter initial rating: ', end='')
                        break
                try:
                    current_ratings[p] = [float(input()), datetime.strptime(date_str, '%Y-%m-%d').replace(hour=14)]
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
    new_ratings = calculate_new_ratings(current_ratings, league_scores, date_str, print_out)
    rating_increased, rating_decreased = get_rating_diffs(current_ratings, new_ratings)

    if print_out:
        for i in range(len(google_sheet.players_per_league)):
            league = i + 1
            if len(google_sheet.players_per_league[league]) == 0:
                break

            print(f'League {league}:')
            for p in google_sheet.players_per_league[league]:
                if p != '':
                    print(f'  {p: >20}: {round(current_ratings[p][0], 2): >7.02f}   =>   {round(new_ratings[p][0] - current_ratings[p][0], 2): >+7.02f}   =>   {round(new_ratings[p][0], 2): >7.02f}')
            print()

    # Just in case things go wrong, we backup the database locally.
    # The backup file can be used to import to mongodb using command "mongoimport".
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
        mongodb.backup()
        mongodb.set_new_ratings(new_ratings, new_emails)
        google_sheet.set_new_ratings(new_ratings, rating_increased, rating_decreased, active_days)
        print('All done!')
    else:
        print('No execute flag detected, database and spreadsheet will not be updated.')

    return


def update_database_from_sheet(date_str, cert_file, google_cred, active_days, execute, print_out):
    print('Connecting to google sheets...')
    google_sheet = GoogleSheet(date_str, google_cred)

    print('Connecting to MongoDB...')
    mongodb = MongoDB(date_str, cert_file)

    league_scores = google_sheet.get_all_ratings()
    current_ratings = mongodb.get_current_ratings()

    for player in current_ratings:
        league_scores[player][1] = current_ratings[player][1]

    print('Calculating new ratings...')
    rating_increased, rating_decreased = get_rating_diffs(current_ratings, league_scores)

    if print_out:
        for i in current_ratings:
            print(f'{i}')
            print(
                f'  {round(current_ratings[i][0], 2): >7.02f}   =>   {round(league_scores[i][0] - current_ratings[i][0], 2): >+7.02f}   =>   {round(league_scores[i][0], 2): >7.02f}')
            print()

    google_sheet.print_active_status(league_scores, rating_increased, rating_decreased, active_days)
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
        mongodb.backup()
        mongodb.update_ratings_from_sheet(league_scores, {})
        google_sheet.set_new_ratings(league_scores, rating_increased, rating_decreased, active_days)
        print('All done!')
    else:
        print('No execute flag detected, database and spreadsheet will not be updated.')
    return


def show_ratings(cert_file, player_list: list, current, active_days):
    print('Connecting to MongoDB...')
    date_str = datetime.now().strftime('%Y-%m-%d')
    mongodb = MongoDB(date_str, cert_file)
    player_list = mongodb.get_ratings_history(player_list)
    if current:
        print('   Name        Rating   Active')
    else:
        print('   Name        Ratings (latest ratings first)')
    for k, v in player_list.items():
        if current:
            active_player = True
            if (datetime.now() - v[-1][1]).days > active_days:
                active_player = False
            ratings = f'{round(v[-1][0], 2): >7.02f}   {active_player}'
        else:
            ratings = ', '.join([str(round(d[0], 2)) for d in v[::-1]])
        player_info = f'  {k: <12} {ratings}'
        print(player_info)
    return

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
        help='The date of the league games, must be in the format of yyyy-mm-dd.'
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
    #TODO: remove a league
    parser.add_argument(
        '-r', '--remove-league',
        dest='remove_league',
        action='store_true',
        default=False,
        help='Remove league matches of the specified date.'
    )
    args = parser.parse_args()

    if args.new_league:
        if args.date is None:
            print('Must provide a date to process new league matches.')
            exit(1)
        try:
            league_date = datetime.strptime(args.date, '%Y-%m-%d')
        except ValueError:
            print('Date must be in the format of yyyy-mm-dd.')
            exit(1)
        new_league(args.date, args.mongodb_cert, args.google_cred, args.active_days, args.execute, args.print_out)
    elif args.update_server:
        if args.date is None:
            print('Must provide a date to process new league matches.')
            exit(1)
        try:
            league_date = datetime.strptime(args.date, '%Y-%m-%d')
        except ValueError:
            print('Date must be in the format of yyyy-mm-dd.')
            exit(1)
        update_database_from_sheet(args.date, args.mongodb_cert, args.google_cred, args.active_days,
                                   args.execute, args.print_out)
    elif args.remove_league:
        if args.date is None:
            print('Must provide a date to remove league matches.')
            exit(1)
        try:
            league_date = datetime.strptime(args.date, '%Y-%m-%d')
        except ValueError:
            print('Date must be in the format of yyyy-mm-dd.')
            exit(1)
        mongodb = MongoDB(args.date, args.mongodb_cert)
        mongodb.remove_league()
    elif args.show_ratings is not None:
        player_list = args.show_ratings.split(',')
        player_list = list(map(str.strip, player_list))
        show_ratings(args.mongodb_cert, player_list, args.current, args.active_days)

    exit(0)


if __name__ == '__main__':
    main()
