// Centralised examination rules & scoring.
//
// SOURCES (see README "Scoring sources"):
//  [S1] drv.ge FAQ, martiviteoria.ge, imedinews.ge — citing MIA Order No. 598 (Art. 34, 36, 37):
//       B-category Stage 1 = 6 elements, candidate starts with 100 points, the exam is passed if the
//       candidate accumulates NO MORE THAN 39 penalty points; up to 2 minutes per element.
//  [S2] crystalauto.ge "ყველაფერი, რაც მართვის მოწმობის გამოცდის შესახებ უნდა ვიცოდეთ" — per-element
//       requirement list with penalty points (Georgian text quoted in `ka`). This is a driving-school
//       reproduction of the official annex; the official legal text could not be retrieved, so every
//       value is kept here to be corrected if needed.
//       The source calls the course poles "სადგარი"; the texts below say "ჯოხი" (pole), the word
//       the simulator uses everywhere else.
//  `official: false` marks rules added by this simulator (not found in any source). They are
//  enabled with small penalties by default and can be switched off with `enabled: false`.
//
// Special values for `points`:
//   'DQ'   -> disqualification: exam FAILS immediately (exam mode) regardless of score.
//   'FAIL' -> the element counts as failed (not performed) -> also an exam fail.

export const examRules = {
  startPoints: 100,
  maxPenaltyPoints: 39,           // [S1] pass if accumulated penalties <= 39
  elementTimeLimitSec: 120,       // [S1] "up to 2 minutes per element"
  overtimeResult: 'FAIL',
  // Each rule is applied at most once per element attempt (prevents one long line-contact
  // from costing 15 points 60 times per second). Set `repeatable: true` on a rule to change.
  defaultRepeatable: false,
  // Exam mode: stop the exam at the first DQ/FAIL (true, like the real exam) or continue.
  endExamOnDisqualification: true,
  // Minimum standstill (s) that counts as "stopped" for the no-stopping rules.
  stopDetectSeconds: 1.0,
  stopSpeedThreshold: 0.05,       // m/s
  reverseDistanceTolerance: 0.30, // m of backward travel tolerated before "reversing" is recorded
  rollTolerance: 0.30,            // m (garage "must not roll more than 30 cm" [S2])

  elements: {
    parallel: {
      nameKa: 'პარალელური პარკირება', nameEn: 'Parallel parking',
      rules: {
        stopLineCrossed: { points: 10, official: true, note: '[S2] lists the requirement but the source omits the value — 10 assumed',
          ka: 'ელემენტის წინ გაჩერებისას ავტომობილმა არ უნდა გადაკვეთოს „სდექ–ხაზი"', en: 'Crossed the stop line when stopping before the element' },
        markingOrPostInZone: { points: 10, official: true,
          ka: 'შემოსაზღვრულ უბანზე მოძრაობისას ავტომობილმა არ უნდა გადაკვეთოს მონიშვნები და არ უნდა დაეჯახოს ჯოხებს', en: 'Crossed a marking / hit a post or kerb while manoeuvring in the zone' },
        markingOrPostOnExit: { points: 15, official: true,
          ka: 'ელემენტიდან გამოსვლისას ავტომობილმა არ უნდა გადაკვეთოს მონიშვნები და არ უნდა დაეჯახოს ჯოხებს', en: 'Crossed a marking / hit a post while leaving the element' },
        notFullyInside: { points: 20, official: true,
          ka: 'გაჩერების შემდეგ ავტომობილი მთლიანად უნდა მოექცეს შემოსაზღვრულ უბანზე და არ კვეთავდეს მონიშვნის ხაზებს', en: 'Final position not entirely inside the parking space' },
        noParkingBrake: { points: 15, official: true,
          ka: 'შემოსაზღვრულ უბანზე გაჩერების შემდეგ სავალდებულოა სადგომი მუხრუჭის გამოყენება', en: 'Parking brake not applied after stopping in the space' },
        noIndicatorOnExit: { points: 5, official: false, enabled: true,
          ka: 'ადგილიდან გასვლისას არ ჩაირთო მარცხენა მოხვევის მაჩვენებელი', en: 'Left indicator not used when pulling out of the space (simulator rule)' },
        excessiveCorrections: { points: 5, official: false, enabled: false, maxDirectionChanges: 4,
          ka: 'ზედმეტად ბევრი წინ-უკან გასწორება', en: 'Too many forward/reverse corrections (simulator rule, disabled by default)' },
      },
    },
    zigzag: {
      nameKa: 'ზიგზაგი', nameEn: 'Zigzag (slalom)',
      rules: {
        wrongStart: { points: 15, official: true,
          ka: 'ელემენტის შესრულება უნდა დაიწყოს შუაში მდებარე პირველი ჯოხის მარცხენა მხრიდან შემოვლით', en: 'Did not pass the first centre post on its left side' },
        notBetweenPosts: { points: 15, official: true,
          ka: 'ელემენტის შესრულებისას ავტომობილმა უნდა იმოძრაოს შუაში განლაგებულ ჯოხებს შორის', en: 'Did not weave between the centre posts' },
        markingOrPost: { points: 15, official: true,
          ka: 'არ უნდა გადაკვეთოს მონიშვნები და არ უნდა დაეჯახოს ჯოხებს', en: 'Crossed a boundary marking / hit a post' },
        stopped: { points: 10, official: true,
          ka: '„ზიგზაგში" მოძრაობის განმავლობაში არ უნდა შეწყდეს მოძრაობა დასახული მიმართულებით', en: 'Stopped during the zigzag' },
        engineOff: { points: 15, official: true, ka: 'არ უნდა გაითიშოს ძრავი', en: 'Engine switched off / stalled' },
        reversed: { points: 10, official: true, ka: 'ელემენტის შესრულებისას აკრძალულია უკუსვლით მოძრაობა', en: 'Reversed during the zigzag' },
      },
    },
    turn: {
      nameKa: 'შეზღუდული სიგანის შემოსაბრუნებელი უბანი (ჩიხი)', nameEn: 'Limited-width turn (dead end)',
      rules: {
        wrongStart: { points: 15, official: true,
          ka: 'ელემენტის შესრულება უნდა დაიწყოს მარჯვენა მხრიდან („სდექ–ხაზიდან")', en: 'Did not start from the right side (stop line)' },
        tooManyGearChanges: { points: 15, official: true,
          ka: 'წინ და უკან მოძრაობა უნდა განხორციელდეს გადაცემის ერთჯერადი გადართვით', en: 'More than one reverse manoeuvre (gear change)' },
        markingOrPost: { points: 20, official: true,
          ka: 'ელემენტის შესრულებისას ავტომობილმა არ უნდა გადაკვეთოს მონიშვნები და არ უნდა დაეჯახოს ჯოხებს', en: 'Crossed a marking / hit a post' },
        leftZone: { points: 'DQ', official: true,
          ka: 'შემოსაზღვრულ უბანზე მობრუნებისას ავტომობილი მთლიანად უნდა მოექცეს შემოსაზღვრულ უბანზე', en: 'Vehicle left the marked zone during the turn' },
        wrongExit: { points: 'DQ', official: true,
          ka: 'ავტომობილი უნდა გამოვიდეს მარცხენა მხრიდან ანუ შესასვლელის საწინააღმდეგო მხრიდან', en: 'Did not exit on the left side (opposite to the entry)' },
        notTurned: { points: 'FAIL', official: false, ka: 'ჩიხიდან გამოვიდა შემობრუნების გარეშე', en: 'Left the dead end without turning around' },
      },
    },
    garage: {
      nameKa: 'უკუსვლით პარკირება (გარაჟი)', nameEn: 'Reverse parking (garage)',
      rules: {
        rolled: { points: 10, official: true, ka: 'ავტომობილი არ უნდა დაგორდეს 30 სმ–ზე მეტ მანძილზე', en: 'Vehicle rolled more than 30 cm (against the selected direction)' },
        multipleReverse: { points: 15, official: true, ka: 'შესვლა უნდა განხორციელდეს უკუსვლის გადაცემის ერთჯერადი ჩართვით', en: 'Reverse gear engaged more than once (correction)' },
        notFullyInside: { points: 15, official: true,
          ka: 'გაჩერების შემდეგ ავტომობილი მთლიანად უნდა მოთავსდეს შემოსაზღვრულ უბანზე და არ უნდა კვეთავდეს მონიშვნის ხაზებს', en: 'Final position not entirely inside the box' },
        markingOrPost: { points: 20, official: true,
          ka: 'ელემენტის შესრულებისას ავტომობილმა არ უნდა გადაკვეთოს მონიშვნები და არ უნდა დაეჯახოს ჯოხებს', en: 'Crossed a marking / hit a post or kerb' },
        noIndicatorOnExit: { points: 5, official: false, enabled: true, ka: 'გარაჟიდან გასვლისას არ ჩაირთო მოხვევის მაჩვენებელი', en: 'Indicator not used when pulling out of the box (simulator rule)' },
      },
    },
    figure8: {
      nameKa: 'რვიანი', nameEn: 'Figure eight',
      rules: {
        wrongStart: { points: 15, official: true, ka: 'მოძრაობა უნდა დაიწყოთ შემოსაზღვრული უბნის მარჯვენა მხრიდან', en: 'Did not start from the right side of the zone' },
        wrongExit: { points: 15, official: true, ka: 'მოძრაობა უნდა დასრულდეს შემოსაზღვრული უბნის მარცხენა მხრიდან გამოსვლით', en: 'Did not exit on the left side of the zone' },
        stopped: { points: 5, official: true, ka: 'მოძრაობა არ უნდა შეწყდეს ელემენტის შესრულების განმავლობაში', en: 'Stopped during the figure eight' },
        engineOff: { points: 15, official: true, ka: 'ძრავი არ უნდა გაითიშოს', en: 'Engine switched off' },
        markingOrPost: { points: 15, official: true, ka: 'არ უნდა გადაკვეთოს მონიშვნები და არ უნდა დაეჯახოს ჯოხებს', en: 'Wheel crossed a figure-eight line' },
        reversed: { points: 15, official: true, ka: 'ელემენტის შესრულებისას აკრძალულია უკუსვლა', en: 'Reversed during the figure eight' },
        wrongRoute: { points: 'FAIL', official: true, ka: 'ავტომობილმა უნდა იმოძრაოს დადგენილი ტრაექტორიით', en: 'Wrong direction / did not complete both loops' },
      },
    },
    hill: {
      nameKa: 'აღმართი', nameEn: 'Hill start',
      rules: {
        badStop: { points: 20, official: true,
          ka: 'ავტომობილი უნდა გაჩერდეს „სდექ-ხაზამდე" არანაკლებ ერთი მეტრის დაშორებით', en: 'Did not stop at least 1 m before the stop line (or crossed it)' },
        rollback: { points: 10, official: true,
          ka: '„სდექ-ხაზიდან" დაძვრისას ავტომობილი არ უნდა დაგორდეს უკან 20 სმ-ზე მეტი მანძილით', en: 'Rolled back more than 20 cm when moving off' },
        severeRollback: { points: 'FAIL', official: false, ka: 'უკან დაგორდა 1 მ-ზე მეტით (მანქანაზე კონტროლი დაიკარგა)', en: 'Rolled back more than 1 m (lost control of the vehicle)' },
      },
      rollbackLimit: 0.20,        // m [S2]
      severeRollbackLimit: 1.0,   // m (simulator assumption)
      // Literal reading of [S2]: stop "not less than one metre" before the line. The car must also
      // be completely on the incline for the stop to count. Both bounds configurable.
      stopMinDistance: 1.0,
      stopMaxDistance: null,      // null = anywhere on the incline
    },
  },

  // Rules outside the elements (all simulator rules — not in the sources)
  general: {
    collision: { points: 5, official: false, enabled: true, ka: 'შეჯახება დაბრკოლებასთან ან ბორდიურთან ელემენტის გარეთ', en: 'Contact with an obstacle / kerb outside an element' },
    wrongDirection: { points: 10, official: false, enabled: true, ka: 'მოძრაობა მოედნის მიმართულების საწინააღმდეგოდ', en: 'Drove against the course direction' },
    skippedElement: { points: 'FAIL', official: true, ka: 'ელემენტი გამოტოვებულია / არ შესრულებულა', en: 'Element skipped / not performed' },
    noIndicatorMoveOff: { points: 5, official: false, enabled: true, ka: 'სტარტიდან დაძვრისას არ ჩაირთო მარცხენა მოხვევის მაჩვენებელი', en: 'Left indicator not used when moving off from the start' },
  },
};

export function isFatal(points) { return points === 'DQ' || points === 'FAIL'; }
