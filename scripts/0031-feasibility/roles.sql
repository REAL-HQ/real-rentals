-- Cluster-global: roles exist once per cluster, not per database. Loading
-- these inside the per-database schema made every reset after the first
-- abort on "role already exists", which left later scenarios asserting
-- against an empty database and passing vacuously.
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE ROLE app_exec      LOGIN BYPASSRLS CREATEROLE;
CREATE ROLE storage_owner LOGIN NOINHERIT;
CREATE ROLE super_exec    LOGIN SUPERUSER;

