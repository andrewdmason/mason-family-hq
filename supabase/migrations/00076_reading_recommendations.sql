-- Book recommendations: a queued book another family member added to your list.
--
-- recommended_by_email is who it's from; recommended_by_label is how to show
-- them, resolved from the parent links at recommend time ("Dad"/"Mom", else
-- their first name) so display needs no cross-member reads. recommendation_note
-- is an optional message about why they're recommending it.
ALTER TABLE reading_books ADD COLUMN recommended_by_email text
  REFERENCES journal_members(email) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE reading_books ADD COLUMN recommended_by_label text;
ALTER TABLE reading_books ADD COLUMN recommendation_note text;
