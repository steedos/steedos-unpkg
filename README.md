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

### `NPM_CACHE_ENABLED`

可以在本地文件夹中缓存npm信息。

- NPM_CACHE_ENABLED 启用缓存。
- NPM_CACHE_FOLDER 缓存文件夹的路径，默认为 caches 子文件夹。
- NPM_CACHE_PACKAGE_INFO 自动保存软件包信息到本地缓存。启用此参数，软件包版本更新后，无法获得最新的信息。
- NPM_CACHE_PACKAGE_CONTENT 自动保存软件包内容到本地缓存。

```shell
DEBUG=1
NPM_CACHE_ENABLED=true
NPM_CACHE_FOLDER=/caches/
NPM_CACHE_PACKAGE_INFO=true
NPM_CACHE_PACKAGE_CONTENT=true
```

## 纯内网环境使用CDN

1. 在公网环境启动服务；
2. 配置 NPM_CACHE_ENABLED 相关环境变量；
3. 使用浏览器访问需要缓存的软件包和版本；
4. 在内网环境启动服务；
5. 配置 NPM_CACHE_ENABLED 相关环境变量；
6. 将公网服务器的缓存文件夹(caches)复制到内网环境。
