-- Builds of the Clips Camera iPhone app for phones that can't use TestFlight
-- (Apple won't let under-13 accounts test). These are ad hoc builds: an iPhone
-- installs one only if it's registered on the family developer account, so the
-- files are harmless to anyone else. The bucket is public because iOS fetches
-- the app itself — from the install link on /clips/install — without any
-- sign-in. Only the publish script (service role) writes here.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('app-builds', 'app-builds', true, 524288000)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;
