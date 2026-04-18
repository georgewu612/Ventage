-- ETL job execution history
CREATE TABLE IF NOT EXISTS job_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('success', 'error')),
  collected     INTEGER,
  loaded        INTEGER,
  error_message TEXT,
  duration_ms   INTEGER,
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_name_ran_at
  ON job_runs (job_name, ran_at DESC);

-- RLS: readable by authenticated users (service role bypasses RLS anyway)
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_runs_select" ON job_runs
  FOR SELECT USING (auth.role() = 'authenticated');
