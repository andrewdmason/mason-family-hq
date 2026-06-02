/**
 * Genre options for the "by genre" recommendation menu, chosen by the reader's
 * age so a child never sees an adult-only genre. "Classics" means age-appropriate
 * "hall of fame" books — the timeless greats for that age, not adult literary
 * classics (the recommender is told to interpret it that way per the reader's age).
 */

const UNDER_10 = [
  "Adventure",
  "Funny",
  "Animals",
  "Fantasy & magic",
  "Mystery",
  "Graphic novels",
  "Science & nature",
  "Classics",
];

const MIDDLE_AND_TEEN = [
  "Adventure",
  "Fantasy",
  "Science fiction",
  "Mystery & thriller",
  "Realistic / contemporary",
  "Historical fiction",
  "Graphic novels",
  "Humor",
  "Horror & spooky",
  "Sports",
  "Classics",
];

const ADULT = [
  "Literary fiction",
  "Science fiction",
  "Fantasy",
  "Mystery & thriller",
  "Historical fiction",
  "Romance",
  "Horror",
  "Nonfiction",
  "Memoir & biography",
  "Classics",
];

/** The age-appropriate genre list for the menu. Unknown age → adult list. */
export function genresForAge(age: number | null): string[] {
  if (age == null) return ADULT;
  if (age < 10) return UNDER_10;
  if (age < 18) return MIDDLE_AND_TEEN;
  return ADULT;
}
