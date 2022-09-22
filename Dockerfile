

FROM node:14-slim

WORKDIR /app

ADD package.json .
ADD server.js .

ENV NODE_ENV=production

RUN yarn --production && yarn cache clean

CMD ["yarn", "start"]