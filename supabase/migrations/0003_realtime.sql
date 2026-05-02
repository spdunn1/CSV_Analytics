-- DERConnect: Realtime subscriptions
-- Enable Realtime on ingest_jobs so the upload progress bar works.

alter publication supabase_realtime add table ingest_jobs;

-- Optional: also track session status changes for the dashboard
alter publication supabase_realtime add table sessions;
