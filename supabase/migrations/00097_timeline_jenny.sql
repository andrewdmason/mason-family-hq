-- Jenny Gillespie's timeline: a second subject's life events, layered onto the
-- Timeline shipped in 00094. Same shape as Andrew's seed — dated life events with
-- a category, prominence, normalized dates + precision — but with Jenny as the
-- subject of every row.
--
-- No people are inserted: Jenny (b0000094-0001-...0009) and Andrew
-- (b0000094-0001-...0001) already exist in the people registry from 00094, so we
-- reference their fixed UUIDs. The two events they share ("Recorded music at
-- Electrical Audio", "Left editorial work to pursue poetry and music") tag both as
-- subjects, so those rows surface on both Jenny's and Andrew's timelines from a
-- single canonical entry — exactly the no-duplication design 00094 describes.
--
-- Account-independent and idempotent (ON CONFLICT DO NOTHING) like 00094, so it
-- runs identically in dev and prod. Generated from
-- scripts/timeline-jenny-seed-source.json by scripts/gen-timeline-jenny-seed.mjs —
-- edit the data there and regenerate, don't hand-edit the rows below.

INSERT INTO timeline_entries
  (id, title, description, category, prominence, location, start_date, start_precision, end_date, end_precision, approximate) VALUES
  ('b0000097-0000-4001-8001-000000000001', 'Born in Springfield', 'Jenny Gillespie was born in Springfield, Illinois. She grew up in a creative, introverted household environment and developed an early love of poetry and music.', 'origins', 'major', 'Springfield, IL', '1980-08-10', 'day', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000002', 'Grew up in charismatic Christian church', 'Jenny grew up attending a charismatic Christian church, which shaped the spiritual atmosphere of her childhood and adolescence.', 'childhood', 'medium', 'Springfield, IL', '1980-01-01', 'year', '1998-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000003', 'Began writing poetry and songs', 'As a teenager, Jenny became deeply interested in poetry and songwriting, developing a creative identity centered on literature and music.', 'music_hobbies', 'major', 'Springfield, IL', '1995-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000004', 'Attended UVA creative writing workshop', 'Jenny attended a creative writing workshop at the University of Virginia and took a songwriting workshop, an experience that catalyzed her commitment to songwriting and performance.', 'education', 'medium', 'Charlottesville, VA', '1995-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000005', 'Started recording and performing publicly', 'Jenny began recording songs at a local studio and performing at coffeehouses and music festivals in St. Louis and Memphis while still in high school.', 'recognition', 'medium', 'Springfield, IL', '1995-01-01', 'year', '1998-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000006', 'Parents divorced', 'Jenny''s parents divorced around the time she turned eighteen, marking the end of Springfield as a lasting family home base.', 'health_hard_times', 'medium', 'Springfield, IL', '1998-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000007', 'Started University of Virginia', 'Jenny moved to Charlottesville to study English Literature at the University of Virginia. She focused on poetry and literature while continuing to write songs and perform at coffeehouses.', 'education', 'major', 'Charlottesville, VA', '1998-01-01', 'year', '2002-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000008', 'Moved to Austin for graduate school', 'Jenny moved to Austin to pursue a master''s degree in English Literature and Creative Writing. She continued writing, performing, and recording music during graduate school.', 'education', 'major', 'Austin, TX', '2002-01-01', 'year', '2004-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000009', 'Moved to Chicago', 'Jenny relocated to Chicago and became immersed in the city''s folk and literary communities, performing in coffeehouses and developing her songwriting.', 'homes', 'major', 'Chicago, IL', '2004-01-01', 'year', '2013-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000010', 'Worked at Cricket Magazine', 'Jenny worked as an editor at Cricket Magazine while continuing to write poetry and make music.', 'career', 'medium', 'Chicago, IL', '2006-01-01', 'year', '2011-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000011', 'Recorded music at Electrical Audio', 'Jenny recorded music at Electrical Audio in Chicago as she developed a more public folk music practice.', 'recognition', 'medium', 'Chicago, IL', '2006-01-01', 'year', '2011-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000012', 'Left editorial work to pursue poetry and music', 'Jenny left her editorial career to focus more fully on poetry, music, and creative work.', 'career', 'major', 'Chicago, IL', '2011-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000013', 'Pursued MFA in poetry', 'Jenny pursued an MFA in poetry while deepening her commitment to creative life and music.', 'education', 'medium', 'Chicago, IL', '2011-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000014', 'Ran Native Cat Recordings', 'Jenny ran the record label Native Cat Recordings while touring and recording as Sis.', 'career', 'major', 'San Francisco, CA', '2018-01-01', 'year', '2020-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000015', 'Began producing music in Ableton', 'Jenny began producing and recording her own music at home using Ableton, marking a major creative shift toward self-production and experimentation.', 'recognition', 'major', 'San Francisco, CA', '2020-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000016', 'Released music across multiple projects', 'Jenny released recordings under Sis, Ship Says Om, and Jenny Gillespie Mason, expanding into ambient, electronic, and folk forms.', 'recognition', 'major', NULL, '2020-01-01', 'year', '2026-01-01', 'year', false),
  ('b0000097-0000-4001-8001-000000000017', 'Discovered Integral Yoga', 'Jenny discovered Integral Yoga and became devoted to the teachings of Sri Aurobindo and the Mother, marking a major spiritual turning point.', 'health_hard_times', 'major', NULL, '2022-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000018', 'Traveled alone to India', 'Jenny traveled to India alone for spiritual exploration and study related to Integral Yoga.', 'travel', 'major', 'India', '2024-01-01', 'year', NULL, NULL, false),
  ('b0000097-0000-4001-8001-000000000019', 'Began publishing essays on Integral Yoga', 'Jenny began writing and publishing essays on Integral Yoga through her Substack, integrating spirituality and creative work.', 'recognition', 'medium', 'Berkeley, CA', '2024-01-01', 'year', NULL, NULL, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO timeline_entry_people (timeline_entry_id, person_id, role) VALUES
  ('b0000097-0000-4001-8001-000000000001', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000002', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000003', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000004', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000005', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000006', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000007', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000008', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000009', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000010', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000011', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000011', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000097-0000-4001-8001-000000000012', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000012', 'b0000094-0001-4001-8001-000000000001', 'subject'),
  ('b0000097-0000-4001-8001-000000000013', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000014', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000015', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000016', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000017', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000018', 'b0000094-0001-4001-8001-000000000009', 'subject'),
  ('b0000097-0000-4001-8001-000000000019', 'b0000094-0001-4001-8001-000000000009', 'subject')
ON CONFLICT (timeline_entry_id, person_id) DO NOTHING;
