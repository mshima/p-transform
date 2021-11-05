# p-transform

Promised out of order transform.

## Usage

A [Transform](https://nodejs.org/api/stream.html#implementing-a-transform-stream) that uses objectMode and implements custom `_write` and `_flush` methods.
`transform` implementation must be sync or return a promise. Callback is not supported.

Promisified `pipeline` and `transform` shortcut are provided for convenience.

```
const { PTransform, transform, pipeline } = require('p-transform');

await pipeline(
  new PTransform({
    transform: async file => file
  }),
  transform(async file => file);
)
```

## Debug

Use `DEBUG=p-transform:*` environment variable.

For custom debug name set `logName` option at PTransform constructor or `transform` argument.

## License

Apache-2.0
