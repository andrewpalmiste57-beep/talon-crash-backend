CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL,
    username VARCHAR(32) NOT NULL,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 1000.00,
    total_wagered DECIMAL(15, 2) DEFAULT 0,
    total_won DECIMAL(15, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rounds (
    id SERIAL PRIMARY KEY,
    round_id VARCHAR(64) UNIQUE NOT NULL,
    crash_point DECIMAL(10, 2) NOT NULL,
    server_seed VARCHAR(128) NOT NULL,
    client_seed VARCHAR(64) NOT NULL,
    nonce INTEGER NOT NULL DEFAULT 0,
    hash VARCHAR(128) NOT NULL,
    total_bets INTEGER DEFAULT 0,
    total_wagered DECIMAL(15, 2) DEFAULT 0,
    total_payout DECIMAL(15, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bets (
    id SERIAL PRIMARY KEY,
    bet_id VARCHAR(64) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL REFERENCES users(user_id),
    round_id VARCHAR(64) NOT NULL REFERENCES rounds(round_id),
    bet_amount DECIMAL(10, 2) NOT NULL,
    auto_cashout DECIMAL(10, 2),
    cashout_multiplier DECIMAL(10, 2),
    winnings DECIMAL(10, 2),
    won BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    cashed_out_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_created_at ON bets(created_at);
CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds(created_at);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_24h AS
SELECT user_id, COUNT(*) as total_rounds, SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins, SUM(winnings - bet_amount) as profit
FROM bets WHERE created_at > NOW() - INTERVAL '1 day' GROUP BY user_id ORDER BY profit DESC LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_user ON leaderboard_24h(user_id);

