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
  parallel: { module: parallel, Evaluator: parallel.ParallelEvaluator },
  zigzag: { module: zigzag, Evaluator: zigzag.ZigzagEvaluator },
  turn: { module: turn, Evaluator: turn.TurnEvaluator },
  garage: { module: garage, Evaluator: garage.GarageEvaluator },
  figure8: { module: figure8, Evaluator: figure8.Figure8Evaluator },
  hill: { module: hill, Evaluator: hill.HillEvaluator },
};
