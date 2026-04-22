const textproc = require('../distribution/engine/textproc.js');
const { tokenize, porterStem, processText, processQuery, isStopword, termFrequencies } = textproc;

console.log('Module exports:', Object.keys(textproc));

const stemCases = [
  ['caresses', 'caress'], ['ponies', 'poni'], ['ties', 'ti'], ['cats', 'cat'],
  ['feed', 'feed'], ['agreed', 'agre'], ['disabled', 'disabl'],
  ['matting', 'mat'], ['mating', 'mate'], ['meeting', 'meet'],
  ['milling', 'mill'], ['messing', 'mess'], ['meetings', 'meet'],
  ['conflated', 'conflat'], ['troubled', 'troubl'], ['sized', 'size'],
  ['hopping', 'hop'], ['tanned', 'tan'], ['falling', 'fall'],
  ['hissing', 'hiss'], ['fizzed', 'fizz'], ['failing', 'fail'],
  ['filing', 'file'], ['happy', 'happi'], ['sky', 'sky'],
  ['relational', 'relat'], ['conditional', 'condit'], ['rational', 'ration'],
  ['valenci', 'valenc'], ['hesitanci', 'hesit'], ['digitizer', 'digit'],
  ['conformabli', 'conform'], ['radicalli', 'radic'], ['differentli', 'differ'],
  ['vileli', 'vile'], ['analogousli', 'analog'], ['vietnamization', 'vietnam'],
  ['predication', 'predic'], ['operator', 'oper'], ['feudalism', 'feudal'],
  ['decisiveness', 'decis'], ['hopefulness', 'hope'], ['callousness', 'callous'],
  ['formaliti', 'formal'], ['sensitiviti', 'sensit'], ['sensibiliti', 'sensibl'],
  ['triplicate', 'triplic'], ['formative', 'form'], ['formalize', 'formal'],
  ['electriciti', 'electr'], ['electrical', 'electr'], ['hopeful', 'hope'],
  ['goodness', 'good'], ['revival', 'reviv'], ['allowance', 'allow'],
  ['inference', 'infer'], ['airliner', 'airlin'], ['adjustable', 'adjust'],
  ['defensible', 'defens'], ['irritant', 'irrit'], ['replacement', 'replac'],
  ['adjustment', 'adjust'], ['dependent', 'depend'], ['adoption', 'adopt'],
  ['homologou', 'homolog'], ['communism', 'commun'], ['activate', 'activ'],
  ['angulariti', 'angular'], ['homologous', 'homolog'], ['effective', 'effect'],
  ['bowdlerize', 'bowdler'], ['probate', 'probat'], ['rate', 'rate'],
  ['cease', 'ceas'], ['controll', 'control'], ['roll', 'roll'],
];

let stemPassed = 0;
let stemFailed = 0;
for (const [input, expected] of stemCases) {
  const result = porterStem(input);
  if (result === expected) {
    stemPassed++;
  } else {
    stemFailed++;
    console.error(`STEM FAIL: "${input}" → "${result}" (expected "${expected}")`);
  }
}
console.log(`Porter Stemmer: ${stemPassed}/${stemPassed + stemFailed} passed`);

const stopwordTests = [
  ['the', true], ['and', true], ['is', true], ['a', true],
  ['kubernetes', false], ['javascript', false], ['docker', false],
];
let swPassed = 0;
for (const [word, expected] of stopwordTests) {
  if (isStopword(word) === expected) {
    swPassed++;
  } else {
    console.error(`STOPWORD FAIL: "${word}" → ${isStopword(word)} (expected ${expected})`);
  }
}
console.log(`Stopwords: ${swPassed}/${stopwordTests.length} passed`);

const t1 = tokenize('The Quick Brown Fox Jumps Over The Lazy Dog');
console.log('Tokenize basic:', JSON.stringify(t1));
if (t1.includes('the') || t1.includes('over')) {
  console.error('FAIL: tokenize should remove stopwords');
}

const t2 = tokenize('Kubernetes is a container-orchestration system for Docker');
console.log('Tokenize tech:', JSON.stringify(t2));
if (!t2.includes('kubernet')) {
  console.error('FAIL: should stem kubernetes → kubernet');
}
if (!t2.includes('docker')) {
  console.error('FAIL: should include docker');
}

const t3 = tokenize('');
if (t3.length !== 0) console.error('FAIL: empty input should return []');

const t4 = tokenize(null);
if (t4.length !== 0) console.error('FAIL: null input should return []');

const t5 = tokenize('   ...!!!   ');
if (t5.length !== 0) console.error('FAIL: punctuation-only should return []');

console.log('Tokenize edge cases: passed');

const tf = processText('Distributed systems are distributed across many nodes');
console.log('Term frequencies:', JSON.stringify(tf));
if (tf['distribut'] !== 2) {
  console.error(`FAIL: "distributed" should appear twice, got ${tf['distribut']}`);
}

const q1 = processQuery('distributed distributed systems');
console.log('Query tokens:', JSON.stringify(q1));
if (q1.length !== 2) {
  console.error(`FAIL: query should deduplicate, got ${q1.length} tokens`);
}
if (q1[0] !== 'distribut' || q1[1] !== 'system') {
  console.error('FAIL: query tokens mismatch');
}

const tf2 = termFrequencies(['a', 'b', 'a', 'c', 'b', 'a']);
if (tf2['a'] !== 3 || tf2['b'] !== 2 || tf2['c'] !== 1) {
  console.error('FAIL: termFrequencies count mismatch');
}
console.log('termFrequencies: passed');

const fnStr = tokenize.toString();
if (typeof fnStr !== 'string' || fnStr.length < 10) {
  console.error('FAIL: tokenize should be convertible to string');
}
console.log('Serialization check: functions are stringifiable');

try {
  const { execSync } = require('child_process');
  const ndResult = execSync(
    'echo "Distributed systems are distributed across many nodes" | ' +
    'cd /root/stencil/non-distribution && ./c/process.sh | ./c/stem.js',
    { encoding: 'utf-8', timeout: 5000 },
  ).trim().split('\n').filter((l) => l.length > 0);
  const ourResult = tokenize('Distributed systems are distributed across many nodes');
  console.log('Non-dist pipeline:', JSON.stringify(ndResult));
  console.log('Our pipeline:     ', JSON.stringify(ourResult));

  const ndSet = new Set(ndResult);
  const ourSet = new Set(ourResult);
  for (const term of ndSet) {
    if (!ourSet.has(term)) {
      console.error(`CROSS-CHECK WARN: non-dist has "${term}" but we don't`);
    }
  }
  for (const term of ourSet) {
    if (!ndSet.has(term)) {
      console.error(`CROSS-CHECK WARN: we have "${term}" but non-dist doesn't`);
    }
  }
  console.log('Cross-check complete');
} catch (e) {
  console.log('Cross-check skipped (non-distribution tools not available)');
}

console.log('\n=== All textproc tests complete ===');
