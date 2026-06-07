-- Workouts: group multi-part WODs. When one named workout has parts with their
-- own scores ("Steak and Pudding: Part 1" = a cal bike, "Part 2" = an AMRAP),
-- each part is its own scored block but they share a group_label so the detail
-- view renders them together under the workout's name.
ALTER TABLE workout_blocks ADD COLUMN group_label text;
