ALTER TABLE sync_vaults ADD COLUMN account_name TEXT;

CREATE UNIQUE INDEX idx_sync_vaults_account_name
ON sync_vaults(account_name);
