// Rustavi (რუსთავის მოედანი) — B-category Stage 1 practical examination ground.
//
// Source: emsi.ge "რუსთავის პრაქტიკული მოედნის თანმიმდევრობა" PDF (single A4 page raster, 2025).
// All coordinates below are traced from the PDF rendered at 100 dpi (827 x 1170 px page) and
// are kept in "map pixels" so they can be checked against docs/rustavi-map.png directly.
// x = right (east), y = down (south). North is the top of the page.
//
// The PDF is a schematic without a scale bar. The scale was calibrated so that the hatched garage
// pockets measure ~3.0 x 5.9 m (see README "Scale calibration"); with it, roads come out 7.3–9.6 m
// wide, the figure-eight lane 3.55 m, and zigzag posts 8 m apart — all realistic values.
// Change METERS_PER_PX to rescale the entire ground consistently.

export const METERS_PER_PX = 2 / 15;       // 7.5 px per metre at 100 dpi
const S = METERS_PER_PX;
export const px = (x, y) => ({ x: x * S, z: y * S });
export const m2px = (m) => m / S;

// Element dimensions (metres). Values marked (map) are measured from the PDF at the scale above,
// values marked (std) are realistic defaults where the map carries no usable information.
export const COURSE_DIMS = {
  LINE_WIDTH: 0.12,
  POST_RADIUS: 0.055,            // (std) examination posts ("სადგარები"): striped poles
  POST_HEIGHT: 1.0,
  KERB_HEIGHT: 0.15,

  PARALLEL_SPACE_LENGTH: 8.0,    // (map) 7.9–8.1 m for bays 2 and 3
  PARALLEL_SPACE_WIDTH: 3.0,     // (map) 3.0–3.2 m
  PARALLEL_FRONT_ZONE: 6.0,      // (map) solid-edged zone between the space and the stop line (6.0–6.3 m)
  PARALLEL_STOPLINE_LENGTH: 6.7, // (map) comb stop line length from the kerb

  GARAGE_WIDTH: 3.0,             // (map) pockets measure 2.5–3.5 m; normalised
  GARAGE_LENGTH: 5.9,            // (map) 5.9–6.1 m

  ZIGZAG_WIDTH: 9.8,             // (map) corridor between outer lines
  ZIGZAG_FIRST_POST: 8.0,        // (map) 8.4 m / 8.0 m from the stop line
  ZIGZAG_POST_SPACING: 8.0,      // (map) ticks at ~8 m intervals
  ZIGZAG_POSTS: 4,
  ZIGZAG_LENGTH: 39.6,           // (map) stop line -> end of the lower lane

  TURN_WIDTH: 9.2,               // (map) upper lanes 8.8–9.6 m wide
  TURN_DEPTH: 8.2,               // (map + satellite) lines reach the page edge 8.15 m past the stop line;
                                 // the satellite image gives ~7.8 m (±0.5) — the boxes are almost square
  TURN_POSTS_A: [0.3, 3.8, 6.2], // (map, 300 dpi PDF) side posts past the stop line; a corner post closes each side
  TURN_POST_SPACING: 2.0,        // (std) posts across the far end
  TURN_POST_OFFSET: 0.25,        // posts stand just outside the boundary line

  FIG8_R_INNER: 3.7,             // (map) painted inner circles
  FIG8_R_OUTER: 7.25,            // (map) 7.1–7.4 m outer boundary
  FIG8_POST_SPACING: 2.9,        // (annex 4) posts on the lines: 8 per inner circle, outer line ~23° apart

  HILL_GRADIENT: 0.16,           // (spec) >= 16 %
  HILL_INCLINE: 6.5,             // (std) length of the 16 % incline
  HILL_PLATEAU: 1.5,             // (std)
  HILL_DECLINE: 4.5,             // (std) steeper descent (23 %) — limited by the space before the corner
  HILL_STOPLINE_BEFORE_CREST: 0.5,
  HILL_LANE_WIDTH: 3.87,         // (map) channel between the lawn and the lane line
};

const D = COURSE_DIMS;
const NORTH = { x: 0, z: -1 }, SOUTH = { x: 0, z: 1 }, EAST = { x: 1, z: 0 }, WEST = { x: -1, z: 0 };

// ---------------------------------------------------------------------------------------------
// Element stations. Every station is defined by a local frame: origin `o` and travel direction
// `f` (the direction the candidate approaches in). Local coords: a = along f, b = to the right.
// ---------------------------------------------------------------------------------------------
const parallelBays = [
  { id: 1, comb: 898 }, { id: 2, comb: 1018 }, { id: 3, comb: 1137 },
].map((b) => ({ id: b.id, o: px(70, b.comb), f: SOUTH }));     // kerb line x=70; comb stop line

const garageBoxes = [
  { id: 1, o: px(306, 1091), f: EAST },
  { id: 2, o: px(413.5, 1091), f: EAST },
  { id: 3, o: px(537 - m2px(D.GARAGE_LENGTH), 729), f: NORTH },
  { id: 4, o: px(537 - m2px(D.GARAGE_LENGTH), 596), f: NORTH },
];

const zigzagLanes = [
  { id: 1, o: px(400, 437), f: NORTH, length: 39.6 },
  { id: 2, o: px(478, 445), f: NORTH, length: 40.0 },
];

// The two dead ends share ONE row of poles, in the middle of the 0.67 m strip between them.
const turnLanes = [
  { id: 1, o: px(410, 62), f: NORTH, rightOffset: (484 - 410 - m2px(D.TURN_WIDTH)) / 2 * S },
  { id: 2, o: px(484, 64), f: NORTH, leftPosts: false },
];

const figure8 = {
  top: px(290, 239),
  bottom: px(261.25, 325),
  // Opening in the outer line of the top loop (page angles, atan2(dy, dx) in degrees).
  openingFrom: -105.8, openingTo: -38.8,
  topDirection: 'ccw',     // arrows: top loop anticlockwise (as seen on the map)
  bottomDirection: 'cw',   // bottom loop clockwise
};

const hill = { id: 1, o: px(176, 61.5), f: WEST };   // stop line ("stub" line in the PDF), westbound

// ---------------------------------------------------------------------------------------------
// Lawns (raised kerbed green areas). Polygons in map px; garage notches generated from stations.
// ---------------------------------------------------------------------------------------------
const gw = m2px(D.GARAGE_WIDTH) / 2, gl = m2px(D.GARAGE_LENGTH);
const lawnsPx = [
  // West strip + north-west block
  [[42, -45], [303, -45], [303, 46], [100, 46], [89, 49], [82, 56], [80, 70], [78, 300], [74, 600], [70, 760], [70, 1169], [42, 1169]],
  // C-shaped island around the figure eight
  [[133, 97], [231, 97], [243, 110], [247, 124], [242, 140], [230, 152], [177, 152], [177, 392], [344, 410], [352, 418], [355, 440], [350, 460], [340, 468], [133, 463]],
  // East strip, north part (ends at the east gate)
  [[516, -45], [537, -45], [537, 276], [526, 276], [518, 270], [516, 260]],
  // East strip, middle (down to garage 4)
  [[520, 313], [537, 313], [537, 596 - gw], [493, 596 - gw], [497, 573], [505, 563], [510, 480], [513, 400], [515, 335]],
  // Block between garages 4 and 3
  [[493, 596 + gw], [537, 596 + gw], [537, 729 - gw], [493, 729 - gw]],
  // East strip south of garage 3 + south strip with garages 1 and 2
  [[493, 729 + gw], [537, 729 + gw], [537, 1169], [232, 1169], [232, 1141], [278, 1141], [278, 1091],
   [306 - gw, 1091], [306 - gw, 1091 + gl], [306 + gw, 1091 + gl], [306 + gw, 1091],
   [413.5 - gw, 1091], [413.5 - gw, 1091 + gl], [413.5 + gw, 1091 + gl], [413.5 + gw, 1091],
   [506, 1091], [506, 1007], [491, 1000]],
  // Small south-west island
  [[118, 1143], [122, 1139], [206, 1139], [206, 1169], [118, 1169]],
];

// Stadium enclosure (fenced, not drivable). Inner details only for rendering.
const stadiumPx = [[130, 521], [384, 527], [410, 540], [430, 558], [438, 575], [436, 1005], [428, 1019], [132, 1019]];
const stadiumDetailsPx = {
  building: [[176, 525], [220, 529], [228, 548], [360, 551], [355, 625], [186, 628]],
  pitch: [[197, 645], [378, 648], [376, 987], [194, 983]],
  court: [[247, 733], [328, 733], [328, 900], [248, 898]],
  stand: [[163, 731], [208, 731], [208, 898], [165, 898]],
};

// Ground perimeter (fence) and gates
const boundaryPx = [[42, -45], [538, -45], [538, 1169], [42, 1169]];
const gatesPx = [
  { a: [538, 276], b: [538, 313], label: 'აღმოსავლეთის ჭიშკარი' },
  { a: [70, 1169], b: [118, 1169], label: 'სამხრეთ-დასავლეთის გასასვლელი' },
  { a: [206, 1169], b: [232, 1169], label: 'სამხრეთის გასასვლელი' },
];

// ---------------------------------------------------------------------------------------------
// Painted markings that are not generated by the element modules (map px).
// ---------------------------------------------------------------------------------------------
const markingsPx = {
  solid: [
    // lane separator of the north-west loop (continues the left-road centre line into the curve)
    [[106, 140], [107, 115], [110, 100], [116, 88], [124, 80], [132, 77], [221, 76]],
    // "L" line north of the stadium
    [[188, 466], [190, 492], [332, 497]],
  ],
  dashed: [
    { pts: [[104, 142], [104, 470]], dash: 1.3, gap: 2.0 },                     // left road centre line
    { pts: [[120, 1059.5], [400, 1059.5]], dash: 0.8, gap: 0.55, width: 0.3 },  // bottom road (thick)
    { pts: [[462, 744], [462, 980]], dash: 1.0, gap: 1.3, color: 0xb9bcbc },    // right road (faint)
  ],
  zebras: [
    { x0: 140, x1: 175, y0: 465, y1: 512, stripes: 'x' },    // stripes along x (east-west traffic)
    { x0: 78, x1: 125, y0: 522, y1: 555, stripes: 'y' },     // stripes along y (north-south traffic)
  ],
  arrows: [
    { at: [90, 590], dir: SOUTH, len: 3.2 },
    { at: [90, 680], dir: SOUTH, len: 3.2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// Route: forward-driving legs between elements (map px). Used for training guidance chevrons,
// invisible progression checkpoints and the automated test driver.
// ---------------------------------------------------------------------------------------------
const route = {
  start: { p: [92, 400], heading: 90 },                // heading in degrees (page coords, 90 = south)
  legs: {
    toParallel: [[92, 400], [92, 520], [96, 600], [104, 660], [107, 720], [107, 800]],
    toGarage: [[108, 830], [108, 900], [107, 990], [111, 1030], [124, 1058], [150, 1070], [200, 1071], [260, 1071]],   // ends 1.8 m from the box entrance
    toZigzag: [[330, 1074], [420, 1074], [452, 1066], [470, 1045], [477, 1000], [477, 720], [476, 640], [470, 590], [450, 540], [428, 505], [419, 480], [419, 455]],
    toTurn: [[416, 190], [424, 150], [428, 110], [428, 80]],
    toFigure8: [[392, 70], [391, 90], [382, 103], [365, 110], [345, 118], [332, 135], [326, 147]],
    toHill: [[316, 170], [313, 150], [308, 125], [300, 100], [290, 82], [275, 68], [255, 62], [235, 61.5]],
    toFinish: [[134, 61.5], [124, 62.8], [113, 66.5], [105, 72], [99.5, 80], [96, 89], [94.5, 99], [93.5, 130], [92, 200], [92, 300]],
  },
  finish: { p: [92, 300], radius: 6 },
  // Restart Exercise positions: immediately before each element (map px, heading in degrees)
  restart: {
    parallel: { p: [104, 650], heading: 90 },
    garage: { p: [200, 1071], heading: 0 },
    zigzag: { p: [477, 700], heading: -90 },
    turn: { p: [428, 150], heading: -90 },
    figure8: { p: [350, 112], heading: 140 },
    hill: { p: [272, 61.5], heading: 180 },
  },
  // One-way sections (course direction arrows)
  oneWay: [
    { poly: [[70, 560], [130, 560], [130, 1010], [70, 1010]], dir: SOUTH, name: 'მარცხენა გზა' },
    { poly: [[436, 600], [493, 600], [493, 1000], [436, 1000]], dir: NORTH, name: 'მარჯვენა გზა' },
    { poly: [[124, 47], [221, 47], [221, 76], [124, 76]], dir: WEST, name: 'აღმართის ზოლი' },
  ],
};

// Information signs (element number + name) and a gradient warning sign.
const signsPx = [
  { at: [66, 770], face: NORTH, type: 'info', text: '1', sub: 'პარალელური პარკირება' },
  { at: [285, 1098], face: WEST, type: 'info', text: '2', sub: 'გარაჟი' },
  { at: [500, 880], face: SOUTH, type: 'info', text: '2', sub: 'გარაჟი' },
  { at: [519, 470], face: SOUTH, type: 'info', text: '3', sub: 'ზიგზაგი' },
  { at: [521, 100], face: SOUTH, type: 'info', text: '4', sub: 'ჩიხი' },
  { at: [236, 150], face: EAST, type: 'info', text: '5', sub: 'რვიანი' },
  { at: [262, 42], face: EAST, type: 'info', text: '6', sub: 'აღმართი' },
  { at: [244, 42], face: EAST, type: 'steep', text: '16%' },
];

// Deterministic tree positions on lawns (map px)
const treesPx = [
  [60, -30], [95, -20], [140, -34], [185, -12], [230, -30], [270, -8], [60, 20], [150, 22], [210, 18], [285, 25],
  [58, 120], [57, 260], [56, 420], [55, 600], [56, 720], [150, 200], [152, 300], [150, 420], [240, 440],
  [527, -20], [527, 60], [527, 160], [527, 240], [527, 360], [525, 460], [515, 650], [515, 690], [515, 800],
  [520, 900], [515, 980], [260, 1158], [340, 1155], [460, 1150], [500, 1120], [160, 1157], [55, 1150], [55, 1000], [55, 880],
];

// Scenery outside the fence: simple apartment blocks (x, y, w, d in px; height in m)
const outerBuildings = [
  { x: -120, y: 60, w: 70, d: 180, h: 15 }, { x: -120, y: 400, w: 70, d: 200, h: 27 }, { x: -110, y: 800, w: 60, d: 230, h: 15 },
  { x: 610, y: -30, w: 90, d: 160, h: 15 }, { x: 640, y: 360, w: 70, d: 240, h: 27 }, { x: 620, y: 820, w: 100, d: 150, h: 12 },
  { x: 120, y: -230, w: 260, d: 60, h: 15 }, { x: 150, y: 1260, w: 300, d: 70, h: 15 },
];

export const rustaviCourse = {
  id: 'rustavi',
  name: 'Rustavi',
  nameKa: 'რუსთავის მოედანი',
  source: 'emsi.ge — rustavi.pdf (Service Agency Rustavi examination ground)',
  metersPerPx: S,
  px,
  dims: COURSE_DIMS,
  boundary: boundaryPx.map(([x, y]) => px(x, y)),
  gates: gatesPx.map((g) => ({ a: px(...g.a), b: px(...g.b), label: g.label })),
  lawns: lawnsPx.map((poly) => poly.map(([x, y]) => px(x, y))),
  stadium: {
    fence: stadiumPx.map(([x, y]) => px(x, y)),
    details: Object.fromEntries(Object.entries(stadiumDetailsPx).map(([k, v]) => [k, v.map(([x, y]) => px(x, y))])),
    fenceHeight: 2.4,
  },
  markings: {
    solid: markingsPx.solid.map((l) => l.map(([x, y]) => px(x, y))),
    dashed: markingsPx.dashed.map((d) => ({ ...d, pts: d.pts.map(([x, y]) => px(x, y)) })),
    zebras: markingsPx.zebras.map((z) => ({ ...px(z.x0, z.y0), x1: z.x1 * S, z1: z.y1 * S, stripes: z.stripes })),
    arrows: markingsPx.arrows.map((a) => ({ at: px(...a.at), dir: a.dir, len: a.len })),
  },
  elements: {
    parallel: { stations: parallelBays },
    garage: { stations: garageBoxes },
    zigzag: { stations: zigzagLanes },
    turn: { stations: turnLanes },
    figure8: { stations: [{ id: 1, ...figure8 }] },
    hill: { stations: [hill] },
  },
  // Rustavi sequence (derived from the one-way arrows & the loop around the stadium; see README).
  sequence: ['parallel', 'garage', 'zigzag', 'turn', 'figure8', 'hill'],
  route: {
    start: { p: px(...route.start.p), heading: route.start.heading * Math.PI / 180 },
    legs: Object.fromEntries(Object.entries(route.legs).map(([k, v]) => [k, v.map(([x, y]) => px(x, y))])),
    finish: { p: px(...route.finish.p), radius: route.finish.radius },
    oneWay: route.oneWay.map((o) => ({ ...o, poly: o.poly.map(([x, y]) => px(x, y)) })),
  },
  // Which route leg leads to each element (training chevrons / autopilot)
  restart: Object.fromEntries(Object.entries(route.restart).map(([k, v]) => [k, { p: px(...v.p), heading: v.heading * Math.PI / 180 }])),
  legFor: { parallel: 'toParallel', garage: 'toGarage', zigzag: 'toZigzag', turn: 'toTurn', figure8: 'toFigure8', hill: 'toHill', finish: 'toFinish' },
  signs: signsPx.map((s) => ({ ...s, at: px(...s.at) })),
  trees: treesPx.map(([x, y]) => px(x, y)),
  outerBuildings: outerBuildings.map((b) => ({ ...px(b.x, b.y), w: b.w * S, d: b.d * S, h: b.h })),
};

export default rustaviCourse;
