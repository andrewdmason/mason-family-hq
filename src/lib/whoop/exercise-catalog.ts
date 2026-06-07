// Bundled WHOOP Strength Trainer exercise metadata — only the exercises our
// movement crosswalk (00127_whoop_exercise_map) maps to, not WHOOP's full ~373.
// Captured from WHOOP's private catalog (GET /weightlifting-service/v2/exercise).
//
// Why bundle it: the lift-log payload must denormalize the FULL exercise record
// into each workout_exercises[].exercise_details (WHOOP's POST validates the
// shape). The DB map (whoop_exercise_map) only stores the id pointer; the
// metadata to expand it lives here, looked up by id at push time.
//
// Verification note: these are reverse-engineered shapes. Refresh against a live
// GET /exercise before fully trusting them (see src/lib/whoop/README or the
// integration's verification steps).

export interface WhoopExercise {
  exercise_id: string;
  name: string;
  muscle_groups: string[];
  primary_muscle: string;
  equipment: string; // display form, e.g. "Barbell"
  movement_pattern: string; // display form, e.g. "Squat"
  laterality: string;
  raw_equipment: string; // enum form, e.g. "BARBELL"
  raw_movement_pattern: string; // enum form, e.g. "SQUAT"
}

const EXERCISES: WhoopExercise[] = [
  {
    "exercise_id": "ALTERNATINGFRONTRACKLUNGES_BARBELL",
    "name": "Front Rack Lunge - Alternating - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Lunge",
    "laterality": "ALTERNATING",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "LUNGE"
  },
  {
    "exercise_id": "BACKSQUAT_BARBELL",
    "name": "Back Squat - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Squat",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "SQUAT"
  },
  {
    "exercise_id": "BENCHPRESS_BARBELL",
    "name": "Bench Press - Barbell",
    "muscle_groups": [
      "CHEST"
    ],
    "primary_muscle": "Chest",
    "equipment": "Barbell",
    "movement_pattern": "Horizontal Press",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "HORIZONTAL_PRESS"
  },
  {
    "exercise_id": "BENTOVERROW_BARBELL",
    "name": "Bent Over Row - Barbell",
    "muscle_groups": [
      "BACK"
    ],
    "primary_muscle": "Back",
    "equipment": "Barbell",
    "movement_pattern": "Horizontal Pull",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "HORIZONTAL_PULL"
  },
  {
    "exercise_id": "CHESTTOBARPULLUPS",
    "name": "Pull Ups - Chest to Bar",
    "muscle_groups": [
      "BACK"
    ],
    "primary_muscle": "Back",
    "equipment": "Bodyweight",
    "movement_pattern": "Vertical Pull",
    "laterality": "BILATERAL",
    "raw_equipment": "BODY",
    "raw_movement_pattern": "VERTICAL_PULL"
  },
  {
    "exercise_id": "CLEAN_BARBELL",
    "name": "Clean - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "CLEANJERK_BARBELL",
    "name": "Clean and Split Jerk - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "DEADLIFT_BARBELL",
    "name": "Deadlift - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Hinge",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "HINGE"
  },
  {
    "exercise_id": "FARMERSWALK_DUMBBELL",
    "name": "Farmer's Walk - Dumbbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Dumbbell",
    "movement_pattern": "Other",
    "laterality": "BILATERAL",
    "raw_equipment": "DUMBBELL",
    "raw_movement_pattern": "OTHER"
  },
  {
    "exercise_id": "FRONTSQUAT_BARBELL",
    "name": "Front Squat - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Squat",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "SQUAT"
  },
  {
    "exercise_id": "GOBLETSQUAT_DUMBBELL",
    "name": "Goblet Squat - Dumbbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Dumbbell",
    "movement_pattern": "Squat",
    "laterality": "BILATERAL",
    "raw_equipment": "DUMBBELL",
    "raw_movement_pattern": "SQUAT"
  },
  {
    "exercise_id": "GOODMORNING_BARBELL",
    "name": "Good Morning - Barbell",
    "muscle_groups": [
      "BACK"
    ],
    "primary_muscle": "Back",
    "equipment": "Barbell",
    "movement_pattern": "Hinge",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "HINGE"
  },
  {
    "exercise_id": "HANDSTAND_PUSH-UPS",
    "name": "Handstand Push-Ups",
    "muscle_groups": [
      "SHOULDERS",
      "ARMS"
    ],
    "primary_muscle": "Shoulders, Arms",
    "equipment": "Bodyweight",
    "movement_pattern": "Vertical Press",
    "laterality": "BILATERAL",
    "raw_equipment": "BODY",
    "raw_movement_pattern": "VERTICAL_PRESS"
  },
  {
    "exercise_id": "HANGCLEAN_BARBELL",
    "name": "Hang Clean - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "HANGINGTOESTOBAR",
    "name": "Hanging Toes to Bar",
    "muscle_groups": [
      "CORE"
    ],
    "primary_muscle": "Core",
    "equipment": "Pull Up Bar",
    "movement_pattern": "Other",
    "laterality": "BILATERAL",
    "raw_equipment": "PULL_UP_BAR",
    "raw_movement_pattern": "OTHER"
  },
  {
    "exercise_id": "HANGPOWERCLEAN_BARBELL",
    "name": "Hang Power Clean - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "HANGPOWERSNATCH_BARBELL",
    "name": "Hang Power Snatch - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "HANGSNATCH_BARBELL",
    "name": "Hang Snatch - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "INVERTEDROW_RINGS",
    "name": "Inverted Row - Rings",
    "muscle_groups": [
      "BACK"
    ],
    "primary_muscle": "Back",
    "equipment": "Other",
    "movement_pattern": "Horizontal Pull",
    "laterality": "BILATERAL",
    "raw_equipment": "OTHER",
    "raw_movement_pattern": "HORIZONTAL_PULL"
  },
  {
    "exercise_id": "MUSCLEUPS",
    "name": "Muscle Ups",
    "muscle_groups": [
      "BACK"
    ],
    "primary_muscle": "Back",
    "equipment": "Bodyweight",
    "movement_pattern": "Vertical Pull",
    "laterality": "BILATERAL",
    "raw_equipment": "BODY",
    "raw_movement_pattern": "VERTICAL_PULL"
  },
  {
    "exercise_id": "OVERHANDGRIPPULLUPS",
    "name": "Pull Up",
    "muscle_groups": [
      "BACK"
    ],
    "primary_muscle": "Back",
    "equipment": "Bodyweight",
    "movement_pattern": "Vertical Pull",
    "laterality": "BILATERAL",
    "raw_equipment": "BODY",
    "raw_movement_pattern": "VERTICAL_PULL"
  },
  {
    "exercise_id": "OVERHEADPRESS_BARBELL",
    "name": "Overhead Press - Barbell",
    "muscle_groups": [
      "SHOULDERS"
    ],
    "primary_muscle": "Shoulders",
    "equipment": "Barbell",
    "movement_pattern": "Vertical Press",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "VERTICAL_PRESS"
  },
  {
    "exercise_id": "OVERHEADSQUAT_BARBELL",
    "name": "Overhead Squat - Barbell",
    "muscle_groups": [
      "SHOULDERS"
    ],
    "primary_muscle": "Shoulders",
    "equipment": "Barbell",
    "movement_pattern": "Squat",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "SQUAT"
  },
  {
    "exercise_id": "POWERCLEAN_BARBELL",
    "name": "Power Clean - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "POWERSNATCH_BARBELL",
    "name": "Power Snatch - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "PUSHJERK_BARBELL",
    "name": "Push Jerk - Barbell",
    "muscle_groups": [
      "SHOULDERS"
    ],
    "primary_muscle": "Shoulders",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "PUSHPRESS_BARBELL",
    "name": "Push Press - Barbell",
    "muscle_groups": [
      "SHOULDERS"
    ],
    "primary_muscle": "Shoulders",
    "equipment": "Barbell",
    "movement_pattern": "Vertical Press",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "VERTICAL_PRESS"
  },
  {
    "exercise_id": "PUSHUP_CLASSIC",
    "name": "Push Up",
    "muscle_groups": [
      "CHEST"
    ],
    "primary_muscle": "Chest",
    "equipment": "Bodyweight",
    "movement_pattern": "Horizontal Press",
    "laterality": "BILATERAL",
    "raw_equipment": "BODY",
    "raw_movement_pattern": "HORIZONTAL_PRESS"
  },
  {
    "exercise_id": "RING_MUSCLE-UPS",
    "name": "Ring Muscle-Ups",
    "muscle_groups": [
      "FULL_BODY"
    ],
    "primary_muscle": "Full Body",
    "equipment": "Other",
    "movement_pattern": "Vertical Pull",
    "laterality": "BILATERAL",
    "raw_equipment": "OTHER",
    "raw_movement_pattern": "VERTICAL_PULL"
  },
  {
    "exercise_id": "ROMANIANDEADLIFT_BARBELL",
    "name": "Romanian Deadlift - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Hinge",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "HINGE"
  },
  {
    "exercise_id": "SNATCH_BARBELL",
    "name": "Snatch - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "SPLITJERK_BARBELL",
    "name": "Split Jerk - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Olympic Lift",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "OLY_LIFT"
  },
  {
    "exercise_id": "SUMODEADLIFT_BARBELL",
    "name": "Deadlift - Sumo - Barbell",
    "muscle_groups": [
      "LEGS"
    ],
    "primary_muscle": "Legs",
    "equipment": "Barbell",
    "movement_pattern": "Hinge",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "HINGE"
  },
  {
    "exercise_id": "THRUSTER_BARBELL",
    "name": "Thruster - Barbell",
    "muscle_groups": [
      "SHOULDERS"
    ],
    "primary_muscle": "Shoulders",
    "equipment": "Barbell",
    "movement_pattern": "Squat",
    "laterality": "BILATERAL",
    "raw_equipment": "BARBELL",
    "raw_movement_pattern": "SQUAT"
  },
  {
    "exercise_id": "TRICEPDIP_DIPBAR",
    "name": "Dip",
    "muscle_groups": [
      "ARMS"
    ],
    "primary_muscle": "Arms",
    "equipment": "Bodyweight",
    "movement_pattern": "Vertical Press",
    "laterality": "BILATERAL",
    "raw_equipment": "BODY",
    "raw_movement_pattern": "VERTICAL_PRESS"
  }
];

const BY_ID = new Map<string, WhoopExercise>(EXERCISES.map((e) => [e.exercise_id, e]));

/** Full WHOOP metadata for a mapped exercise id, or undefined if unbundled. */
export function getWhoopExercise(exerciseId: string): WhoopExercise | undefined {
  return BY_ID.get(exerciseId);
}
