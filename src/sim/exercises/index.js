// Registry of examination elements. Each module provides:
//   buildStation(stationDef, dims) -> geometry (markings, posts, boundary lines, zones)
//   Evaluator class                -> detects engagement, mistakes and completion from vehicle state
//   createCoach(env)               -> contextual instructions / actions for Training Mode & tests
import * as parallel from './parallel.js';
import * as zigzag from './zigzag.js';
import * as turn from './turn.js';
import * as garage from './garage.js';
import * as figure8 from './figure8.js';
import * as hill from './hill.js';

export const EXERCISES = {
  parallel: { number: 1, module: parallel, Evaluator: parallel.ParallelEvaluator },
  zigzag: { number: 2, module: zigzag, Evaluator: zigzag.ZigzagEvaluator },
  turn: { number: 3, module: turn, Evaluator: turn.TurnEvaluator },
  garage: { number: 4, module: garage, Evaluator: garage.GarageEvaluator },
  figure8: { number: 5, module: figure8, Evaluator: figure8.Figure8Evaluator },
  hill: { number: 6, module: hill, Evaluator: hill.HillEvaluator },
};
