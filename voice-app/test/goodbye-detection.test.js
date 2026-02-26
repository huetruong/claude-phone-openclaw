'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { isGoodbye } = require('../lib/conversation-loop');

// ---------------------------------------------------------------------------
// isGoodbye() unit tests (Story 4.4 / AC6 / Task 5.3)
//
// Verifies that goodbye detection covers all expected farewell phrases and
// does NOT fire on normal utterances.
// ---------------------------------------------------------------------------

describe('isGoodbye()', () => {
  describe('returns true for expected farewell phrases', () => {
    const goodbyePhrases = [
      'goodbye',
      'good bye',
      'bye',
      'hang up',
      'end call',
      "that's all",
      'thats all',
    ];

    for (const phrase of goodbyePhrases) {
      it(`exact match: "${phrase}"`, () => {
        assert.strictEqual(isGoodbye(phrase), true, `Expected isGoodbye("${phrase}") to be true`);
      });

      it(`with leading text: "ok ${phrase}"`, () => {
        assert.strictEqual(isGoodbye(`ok ${phrase}`), true, `Expected true for "ok ${phrase}"`);
      });

      it(`with trailing text: "${phrase} thanks"`, () => {
        assert.strictEqual(isGoodbye(`${phrase} thanks`), true, `Expected true for "${phrase} thanks"`);
      });

      it(`uppercase: "${phrase.toUpperCase()}"`, () => {
        assert.strictEqual(isGoodbye(phrase.toUpperCase()), true,
          `Expected true for uppercase "${phrase.toUpperCase()}"`);
      });
    }
  });

  describe('returns false for normal utterances', () => {
    const normalPhrases = [
      'hello',
      'what is the weather',
      'byebye',              // bare compound word — no leading space
      'I said byebye',       // compound word with leading space — false positive guard
      'can you help me',
      'tell me about your day',
      '',
      '   ',
    ];

    for (const phrase of normalPhrases) {
      it(`normal phrase: "${phrase}"`, () => {
        assert.strictEqual(isGoodbye(phrase), false,
          `Expected isGoodbye("${phrase}") to be false`);
      });
    }
  });
});
