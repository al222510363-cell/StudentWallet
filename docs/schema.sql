CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    description VARCHAR(70) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
    category VARCHAR(40) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    date DATE NOT NULL,
    note VARCHAR(160) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category);

-- Presupuestos mensuales: un límite por categoría en cada mes.
CREATE TABLE IF NOT EXISTS budgets (
    id BIGSERIAL PRIMARY KEY,
    category VARCHAR(40) NOT NULL,
    limit_amount NUMERIC(12, 2) NOT NULL CHECK (limit_amount > 0),
    period_start DATE NOT NULL CHECK (EXTRACT(DAY FROM period_start) = 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_budgets_category_period UNIQUE (category, period_start)
);

CREATE INDEX IF NOT EXISTS idx_budgets_period_start ON budgets (period_start);
CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets (category);


-- Metas de ahorro y aportaciones individuales.
CREATE TABLE IF NOT EXISTS savings_goals (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(90) NOT NULL,
    description VARCHAR(200) NOT NULL DEFAULT '',
    target_amount NUMERIC(12, 2) NOT NULL CHECK (target_amount > 0),
    target_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_savings_goals_target_date ON savings_goals (target_date);
CREATE INDEX IF NOT EXISTS idx_savings_goals_created_at ON savings_goals (created_at DESC);

CREATE TABLE IF NOT EXISTS savings_contributions (
    id BIGSERIAL PRIMARY KEY,
    goal_id BIGINT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    contribution_date DATE NOT NULL DEFAULT CURRENT_DATE,
    note VARCHAR(160) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_savings_contributions_goal_date
    ON savings_contributions (goal_id, contribution_date DESC, id DESC);

-- Insignias desbloqueadas: cada codigo se registra una sola vez.
-- Los puntos quedan guardados aunque posteriormente cambien los movimientos o metas.
CREATE TABLE IF NOT EXISTS achievement_unlocks (
    code VARCHAR(50) PRIMARY KEY,
    points_awarded INTEGER NOT NULL CHECK (points_awarded > 0),
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_unlocked_at
    ON achievement_unlocks (unlocked_at DESC);
