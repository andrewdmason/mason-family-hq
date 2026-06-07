-- Question mode replaces the five-minute timer as the gate on AI chat: a manual
-- per-entry toggle the writer flips on or off. ON, the per-message button submits
-- the writer's text and asks the interviewer for a follow-up question; OFF, it
-- just saves the text as a block. Defaults to false (a blank post starts quiet;
-- picking an opening question sets it true explicitly).
ALTER TABLE journal_entries
  ADD COLUMN question_mode boolean NOT NULL DEFAULT false;

-- The five-minute timer is now purely a "time spent on this post" counter. Its
-- one tie to question mode is a single gentle flip to OFF when it completes;
-- this records that the flip already happened, so it fires exactly once and the
-- writer can freely turn question mode back on afterward without it re-flipping.
ALTER TABLE journal_entries
  ADD COLUMN timer_flipped_off boolean NOT NULL DEFAULT false;

-- The unsent in-progress reply draft, autosaved so leaving mid-sentence loses
-- nothing. Cleared once the text is committed via Send/Save.
ALTER TABLE journal_entries
  ADD COLUMN draft_reply text;
