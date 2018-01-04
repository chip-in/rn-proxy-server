FROM node:8-alpine

ENV CI_HOME /usr/local/chip-in

RUN apk --update add pcre-dev openssl-dev curl git
RUN mkdir -p ${CI_HOME}/ \
  && cd ${CI_HOME} \
  && git clone https://github.com/chip-in/rn-proxy-server.git rn-proxy-server \
  && cd ${CI_HOME}/rn-proxy-server \
  && npm i \
  && npm run cleanbuild

WORKDIR ${CI_HOME}/rn-proxy-server

ENTRYPOINT ["npm", "start", "--"]


