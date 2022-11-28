import { filter, transform, passthrough, pipeline } from '../src/index.js';
import sinon from 'sinon';
import assert from 'assert';

const SAMPLES_SIZE = 100;

describe('PTransform', () => {
  describe('with debug not initialized', () => {
    let instance;

    beforeEach(() => {
      instance = transform(() => {});
    });

    it('should allow to set name if debug not initialized', () => {
      instance.name('foo');
      assert.equal(instance.debug.namespace, 'p-transform:foo');
    });
  });

  describe('with debug initialized', () => {
    let instance;

    beforeEach(() => {
      instance = transform(() => {});
      instance.debug;
    });

    it('should not allow to set name', () => {
      assert.throws(() => instance.name('foo'));
    });
  });

  describe('transforms', () => {
    let samples;
    let samplesToResolve;
    let destSamples;

    let sourceTransform;
    let testTransform;
    let destinationTransform;

    let afterSpy;

    beforeEach(() => {
      samples = [];
      destSamples = [];
      for (let i = 1; i <= SAMPLES_SIZE; i++) {
        const shouldReturn = Math.random() < 0.8;
        const sample = {
          order: i,
          get resolveValue() {
            return shouldReturn ? { sample: this } : undefined;
          },
        };

        samples.push(sample);

        {
          let resolve;
          const spy = sinon.stub();
          const promise = new Promise((inResolve) => {
            resolve = inResolve;
          });
          sample.transformStep = {
            spy,
            promise,
            resolve: () => {
              spy();
              resolve(sample.resolveValue);
            },
          };
        }

        {
          let resolve;
          const spy = sinon.stub();
          const promise = new Promise((inResolve) => {
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
        samples.forEach((sample) => sourceTransform.write(sample));
        sourceTransform.end();
        for (const sample of samplesToResolve) {
          sample.transformStep.resolve();
          await sample.destinationStep.promise;
        }
      });

      afterSpy = sinon.stub();

      sourceTransform = passthrough().name('sourceTransform');
      destinationTransform = transform((sample) => {
        destSamples.push(sample);
        sample.destinationStep.spy();
        sample.destinationStep.resolve();
      }).name('destination');
    });

    describe('transform pipeline', () => {
      beforeEach(async () => {
        testTransform = transform(async (sample) => {
          const ret = await sample.transformStep.promise;
          if (!ret) sample.destinationStep.resolve();
          return ret;
        });

        await pipeline(
          sourceTransform,
          testTransform,
          transform((chunk) => chunk.sample),
          destinationTransform
        );

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
      it('destination samples should match the resolved values', () => {
        assert.deepStrictEqual(
          destSamples,
          samplesToResolve.filter((sample) => sample.resolveValue)
        );
      });
    });

    describe('filter pipeline', () => {
      beforeEach(async () => {
        testTransform = filter(async (sample) => {
          const ret = await sample.transformStep.promise;
          if (!ret) sample.destinationStep.resolve();
          return ret;
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
          destSamples,
          samplesToResolve.filter((sample) => sample.resolveValue)
        );
      });
    });

    describe('passthrough pipeline', () => {
      beforeEach(async () => {
        testTransform = passthrough((sample) => sample.transformStep.promise);

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
        assert.deepStrictEqual(destSamples, samplesToResolve);
      });
    });
  });
});
