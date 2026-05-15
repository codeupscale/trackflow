SELECT 'CREATE DATABASE trackflow_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'trackflow_test')\gexec
