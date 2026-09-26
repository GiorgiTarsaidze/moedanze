import { runExam, printResult } from './harness.mjs';
const r = runExam({ mode: process.argv[2] || 'exam', log: true });
for (const t of r.trace) console.log(t);
printResult(r);
