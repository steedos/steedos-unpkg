# UNPKG &middot; [![Travis][build-badge]][build]

[build-badge]: https://img.shields.io/travis/mjackson/unpkg/master.svg?style=flat-square
[build]: https://travis-ci.org/mjackson/unpkg

[UNPKG](https://unpkg.com) is a fast, global [content delivery network](https://en.wikipedia.org/wiki/Content_delivery_network) for everything on [npm](https://www.npmjs.com/).

## Documentation

Please visit [the UNPKG website](https://unpkg.com) to learn more about how to use it.

## Getting started

```
nvm use 14
yarn install
yarn build

export PORT=8080
export NPM_REGISTRY_URL=https://registry.npmmirror.com

yarn start
```

访问 http://127.0.0.1:8080/ 

## Build Docker

```
docker build --tag steedos/steedos-unpkg .
docker run -p 8080:8080 -d steedos/steedos-unpkg 
```

## Base URL

设置基础URL，用于访问UNPKG服务。

```
export UNPKG_BASE_URL=/unpkg/
```

此时需访问 http://127.0.0.1:8080/unpkg/ 

## 白名单

限制CDN服务器只能访问指定的包。

```
export UNPKG_WHITE_LIST=react,@steedos,lodash
```

- 环境变量用于控制允许访问的包关键词，用逗号隔开。
- 任何包只要包含其中任何一个关键词都可以访问。 
- 如果未配置环境变量，则不做任何限制。

## 远程NPM仓库

设置远程NPM仓库，UNPKG将从此仓库下载软件包。

```
NPM_REGISTRY_URL=https://registry.npmmirror.com
```

## NPM 缓存

可以在本地文件夹中缓存npm信息。

- NPM_CACHE_ENABLED 启用缓存。
- NPM_CACHE_FOLDER 缓存文件夹的路径，默认为 caches 子文件夹。
- NPM_CACHE_PACKAGE_INFO 自动保存软件包信息到本地缓存。启用此参数，软件包版本更新后，无法获得最新的信息。
- NPM_CACHE_PACKAGE_CONTENT 自动保存软件包内容到本地缓存。

```shell
DEBUG=1
NPM_CACHE_ENABLED=true
NPM_CACHE_FOLDER=/caches/
```

### 纯内网环境使用CDN

如果服务器不能访问外网，可以按以下步骤操作，使用本地缓存。

1. 在内网环境启动服务；
2. 配置 NPM_CACHE_ENABLED 相关环境变量；
```shell
DEBUG=1
NPM_CACHE_ENABLED=true
NPM_CACHE_FOLDER=/caches/
```

3. 参考 [自动更新缓存文件夹](#自动更新缓存文件夹) 在联网服务器上启动服务并缓存资产包到/caches；
4. 将联网服务器上缓存的caches文件夹拷贝到内网环境中并替换本地的caches文件夹；

### 手工更新缓存文件夹

在可以访问公网的服务器上用脚本，生成 /caches/ 文件夹，复制到内网环境。

> 注意，`@organization/package` 格式的软件包，需要保存为 `@organization_package`

```
cd /caches/
curl -o react.json https://registry.npmjs.com/react
curl -o react-18.2.0.tgz https://registry.npmjs.com/react/-/react-18.2.0.tgz
curl -o @steedos-widgets_amis-object.json https://registry.npmjs.com/@steedos-widgets/amis-object
curl -o @steedos-widgets_amis-object-1.1.6.tgz https://registry.npmjs.com/@steedos-widgets/amis-object/-/amis-object-1.1.6.tgz
```

### 自动更新缓存文件夹

在可以访问公网的服务器上启动服务，访问需要缓存的软件包版本，生成 /caches/ 文件夹，复制到内网环境。

```shell
NPM_REGISTRY_URL=https://registry.npmmirror.com
NPM_CACHE_ENABLED=true
NPM_CACHE_FOLDER=/caches/
NPM_CACHE_PACKAGE_INFO=false
NPM_CACHE_PACKAGE_CONTENT=true
```

### 设置Package info有效期

```
NPM_CACHE_PACKAGE_INFO_EXPIRE_DAYS
```


### 与华炎魔方集成

配置环境变量指向本服务，可以启用此服务作为华炎魔方内置的CDN服务。

```
STEEDOS_UNPKG_URL=http://127.0.0.1:8080
```
