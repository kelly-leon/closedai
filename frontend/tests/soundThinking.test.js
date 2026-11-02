const test = require("node:test");
const assert = require("node:assert/strict");
const { SoundController, SoundTokenBatch } = require("../lib/sound.js");
const { THINKING_WORDS, chooseDifferentWord } = require("../lib/thinkingWords.js");

function mockedContext() {
  return {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resumeCalls: 0,
    resume() { this.resumeCalls += 1; return Promise.resolve(); },
    close() { return Promise.resolve(); },
    createOscillator() {
      return { frequency: { setValueAtTime() {}, value: 0 }, type: "sine", connect() {}, start() {}, stop() {}, addEventListener() {} };
    },
    createGain() {
      return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} };
    },
    createBiquadFilter() {
      return { frequency: { setValueAtTime() {} }, Q: { setValueAtTime() {} }, type: "", connect() {} };
    },
  };
}

test("thinking words never repeat consecutively", () => {
  let previous = THINKING_WORDS[0];
  for (let index = 0; index < 100; index += 1) {
    const next = chooseDifferentWord(THINKING_WORDS, previous, () => 0);
    assert.notEqual(next, previous);
    previous = next;
  }
});

test("disabled sound remains silent", () => {
  const context = mockedContext();
  const controller = new SoundController({ context });
  controller.setEnabled(false);
  controller.tokens(new SoundTokenBatch("hello"));
  controller.done();
  controller.error();
  assert.equal(context.resumeCalls, 0);
});

test("sound gesture resumes one context", async () => {
  global.window = {};
  const context = mockedContext();
  const controller = new SoundController({ context });
  controller.setEnabled(true);
  await controller.gesture();
  await controller.gesture();
  assert.equal(context.resumeCalls, 2);
});

test("stream blips are rate limited", () => {
  const context = mockedContext();
  const controller = new SoundController({ context });
  controller.setEnabled(true);
  controller.lastBlip = Date.now();
  let blips = 0;
  controller.startBed();
  context.createOscillator = function () {
    blips += 1;
    return { frequency: { setValueAtTime() {}, value: 0 }, type: "sine", connect() {}, start() {}, stop() {}, addEventListener() {} };
  };
  controller.tokens(new SoundTokenBatch("two"));
  assert.equal(blips, 0);
});

test("done, stop, and unmount clear the bed", () => {
  const context = mockedContext();
  const controller = new SoundController({ context });
  controller.setEnabled(true);
  controller.startBed();
  controller.done();
  assert.equal(controller.bed, null);
  controller.startBed();
  controller.stop();
  controller.unmount();
  assert.equal(controller.context, null);
});
