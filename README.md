# moedanze

A 3D driving simulator of the Georgian B-category practical driving exam ground (მოედანი).
You sit in the driver's seat of an automatic car and drive the Rustavi exam ground with all six
exam elements, just like on the real exam.

- **Training** — step-by-step instructions, reference marks in the mirrors, an instructor who can
  drive for you, and checkpoints to retry any element.
- **Exam** — no help. You get a pass / fail result sheet at the end.

## The 6 elements

1. **Parallel parking** — stop before the stop line, reverse into the space, stop fully inside it,
   apply the parking brake, then drive out.
2. **Reverse parking (garage)** — reverse into the box in one go and stop fully inside it.
3. **Zigzag** — weave between the poles without stopping or reversing. Pass the first pole on its left.
4. **Dead end** — turn the car around inside the zone with only one reverse move, and leave on the
   opposite (left) side.
5. **Figure eight** — drive both loops without stopping, reversing or touching a line or pole.
   Enter on the right side of the opening, leave on the left side.
6. **Hill start** — stop on the 16 % incline at least 1 m before the stop line, then move off without
   rolling back.

## Controls

| Key | Action |
|---|---|
| W / ↑ | Accelerator |
| S / ↓ | Brake |
| A D / ← → | Steering |
| F R N P | Gear: drive, reverse, neutral, park |
| Q / E | Left / right indicator |
| Space | Parking brake |
| Mouse | Look around (right button: zoom in) |
| Esc | Pause: resume, restart, checkpoints, main menu |
| Backspace | Restart the current element |
| G | Instructor drives (training) |
| M | Minimap (training) |
| V | Outside view |

## Scoring

- You start with **100 points**. Each mistake costs points.
- You **pass** with at most **39 penalty points**.
- Some mistakes fail the exam at once: leaving the dead-end zone, leaving it on the wrong side,
  driving the figure eight the wrong way, rolling back more than 1 m on the hill, skipping an element,
  or taking more than **2 minutes** on one element.

| Element | Main mistakes (penalty points) |
|---|---|
| Parallel parking | crossing the stop line 10 · touching a line or pole 10 (15 when leaving) · not fully inside 20 · no parking brake 15 |
| Garage | rolling more than 30 cm 10 · reversing twice 15 · not fully inside 15 · touching a line or pole 20 |
| Zigzag | wrong side of the first pole 15 · not weaving 15 · touching a line or pole 15 · stopping 10 · reversing 10 |
| Dead end | not starting on the right 15 · more than one reverse 15 · touching a line or pole 20 · leaving the zone or the wrong exit: fail |
| Figure eight | wrong entry 15 · wrong exit 15 · stopping 5 · touching a line or pole 15 · reversing 15 · wrong direction: fail |
| Hill start | stopping too close to or over the stop line 20 · rolling back more than 20 cm 10 |
