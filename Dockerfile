

FROM node:14-slim

RUN apt-get update || : && apt-get install -y git

WORKDIR /app

ADD modules ./modules/
ADD plugins ./plugins/
ADD public ./public/
ADD scripts ./scripts/
ADD sponsors ./sponsors/
ADD .git ./.git/
ADD .eslintrc .
ADD .prettierrc .
ADD package.json .
ADD fly.toml .
ADD jest.config.js .
ADD server.js .
ADD rollup.config.js .
ADD unpkg.sketch .
ADD yarn.lock .

RUN npm install --global rollup

RUN yarn

RUN yarn build && yarn cache clean

# PORT
EXPOSE 8080

CMD ["yarn", "start"]