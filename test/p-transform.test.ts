import assert from 'node:assert';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {vi, describe, beforeEach, it, expect, vitest} from 'vitest';
import {stub} from 'sinon';
import {filter, passthrough, transform} from '../src/index.js';

const SAMPLES_SIZE = 100;

describe('PTransform', () => {
  describe('transforms', () => {
    let samples: any[];
    let samplesToResolve;
    let destinationSamples;

    let sourceTransform;
    let testTransform;
    let destinationTransform;

    let afterSpy;

    beforeEach(() => {
      samples = [];
      destinationSamples = [];
      for (let i = 1; i <= SAMPLES_SIZE; i++) {
        const shouldReturn = Math.random() < 0.8;
        const sample = {
          order: i,
          get resolveValue() {
            return shouldReturn ? {sample: this} : undefined;
          },
        };

        samples.push(sample);

        {
          let resolve;
          const spy = stub();
          // eslint-disable-next-line promise/param-names
          const promise = new Promise(inResolve => {
            resolve = inResolve;
          });
          sample.transformStep = {
            spy,
            promise,
            resolve() {
              spy();
              resolve(sample.resolveValue);
            },
          };
        }

        {
          let resolve;
          const spy = stub();
          // eslint-disable-next-line promise/param-names
          const promise = new Promise(inResolve => {
            resolve = inResolve;
          });
          sample.destinationStep = {
            spy,
            promise,
            resolve,
          };
        }
      }

      samplesToResolve = [...samples].sort(() => Math.random() - 0.5);
      assert.notDeepStrictEqual(samplesToResolve, samples);

      setImmediate(async () => {
        for (const sample of samplesToResolve) {
          sample.transformStep.resolve();
          await sample.destinationStep.promise;
        }
      });

      afterSpy = stub();

      sourceTransform = Readable.from(samples);
      destinationTransform = transform(async sample => {
        sample.endSampleSpy?.();

        destinationSamples.push(sample);
        if (sample.destinationStep) {
          sample.destinationStep.spy();
          sample.destinationStep.resolve();
        }
      });
    });

    describe('transform pipeline', () => {
      const endSample = {sample: {endSampleSpy: vi.fn()}};
      const endSpy = vi.fn(function () {
        this.push(endSample);
      });

      beforeEach(async () => {
        testTransform = transform(async sample => {
          const returnValue = await sample.transformStep.promise;
          if (!returnValue) {
            sample.destinationStep.resolve();
          }

          return returnValue;
        }, endSpy);

        await pipeline(
          sourceTransform,
          testTransform,
          transform(chunk => chunk.sample),
          destinationTransform,
        );

        afterSpy();
      });

      it('transform spies should be called once', () => {
        for (const sample of samples) {
          expect(sample.transformStep.spy.callCount).toBe(1);
        }
      });
      it('end should be called', () => {
        expect(endSpy).toBeCalled();
      });
      it('end sample should be emitted', () => {
        expect(endSample.sample.endSampleSpy).toBeCalled();
      });
      it('destination spies should be conditionally called', () => {
        for (const sample of samples) {
          assert.equal(sample.destinationStep.spy.callCount, sample.resolveValue ? 1 : 0);
        }
      });
      it('destination spies called should match expected value', () => {
        assert.equal(
          samples.filter(sample => sample.destinationStep.spy.callCount).length,
          samples.filter(sample => sample.resolveValue).length,
        );
      });
      it('spies should be called before afterSpy', () => {
        for (const sample of samples) {
          assert(sample.transformStep.spy.calledBefore(afterSpy));
        }
      });
      it('destination samples should match the resolved values', () => {
        assert.deepStrictEqual(destinationSamples, [...samplesToResolve.filter(sample => sample.resolveValue), endSample.sample]);
      });
    });

    describe('filter pipeline', () => {
      beforeEach(async () => {
        testTransform = filter(async sample => {
          const returnValue = await sample.transformStep.promise;
          if (!returnValue) {
            sample.destinationStep.resolve();
          }

          return returnValue;
        });

        await pipeline(sourceTransform, testTransform, destinationTransform);

        afterSpy();
      });

      it('transform spies should be called once', () => {
        for (const sample of samples) {
          assert(sample.transformStep.spy.calledOnce);
        }
      });
      it('destination spies should be conditionally called', () => {
        for (const sample of samples) {
          assert.equal(sample.destinationStep.spy.callCount, sample.resolveValue ? 1 : 0);
        }
      });
      it('spies should be called before afterSpy', () => {
        for (const sample of samples) {
          assert(sample.transformStep.spy.calledBefore(afterSpy));
        }
      });
      it('destination samples should match the filtered samples', () => {
        assert.deepStrictEqual(
          destinationSamples,
          samplesToResolve.filter(sample => sample.resolveValue),
        );
      });
    });

    describe('passthrough pipeline', () => {
      beforeEach(async () => {
        testTransform = passthrough(sample => sample.transformStep.promise);

        await pipeline(sourceTransform, testTransform, destinationTransform);

        afterSpy();
      });

      it('transform spies should be called once', () => {
        for (const sample of samples) {
          assert(sample.transformStep.spy.calledOnce);
        }
      });
      it('destination spies should be called once', () => {
        for (const sample of samples) {
          assert(sample.destinationStep.spy.calledOnce);
        }
      });
      it('spies should be called before afterSpy', () => {
        for (const sample of samples) {
          assert(sample.transformStep.spy.calledBefore(afterSpy));
        }
      });
      it('destination samples should match the shuffled samples', () => {
        assert.deepStrictEqual(destinationSamples, samplesToResolve);
      });
    });
  });

  describe('additional chunks', () => {
    it('pipeline should reject with sync transform', async () => {
      const spy = vitest.fn();

      await pipeline(
        Readable.from([{}]),
        transform(function (chunk) {
          this.push({});
          return chunk;
        }),
        transform(function () {
          spy();
        }),
      );

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('pipeline should reject with sync transform', async () => {
      await expect(
        pipeline(
          Readable.from([{}]),
          transform(() => {
            throw new Error('foo');
          }),
        ),
      ).rejects.toThrowError('foo');
    });
    it('pipeline should reject with async transform', async () => {
      await expect(
        pipeline(
          Readable.from([{}]),
          transform(async () => {
            throw new Error('foo');
          }),
        ),
      ).rejects.toThrowError('foo');
    });
  });

  describe('enableDebug', () => {
    it('should support debug', async () => {
      vitest.spyOn(console, 'log').mockImplementation(() => {});

      const tr = transform(() => {});
      tr.enableDebug();
      await pipeline(Readable.from([{}]), tr);

      expect(console.log).toHaveBeenCalled();
    });
  });
});
