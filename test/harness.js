/** Zero-dependency test harness. */

let suiteName = '';
const results = [];
let failures = 0;
let assertions = 0;

export function suite(name) { suiteName = name; }

export function test(name, fn) {
  const label = `${suiteName} > ${name}`;
  try {
    fn();
    results.push({ label, ok: true });
  } catch (err) {
    failures++;
    results.push({ label, ok: false, err });
  }
}

export function assert(cond, msg) {
  assertions++;
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertClose(actual, expected, tol, msg) {
  assertions++;
  const diff = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  if (!(diff <= tol * scale)) {
    throw new Error(
      `${msg || 'not close'}: got ${actual}, expected ${expected} (rel tol ${tol}, diff ${diff})`,
    );
  }
}

export function assertAbsClose(actual, expected, tol, msg) {
  assertions++;
  const diff = Math.abs(actual - expected);
  if (!(diff <= tol)) {
    throw new Error(`${msg || 'not close'}: got ${actual}, expected ${expected} (abs tol ${tol})`);
  }
}

export function assertGreater(a, b, msg) {
  assertions++;
  if (!(a > b)) throw new Error(`${msg || 'expected greater'}: ${a} !> ${b}`);
}

export function assertThrows(fn, msg) {
  assertions++;
  try { fn(); } catch { return; }
  throw new Error(msg || 'expected a throw');
}

export function report() {
  const pass = results.filter((r) => r.ok).length;
  for (const r of results) {
    if (!r.ok) {
      console.log(`  FAIL  ${r.label}`);
      console.log(`        ${r.err.message}`);
    }
  }
  const width = 62;
  console.log('-'.repeat(width));
  console.log(`  ${pass}/${results.length} tests passed  (${assertions} assertions)`);
  if (failures) console.log(`  ${failures} FAILED`);
  console.log('-'.repeat(width));
  return failures === 0;
}

export function groupHeader(name) {
  console.log(`\n### ${name}`);
}
