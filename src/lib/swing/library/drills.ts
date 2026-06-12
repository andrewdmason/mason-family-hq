// Curated youth (7–12) hitting issue library: diagnosis language, cues, drills,
// and naked-eye tells. The assessment prompt instructs the LLM to prescribe
// FROM THIS LIBRARY (or flag library_gap when nothing fits) so prescriptions
// stay consistent and reviewable — per-call LLM improvisation is exactly what
// the plan rules out (R5 consistency; eye-test quality gate).
//
// Seeded with LLM assistance; curated by Andrew in PR review like any other
// code. Versioned implicitly by git — assessments store prompt_version so
// output drift stays attributable.
//
// Tell templates are the product's differentiator: each must be judgeable by
// a dad-coach's naked eye on any rep, with no device running (F3).

import type { Drill, MetricKey } from "@/lib/swing/types";

export interface LibraryEntry {
  /** Stable issue key — referenced by focus areas and parked issues. */
  key: string;
  label: string;
  /** Metric findings that point at this issue (drives candidate selection). */
  addressesMetrics: MetricKey[];
  /** Plain-language diagnosis the coach reads (R5a). */
  diagnosis: string;
  /** Kid-appropriate cues — short, sayable between reps (R5b). */
  cues: string[];
  /** 1–2 drills with simple steps and minimal equipment (R5b). */
  drills: Drill[];
  /** The naked-eye tell: how the coach judges right/wrong on any rep (R5c). */
  tell: string;
}

export const PROMPT_VERSION = "v1";

export const DRILL_LIBRARY: LibraryEntry[] = [
  {
    key: "head_movement",
    label: "Head pulls off the ball",
    addressesMetrics: ["head_drift"],
    diagnosis:
      "His head travels during the swing instead of staying still, so his eyes lose the ball right when he needs them most. This is the most common reason young hitters swing and miss at pitches they should hit.",
    cues: ["Keep your nose on the ball", "Quiet head — watch the bat hit it"],
    drills: [
      {
        name: "Tee freeze finish",
        steps: [
          "Hit off the tee, then freeze the finish for two full seconds",
          "His chin should end up near his back shoulder, eyes still on the tee",
          "Five reps; only count the ones where the freeze holds",
        ],
        equipment: "Tee",
      },
      {
        name: "Coin watch",
        steps: [
          "Put a coin (or a number written on the ball) on the tee under the ball",
          "After contact he calls out what he saw",
          "If he can't say, his eyes left early",
        ],
        equipment: "Tee, coin",
      },
    ],
    tell:
      "Watch his chin: if it ends up past his front shoulder at contact, he pulled his head. Good reps finish with the chin rotating back toward the rear shoulder, eyes down at contact.",
  },
  {
    key: "overstriding",
    label: "Stride too long",
    addressesMetrics: ["stride_length_ratio"],
    diagnosis:
      "His stride is so long that his legs slide out from under him — he loses his base, his head drops, and there's no strength left at contact.",
    cues: ["Short step, soft landing", "Step on the bug, don't jump on it"],
    drills: [
      {
        name: "Stride stick",
        steps: [
          "Lay the bat on the ground one of HIS foot-lengths in front of his stride foot",
          "Stride must land short of the bat",
          "Tee work: five swings, stride checked each rep",
        ],
        equipment: "Tee, spare bat",
      },
      {
        name: "No-stride swings",
        steps: [
          "Start with the stride foot already where it would land, slightly open",
          "Swing from there — all turn, no step",
          "Mix in regular swings once the short stride sticks",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "Lay a bat one foot-length ahead of his stride foot at setup. If his front foot lands at or past it, the stride is too long. You can also see it without the bat: a long stride makes his head visibly drop as the feet spread.",
  },
  {
    key: "losing_posture",
    label: "Stands up out of his swing",
    addressesMetrics: ["posture_loss", "spine_angle_contact"],
    diagnosis:
      "He sets up in a good athletic posture but straightens up as he swings, pulling his eyes up and away and dragging the barrel out of the hitting zone.",
    cues: ["Stay in your legs", "Swing under your hat brim"],
    drills: [
      {
        name: "Low-tee posture reps",
        steps: [
          "Set the tee knee-high",
          "He has to stay bent to reach it — standing up means a miss or a top",
          "Five quality reps staying level",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "Watch the top of his head against a background object (fence rail, cage pipe). If it rises between stride and contact, he stood up. A good rep keeps the hat level from launch through contact.",
  },
  {
    key: "soft_front_side",
    label: "Front leg never firms up",
    addressesMetrics: ["front_knee_angle_contact", "weight_transfer"],
    diagnosis:
      "His front knee is still bent and giving at contact, so all the energy his legs create leaks forward instead of launching the bat. Strong hitters hit against a firm front leg.",
    cues: ["Land soft, then lock it", "Hit against a wall, not over it"],
    drills: [
      {
        name: "Stride-and-stick",
        steps: [
          "Stride and stop — no swing — front leg firms up straight",
          "Hold two seconds, balanced",
          "Then add the swing: stride, stick, swing",
        ],
      },
      {
        name: "Front-foot-up finish check",
        steps: [
          "Regular tee swings, but he must finish with all his weight on a straight front leg",
          "Back foot finishes light enough to lift the toe",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "At contact, his front leg should look like a straight post. If the knee is still bent — or still drifting toward the pitcher — the front side never firmed up.",
  },
  {
    key: "lunging",
    label: "Lunges at the ball",
    addressesMetrics: ["weight_transfer", "head_drift", "swing_duration"],
    diagnosis:
      "His whole body drifts toward the pitcher before the swing starts, so he's reaching at the ball off his front foot instead of turning behind it. Off-speed pitches will eat him alive.",
    cues: ["Stay back, let it travel", "Load on your back pocket and wait"],
    drills: [
      {
        name: "Load-and-hold",
        steps: [
          "Coach says 'load' — he coils onto the back side and HOLDS",
          "Coach waits a beat, then says 'swing'",
          "The pause kills the drift; five reps",
        ],
        equipment: "Tee",
      },
      {
        name: "Back-knee wall",
        steps: [
          "Tee work with his back foot a few inches from the cage net or a cone behind him",
          "If he drifts, he feels it immediately",
        ],
        equipment: "Tee, cone",
      },
    ],
    tell:
      "Pick a fence post directly behind his head at setup. If his head slides well off that post toward the pitcher before his swing starts, he lunged. A good rep keeps the head over the back half until the turn begins.",
  },
  {
    key: "flying_open",
    label: "Front shoulder flies open",
    addressesMetrics: ["hip_shoulder_timing", "head_drift"],
    diagnosis:
      "His front shoulder yanks out toward third base (for a righty) as he starts the swing, pulling the barrel off the ball's path. He'll pull weak grounders and miss everything away.",
    cues: ["Show the pitcher your back pocket a beat longer", "Throw your hands at the second baseman"],
    drills: [
      {
        name: "Outside-tee focus",
        steps: [
          "Set the tee on the outside edge, slightly deep",
          "He has to stay closed to drive it the other way",
          "Reward hard contact to the opposite field",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "Watch his front shoulder and chin at launch: if the shoulder jerks toward the pull side and his chin chases it before contact, he flew open. On a good rep the shoulder stays pointed at the pitcher until the hips have already started turning.",
  },
  {
    key: "no_load",
    label: "No load — swing starts from zero",
    addressesMetrics: ["load_duration", "hip_shoulder_timing"],
    diagnosis:
      "He never gathers backward before going forward — the swing starts flat-footed from a standstill, so there's no rhythm and no power. Every strong swing starts with a small move back.",
    cues: ["Get your hands back before you go forward", "Wind the toy up before you let it go"],
    drills: [
      {
        name: "Rhythm count",
        steps: [
          "Coach counts 'one' (load), 'two' (stride), 'three' (swing) — exaggerated and slow at first",
          "Speed the count up over ten reps until the load is automatic",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "Before his stride foot lifts, you should see his hands and front shoulder make a small move back toward the catcher. If the first move you see is forward, there was no load.",
  },
  {
    key: "rushed_tempo",
    label: "Everything happens at once",
    addressesMetrics: ["stride_duration", "load_duration", "swing_duration"],
    diagnosis:
      "Load, stride, and swing all fire in one panicked burst instead of in sequence. There's no separation, so timing is guesswork and adjustment mid-pitch is impossible.",
    cues: ["Slow early, fast late", "Glide, then explode"],
    drills: [
      {
        name: "Slow-motion shadow swings",
        steps: [
          "Five shadow swings at half speed with full sequence: load … stride … then explode the turn",
          "Then three tee swings keeping the same early patience",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "Watch for a beat of stillness between his front foot landing and the swing firing. If the foot lands and the bat is already gone — same instant — he rushed. Good reps look like step … then swing, two distinct beats.",
  },
  {
    key: "early_back_foot_spin",
    label: "Back foot spins before the stride lands",
    addressesMetrics: ["weight_transfer", "hip_shoulder_timing"],
    diagnosis:
      "He spins his back heel up and starts his turn before his front foot is even down, so he's rotating on air — nothing for the swing to push against.",
    cues: ["Land first, then turn", "Step, THEN squish the bug"],
    drills: [
      {
        name: "Stride-to-balance",
        steps: [
          "Stride and freeze with the front foot down, back heel still low",
          "Coach checks the freeze, then calls 'turn'",
          "Five reps separating landing from turning",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "Watch his back heel: it should still be low when his front foot lands. If the heel is already up and spinning while the stride foot is in the air, he's turning too early.",
  },
  {
    key: "bat_drag",
    label: "Back elbow drags the barrel",
    addressesMetrics: ["back_elbow_slot", "swing_duration"],
    diagnosis:
      "His back elbow shoots forward ahead of his hands, dragging the barrel flat and late through the zone. The swing looks long and the barrel arrives after the ball.",
    cues: ["Knob to the ball, then turn the barrel", "Elbow slots to your side, not past it"],
    drills: [
      {
        name: "Elbow-slot pause",
        steps: [
          "Shadow swing to the slot position: back elbow tucked at his side, hands still back",
          "Pause there, coach checks, then finish the swing",
          "Three slow, three full speed",
        ],
      },
    ],
    tell:
      "From the side, at launch his back elbow should tuck down to his rib cage while the hands stay back. If the elbow leads so far that the bat head points back at the catcher flat and late, the barrel is dragging.",
  },
  {
    key: "non_athletic_setup",
    label: "Setup isn't athletic",
    addressesMetrics: ["spine_angle_stance"],
    diagnosis:
      "He starts standing tall with straight knees, so every good thing that could happen in the swing has to happen after an extra move down into his legs — and usually doesn't.",
    cues: ["Stand like a shortstop, ready for a grounder", "Knees over your shoelaces"],
    drills: [
      {
        name: "Jump-in setup",
        steps: [
          "Small two-foot hop into the stance — landing a hop puts anyone in an athletic position",
          "Freeze, coach checks knees and hips, then swing",
        ],
        equipment: "Tee",
      },
    ],
    tell:
      "At setup his knees should be visibly bent with his chest slightly over his toes. If his legs look like fence posts before the pitch, the setup isn't athletic.",
  },
];

export function libraryEntry(key: string): LibraryEntry | undefined {
  return DRILL_LIBRARY.find((entry) => entry.key === key);
}

/** Entries whose addressed metrics intersect the flagged metric keys. */
export function entriesForMetrics(flagged: MetricKey[]): LibraryEntry[] {
  const set = new Set(flagged);
  return DRILL_LIBRARY.filter((entry) =>
    entry.addressesMetrics.some((m) => set.has(m))
  );
}
