-- Mason Bucks: an optional "where to buy" link on a prize.
--
-- Lets an adult attach a purchase URL (Amazon, a store page, etc.) to a prize
-- so they can find and order it once a kid redeems. Plain text, nullable — no
-- signing or storage involved, unlike image_path.
ALTER TABLE bucks_prizes ADD COLUMN purchase_url text;
