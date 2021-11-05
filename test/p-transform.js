'use strict';

const { transform, passthrough, pipeline } = require('../index.js');
const sinon = require('sinon');
const assert = require('assert');
const SAMPLES_SIZE = 50;

describe('PTransform', () => {
  let samples;
  let afterSpy;
  let source;
  let dest;
  let destSamples;

  beforeEach(() => {
    samples = [];
    destSamples = [];
    for (let i = 1; i <= SAMPLES_SIZE; i++) {
      samples.push({
        sleep: SAMPLES_SIZE - i,
        spy: sinon.stub(),
      });
    }
    afterSpy = sinon.stub();

    source = passthrough();
    dest = transform((file) => {
      destSamples.push(file);
    });
    setImmediate(() => {
      samples.forEach((sample) => source.write(sample));
      source.end();
    });
  });

  describe('using promise', () => {
    beforeEach(async () => {
      await pipeline(
        source,
        transform((sample) => {
          return new Promise((resolve) => {
            setTimeout(() => {
              sample.spy();
              resolve(sample);
            }, sample.sleep * 15);
          });
        }),
        dest
      );

      afterSpy();
    });
    it('spies should be called once', () => {
      for (let i = 1; i <= SAMPLES_SIZE; i++) {
        assert(samples[i - 1].spy.calledOnce);
      }
    });
    it('spies should be called in reversed order', () => {
      for (let i = 1; i <= SAMPLES_SIZE - 1; i++) {
        assert(samples[i - 1].spy.calledImmediatelyAfter(samples[i].spy));
      }
    });
    it('spies should be called before afterSpy', () => {
      for (let i = 1; i <= SAMPLES_SIZE - 1; i++) {
        assert(samples[i - 1].spy.calledBefore(afterSpy));
      }
    });
    it('destination samples should be reversed samples', () => {
      assert.deepStrictEqual(samples.reverse(), destSamples);
    });
  });
});
