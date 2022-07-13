# UNPKG &middot; [![Travis][build-badge]][build]

[build-badge]: https://img.shields.io/travis/mjackson/unpkg/master.svg?style=flat-square
[build]: https://travis-ci.org/mjackson/unpkg

[UNPKG](https://unpkg.com) is a fast, global [content delivery network](https://en.wikipedia.org/wiki/Content_delivery_network) for everything on [npm](https://www.npmjs.com/).

### Documentation

Please visit [the UNPKG website](https://unpkg.com) to learn more about how to use it.

### Sponsors

Our sponsors and backers are listed [in SPONSORS.md](SPONSORS.md).

## Deploy


```bash
export SERVERLESS_PLATFORM_VENDOR=aws
export AWS_DEFAULT_REGION=cn-northwest-1
export AWS_ACCESS_KEY_ID=
export AWS_SECRET_ACCESS_KEY=
serverless
serverless create_domain
```