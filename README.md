# UNPKG &middot; [![Travis][build-badge]][build]

[build-badge]: https://img.shields.io/travis/mjackson/unpkg/master.svg?style=flat-square
[build]: https://travis-ci.org/mjackson/unpkg

[UNPKG](https://unpkg.com) is a fast, global [content delivery network](https://en.wikipedia.org/wiki/Content_delivery_network) for everything on [npm](https://www.npmjs.com/).

### Documentation

Please visit [the UNPKG website](https://unpkg.com) to learn more about how to use it.

### Sponsors

Our sponsors and backers are listed [in SPONSORS.md](SPONSORS.md).

### Getting started

```
yarn install
yarn build
docker build --tag steedos/steedos-unpkg .

export PORT=8080
export NPM_REGISTRY_URL=https://registry.npmmirror.com
export UNPKG_WHITE_LIST=react,@steedos,lodash
docker run -p 8080:8080 -d steedos/steedos-unpkg 
```

### `UNPKG_WHITE_LIST`

- 环境变量用于控制允许访问的包关键词，用逗号隔开。
- 任何包只要包含其中任何一个关键词都可以访问。 
- 如果未配置环境变量，则不做任何限制。

### `NPM_REGISTRY_URL`

- 环境变量用与设置NPM仓库
- 淘宝源：NPM_REGISTRY_URL=https://registry.npmmirror.com

### `NPM_CACHE_FOLDER`

对于无法访问外网的本地环境，可以在本地文件夹中获取npm信息。

- NPM_CACHE_ENABLED 启用缓存。
- NPM_CACHE_FOLDER 缓存文件夹的路径，默认为 caches 子文件夹。
- NPM_CACHE_PACKAGE_INFO 自动保存软件包信息到本地缓存。启用此参数，软件包版本更新后，无法获得最新的信息。
- NPM_CACHE_PACKAGE_CONTENT 自动保存软件包内容到本地缓存。

```shell
NPM_CACHE_FOLDER=/caches/
NPM_CACHE_PACKAGE_INFO=true
NPM_CACHE_PACKAGE_CONTENT=true
```

### `NPM_CACHE_PACKAGE_INFO`


### `NPM_CACHE_PACKAGE_CONTENT`
