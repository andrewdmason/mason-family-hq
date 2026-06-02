-- "Didn't finish" becomes a rating rather than a status: abandoning a book is a
-- verdict on it (a soft negative), orthogonal to where the book sits in your
-- workflow. Added in its own migration because Postgres won't let a freshly-added
-- enum value be used in the same transaction — 00080 does the data migration.
ALTER TYPE reading_rating ADD VALUE IF NOT EXISTS 'didnt_finish';
