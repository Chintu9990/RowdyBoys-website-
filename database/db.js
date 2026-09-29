require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'rowdy.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  game TEXT DEFAULT 'Free Fire',
  mode TEXT DEFAULT 'squad',        -- solo | duo | squad | any
  format TEXT DEFAULT 'league',     -- league | knockout | both
  entry_fee REAL DEFAULT 0,
  prize_pool REAL DEFAULT 0,
  start_date TEXT,
  reg_deadline TEXT,
  max_teams INTEGER DEFAULT 25,
  status TEXT DEFAULT 'registration_open', -- registration_open | registration_closed | started | completed
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  contact TEXT,
  logo TEXT,
  status TEXT DEFAULT 'pending',    -- pending | approved | rejected
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  uid TEXT,
  slot INTEGER DEFAULT 1,
  FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  team_a_id INTEGER,
  team_b_id INTEGER,
  match_date TEXT,
  match_time TEXT,
  match_type TEXT DEFAULT 'League',
  rounds INTEGER DEFAULT 6,
  stage TEXT DEFAULT 'League',      -- League | QF | SF | Final | GF
  status TEXT DEFAULT 'UPCOMING',   -- UPCOMING | LIVE | COMPLETED | CANCELLED | POSTPONED
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS match_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER UNIQUE NOT NULL,
  team_a_rounds INTEGER DEFAULT 0,
  team_b_rounds INTEGER DEFAULT 0,
  winner_id INTEGER,
  loser_id INTEGER,
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_match_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  kills INTEGER DEFAULT 0,
  deaths INTEGER DEFAULT 0,
  rounds_played INTEGER DEFAULT 0,
  FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scoring_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER UNIQUE,
  win_points REAL DEFAULT 3,
  draw_points REAL DEFAULT 1,
  loss_points REAL DEFAULT 0,
  kill_points REAL DEFAULT 0,
  rank_order TEXT DEFAULT '["points","wins","rd","kills"]'
);

CREATE TABLE IF NOT EXISTS prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  position INTEGER,
  reward TEXT,
  amount REAL DEFAULT 0,
  claimed INTEGER DEFAULT 0,
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tournament_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  rule_text TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_stats_match ON player_match_stats(match_id);
`);

// Seed admin account
const adminUser = process.env.ADMIN_USERNAME || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'rowdyboys123';
const existing = db.prepare('SELECT id FROM admins WHERE username=?').get(adminUser);
if (!existing) {
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?,?)')
    .run(adminUser, bcrypt.hashSync(adminPass, 10));
  console.log('✔ Admin seeded:', adminUser);
}
// ---------- PAYMENT MIGRATIONS ----------
function addCol(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`  + added ${table}.${col}`);
  }
}

addCol('tournaments', 'upi_id',            "TEXT DEFAULT ''");
addCol('tournaments', 'upi_qr',            "TEXT DEFAULT ''");
addCol('tournaments', 'cash_instructions', "TEXT DEFAULT ''");
addCol('teams',       'payment_method',    "TEXT DEFAULT ''");
addCol('teams',       'payment_status',    "TEXT DEFAULT 'unpaid'");
addCol('teams',       'payment_proof',     "TEXT DEFAULT ''");
addCol('teams',       'payment_note',      "TEXT DEFAULT ''");

// ---------- AUCTION TABLES ----------
db.exec(`
CREATE TABLE IF NOT EXISTS auction_franchises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  short_name TEXT,
  logo TEXT,
  purse_total REAL DEFAULT 10000000,
  purse_remaining REAL DEFAULT 10000000,
  owner_username TEXT UNIQUE,
  owner_password_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auction_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  uid TEXT,
  role TEXT DEFAULT 'player',
  base_price REAL DEFAULT 100000,
  avatar TEXT,
  status TEXT DEFAULT 'available',
  franchise_id INTEGER,
  sold_price REAL,
  sold_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(franchise_id) REFERENCES auction_franchises(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  franchise_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auction_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_player_id INTEGER,
  current_bid REAL DEFAULT 0,
  current_bidder_id INTEGER,
  base_price REAL DEFAULT 0,
  status TEXT DEFAULT 'idle',
  timer_end_at INTEGER,
  timer_seconds INTEGER DEFAULT 30,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auction_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  min_increment REAL DEFAULT 50000,
  default_timer INTEGER DEFAULT 30,
  default_purse REAL DEFAULT 10000000
);

CREATE INDEX IF NOT EXISTS idx_auction_players_status ON auction_players(status);
CREATE INDEX IF NOT EXISTS idx_auction_players_franchise ON auction_players(franchise_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_player ON auction_bids(player_id);
`);

db.prepare('INSERT OR IGNORE INTO auction_state (id) VALUES (1)').run();
db.prepare('INSERT OR IGNORE INTO auction_config (id) VALUES (1)').run();
module.exports = db;
